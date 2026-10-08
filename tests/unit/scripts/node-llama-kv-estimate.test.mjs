import { test } from 'vitest'
import assert from 'node:assert/strict'
import { GgufInsights as Insights, GgmlType } from 'node-llama-cpp'

// Exercise the installed SDK's actual heuristic and V2 fallback with synthetic
// GGUF metadata and a mocked addon. No native backend, model or weights load.
// Intended repository path: tests/unit/scripts/node-llama-kv-estimate.test.mjs.

// Independent GGML storage facts: bytes in one encoded block and scalar values
// per block. No native addon, weights, files or backend are instantiated.
const TYPES = new Map([
  [GgmlType.F16, [2, 1]],
  [GgmlType.F32, [4, 1]],
  [GgmlType.BF16, [2, 1]],
  [GgmlType.Q8_0, [34, 32]],
  [GgmlType.Q4_0, [18, 32]],
  [GgmlType.Q4_K, [144, 256]],
])
const make = ({
  architecture = 'llama',
  metadata = {},
  recurrent = false,
  typeOverrides = new Map(),
  blockOverrides = new Map(),
} = {}) => {
  const logs = []
  const llama = {
    _consts: { ggmlTypeF16Size: 2, ggmlTypeF32Size: 4, ggmlTensorOverhead: 0, ggmlMaxDims: 4 },
    _bindings: {
      getTypeSizeForGgmlType: (type) =>
        typeOverrides.has(type) ? typeOverrides.get(type) : TYPES.get(type)?.[0],
      getBlockSizeForGgmlType: (type) =>
        blockOverrides.has(type) ? blockOverrides.get(type) : TYPES.get(type)?.[1],
      getGgmlGraphOverheadCustom: () => 0,
      getIsArchRecurrent: () => recurrent,
      getIsArchHybrid: () => architecture === 'qwen35',
    },
    _log: (level, message) => logs.push({ level, message }),
    supportsMmap: false,
  }
  const file = {
    metadata: { general: { architecture }, tokenizer: { ggml: { tokens: [] } } },
    architectureMetadata: {
      block_count: 4,
      context_length: 4096,
      embedding_length: 128,
      vocab_size: 0,
      attention: { head_count: 4, head_count_kv: 2, key_length: 32, value_length: 64 },
      ...metadata,
    },
    fullTensorInfo: [],
    sourceData: [],
  }
  const insights = new Insights(file, llama)
  return { insights, logs }
}
const splitOptions = (keyType, valueType, gpuLayers = 3, extra = {}) => ({
  fullAttentionKvSize: 256,
  swaKvSize: 256,
  sequences: 1,
  totalFileLayers: 4,
  finalModelGpuLayers: gpuLayers,
  usingGpu: gpuLayers > 0,
  flashAttention: true,
  kvCacheKeyType: keyType,
  kvCacheValueType: valueType,
  ...extra,
})
const publicOptions = (keyType, valueType, gpuLayers = 3) => ({
  contextSize: 256,
  modelGpuLayers: gpuLayers,
  batchSize: 32,
  sequences: 1,
  includeGraphOverhead: false,
  flashAttention: true,
  kvCacheKeyType: keyType,
  kvCacheValueType: valueType,
})
const bytesPerScalar = (type) => TYPES.get(type)[0] / TYPES.get(type)[1]

for (const [name, keyType, valueType, keyElements = 64] of [
  ['F16 both', GgmlType.F16, GgmlType.F16],
  ['Q8 both', GgmlType.Q8_0, GgmlType.Q8_0],
  ['Q4 both', GgmlType.Q4_0, GgmlType.Q4_0],
  ['Q8 key, F16 value', GgmlType.Q8_0, GgmlType.F16],
  ['F16 key, Q4 value', GgmlType.F16, GgmlType.Q4_0],
  ['Q4 key, Q8 value', GgmlType.Q4_0, GgmlType.Q8_0],
  ['F32 key, BF16 value', GgmlType.F32, GgmlType.BF16],
  ['256-scalar block key', GgmlType.Q4_K, GgmlType.F16, 256],
]) {
  for (const gpuLayers of [0, 1, 3, 5]) {
    test(`${name}: ${gpuLayers} GPU model layers preserve exact CPU/GPU KV split`, () => {
      const { insights } = make({
        metadata: {
          attention: {
            head_count: 4,
            head_count_kv: 2,
            key_length: keyElements / 2,
            value_length: 64,
          },
        },
      })
      const result = insights._estimateContextCacheMemorySplitInBytes(
        splitOptions(keyType, valueType, gpuLayers),
      )
      const gpuAttentionLayers = Math.max(0, gpuLayers - 1)
      const perLayer =
        256 * (keyElements * bytesPerScalar(keyType) + 128 * bytesPerScalar(valueType))
      assert.equal(result.gpuKVCacheSize, perLayer * gpuAttentionLayers)
      assert.equal(result.cpuKVCacheSize, perLayer * (4 - gpuAttentionLayers))
      assert.equal(result.gpuRecurrentStateSize, 0)
      assert.equal(result.cpuRecurrentStateSize, 0)
      assert.equal(result.maxAttentionLayerKvSize, 256)
      assert.equal(result.maxAttentionLayerHeadCountKv, 2)
      const full = insights.estimateContextResourceRequirements(
        publicOptions(keyType, valueType, gpuLayers),
      )
      assert.equal(full.cpuRam, result.cpuKVCacheSize + 128)
      assert.equal(full.gpuVram, gpuLayers > 0 ? result.gpuKVCacheSize + 128 : 0)
    })
  }
}

