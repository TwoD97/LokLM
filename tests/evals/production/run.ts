import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { runProductionMatrix } from './harness'
import { CASES, CORPUS } from './fixtures'

const args = process.argv.slice(2)
const outputIndex = args.indexOf('--out')
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined
if (outputIndex >= 0 && !output) throw new Error('--out requires a file path')
const sourcePaths = [
  'src/main/services/qa/QAService.ts',
  'src/main/services/llm/prompt.ts',
  'src/main/services/retrieval/RetrievalService.ts',
  'src/main/services/retrieval/rrf.ts',
  'src/main/services/qa/contextBudget.ts',
  'src/main/services/llm/LlamaService.ts',
]
const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex')
const sourceHashes = Object.fromEntries(
  await Promise.all(sourcePaths.map(async (path) => [path, sha(await readFile(path))])),
)
const rows = await runProductionMatrix()
const report = {
  kind: 'synthetic-production-mechanics',
  generatedAt: new Date().toISOString(),
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  gitDirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  sourceHashes,
  fixtureSha256: sha(JSON.stringify({ CASES, CORPUS })),
  limitations: [
    'Inference and index scores are deterministic fixtures.',
    'Not a model accuracy, PDF parser, latency, or GPU-residency benchmark.',
    'Weak-only answerability is reported as a known unresolved limitation.',
  ],
  cases: rows.length,
  passing: rows.filter((row) => row.checksPassed).length,
  unexpectedFailures: rows.filter((row) => !row.checksPassed && !row.knownLimitation).length,
  knownLimitations: rows.filter((row) => !row.checksPassed && row.knownLimitation).length,
  rows,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (output) {
  const path = resolve(output)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, json, { flag: 'wx' })
  console.log(`Wrote ${path}`)
} else console.log(json)
if (args.includes('--check') && report.unexpectedFailures > 0) process.exitCode = 1