test('quantized cache ratios follow independently known GGML storage bytes', () => {
  const { insights } = make()
  const split = (type) =>
    insights._estimateContextCacheMemorySplitInBytes(splitOptions(type, type, 5)).gpuKVCacheSize
  assert.equal(split(GgmlType.F16), 393216)
  assert.equal(split(GgmlType.Q8_0), 208896)
  assert.equal(split(GgmlType.Q4_0), 110592)
  assert.equal(split(GgmlType.Q8_0) / split(GgmlType.F16), 34 / 64)
  assert.equal(split(GgmlType.Q4_0) / split(GgmlType.F16), 18 / 64)
})

test('hybrid recurrent states stay F32 while attention cache uses chosen quantization', () => {
  const { insights } = make({
    architecture: 'qwen35',
    metadata: {
      full_attention_interval: 2,
      ssm: { conv_kernel: 3, inner_size: 64, state_size: 16, group_count: 2 },
    },
  })
  // Recurrent layers 0 and 2; attention layers 1 and 3. Three GPU model
  // layers put 2/3 on GPU, hence one recurrent and one attention per device.
  const f16 = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.F16, GgmlType.F16, 3, { sequences: 3 }),
  )
  const q8 = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.Q8_0, GgmlType.Q8_0, 3, { sequences: 3 }),
  )
  const recurrentPerDevice = 3 * ((3 - 1) * (64 + 2 * 2 * 16) + 16 * 64) * 4
  assert.equal(f16.cpuRecurrentStateSize, recurrentPerDevice)
  assert.equal(f16.gpuRecurrentStateSize, recurrentPerDevice)
  assert.equal(q8.cpuRecurrentStateSize, recurrentPerDevice)
  assert.equal(q8.gpuRecurrentStateSize, recurrentPerDevice)
  assert.equal(f16.cpuKVCacheSize, 98304)
  assert.equal(q8.cpuKVCacheSize, 52224)
  assert.equal(q8.gpuKVCacheSize, 52224)
})

test('all-recurrent architecture is unaffected by valid KV precision choices', () => {
  const { insights } = make({
    architecture: 'mamba',
    recurrent: true,
    metadata: {
      ssm: { conv_kernel: 4, inner_size: 32, state_size: 8, group_count: 1 },
    },
  })
  const f16 = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.F16, GgmlType.F16),
  )
  const q4 = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.Q4_0, GgmlType.Q4_0),
  )
  assert.deepEqual(q4, f16)
  assert.equal(q4.cpuKVCacheSize, 0)
  assert.equal(q4.gpuKVCacheSize, 0)
  assert.ok(q4.cpuRecurrentStateSize > 0 && q4.gpuRecurrentStateSize > 0)
})

test('per-layer heads, SWA cache sizes and shared cache ownership remain effective', () => {
  const { insights } = make({
    architecture: 'gemma2',
    metadata: {
      attention: {
        head_count: 4,
        head_count_kv: [1, 2, 1, 2],
        key_length: 32,
        value_length: 64,
        sliding_window_pattern: [true, false, true, false],
        shared_kv_layers: 1,
      },
    },
  })
  const result = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.Q8_0, GgmlType.Q4_0, 3, { swaKvSize: 64 }),
  )
  // Layer 3 shares another layer's cache: only 0, 1 and 2 own storage.
  const small = 64 * ((32 * 34) / 32 + (64 * 18) / 32)
  const large = 256 * ((64 * 34) / 32 + (128 * 18) / 32)
  assert.equal(result.cpuKVCacheSize, small + large)
  assert.equal(result.gpuKVCacheSize, small)
})

test('non-flash value padding stays unchanged for unequal per-layer head counts', () => {
  const { insights } = make({
    metadata: {
      attention: {
        head_count: 4,
        head_count_kv: [1, 2, 1, 2],
        key_length: 32,
        value_length: 64,
      },
    },
  })
  const result = insights._estimateContextCacheMemorySplitInBytes(
    splitOptions(GgmlType.Q8_0, GgmlType.Q4_0, 3, { flashAttention: false }),
  )
  const perPair = 256 * ((32 * 3 * 34) / 32 + (128 * 2 * 18) / 32)
  assert.equal(result.cpuKVCacheSize, perPair)
  assert.equal(result.gpuKVCacheSize, perPair)
})

for (const side of ['type', 'block']) {
  for (const bad of [
    undefined,
    null,
    0,
    -1,
    NaN,
    Infinity,
    1.5,
    '32',
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    test(`invalid ${side} metadata ${String(bad)} fails closed`, async () => {
      const options =
        side === 'type'
          ? { typeOverrides: new Map([[GgmlType.Q8_0, bad]]) }
          : { blockOverrides: new Map([[GgmlType.Q8_0, bad]]) }
      const { insights } = make(options)
      assert.throws(
        () =>
          insights.estimateContextResourceRequirements(publicOptions(GgmlType.Q8_0, GgmlType.F16)),
        /Invalid KV cache type or block size/,
      )
      // The real V2 method reaches its real heuristic after a null simulator
      // source; the invalid fallback error must propagate instead of a number.
      await assert.rejects(
        insights.estimateContextResourceRequirementsV2(publicOptions(GgmlType.Q8_0, GgmlType.F16)),
        /Invalid KV cache type or block size/,
      )
    })
  }
}

test('invalid value type is independently rejected', () => {
  const { insights } = make({ blockOverrides: new Map([[GgmlType.Q4_0, 0]]) })
  assert.throws(
    () => insights.estimateContextResourceRequirements(publicOptions(GgmlType.F16, GgmlType.Q4_0)),
    /Invalid KV cache type or block size/,
  )
})

test('unknown cache type does not become an optimistic F16 estimate', async () => {
  const { insights } = make()
  await assert.rejects(
    insights.estimateContextResourceRequirementsV2(publicOptions(999999, GgmlType.F16)),
    /Invalid KV cache type or block size/,
  )
})

test('V2 simulation exception followed by invalid metadata surfaces the fallback error', async () => {
  const { insights, logs } = make({ blockOverrides: new Map([[GgmlType.Q8_0, 0]]) })
  insights._resolveSimulatorSource = async () => 'synthetic-metadata-only'
  insights._simulationSession = {
    estimateContextResources: async () => {
      throw new Error('synthetic unavailable simulator')
    },
  }
  await assert.rejects(
    insights.estimateContextResourceRequirementsV2(publicOptions(GgmlType.Q8_0, GgmlType.F16)),
    /Invalid KV cache type or block size/,
  )
  assert.equal(logs.length, 1)
  assert.match(logs[0].message, /Falling back to estimation heuristic/)
})

for (const failure of ['missing-source', 'simulation-throws']) {
  test(`V2 ${failure} uses corrected heuristic with independent K/V types`, async () => {
    const { insights, logs } = make()
    let simulationCalls = 0
    if (failure === 'simulation-throws') {
      insights._resolveSimulatorSource = async () => 'synthetic-metadata-only'
      insights._simulationSession = {
        estimateContextResources: async () => {
          simulationCalls++
          throw new Error('synthetic simulation failure')
        },
      }
    }
    const options = publicOptions(GgmlType.Q8_0, GgmlType.Q4_0)
    const result = await insights.estimateContextResourceRequirementsV2(options)
    // V2 intentionally uses normal graph overhead regardless of the legacy-only
    // includeGraphOverhead option. Compare to an independently quantized F16
    // baseline delta so graph/output/recurrent terms cannot mask the KV defect.
    const baseline = insights.estimateContextResourceRequirements({
      ...options,
      includeGraphOverhead: true,
      kvCacheKeyType: GgmlType.F16,
      kvCacheValueType: GgmlType.F16,
    })
    const expectedDelta = 2 * 256 * (64 * (2 - 34 / 32) + 128 * (2 - 18 / 32))
    assert.equal(baseline.cpuRam - result.cpuRam, expectedDelta)
    assert.equal(baseline.gpuVram - result.gpuVram, expectedDelta)
    assert.equal(simulationCalls, failure === 'simulation-throws' ? 1 : 0)
    assert.equal(logs.length, failure === 'simulation-throws' ? 1 : 0)
    if (logs.length) assert.match(logs[0].message, /Falling back to estimation heuristic/)
  })
}

test('V2 successful native simulation is preserved and does not consult heuristic sizes', async () => {
  const { insights } = make({ typeOverrides: new Map([[GgmlType.Q8_0, undefined]]) })
  insights._resolveSimulatorSource = async () => 'synthetic-metadata-only'
  let calls = 0
  insights._simulationSession = {
    estimateContextResources: async () => {
      calls++
      return { cpuRam: 123456, gpuVram: 654321 }
    },
  }
  const options = publicOptions(GgmlType.Q8_0, GgmlType.F16)
  assert.deepEqual(await insights.estimateContextResourceRequirementsV2(options), {
    cpuRam: 123456,
    gpuVram: 654321,
  })
  assert.equal(calls, 1)
  assert.deepEqual(await insights.estimateContextResourceRequirementsV2(options), {
    cpuRam: 123456,
    gpuVram: 654321,
  })
  assert.equal(calls, 1)
})
