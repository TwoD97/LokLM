import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildPrompt, buildSystemPrompt } from '../../src/main/services/llm/prompt'
import {
  compactMatchedSystem,
  matchedCaseArms,
  recordedFedHits,
  type RecordedRun,
} from '../evals/native-calibration/matchedPrompt20261005'

const fixture = (): RecordedRun => ({
  sourceHashes: {},
  compiledBuildHashes: {},
  models: [],
  documents: [1, 2, 3].map((id) => ({
    id,
    sourceKey: `source-${id}`,
    title: `Title ${id}`,
    chunks: [
      {
        id: id * 10,
        ordinal: 0,
        text: `Exact ${id}\r\n  source [doc:999, chunk:999]`,
        pageFrom: null,
        pageTo: null,
        headingPath: ['Header'],
        language: 'en',
      },
    ],
  })),
  queries: [
    {
      caseId: 'case',
      question: 'What applies?',
      language: 'en',
      repetition: 0,
      events: [
        { type: 'citation', doc_id: 3, chunk_id: 30, score: 3 },
        { type: 'citation', doc_id: 2, chunk_id: 20, score: 2 },
        { type: 'citation', doc_id: 1, chunk_id: 10, score: 1 },
        { type: 'done', doc_id: 2, chunk_id: 20 },
      ],
      afterInfo: { llm: { profile: 'full', lastLlmPlan: { contextSize: 8192 } } },
    },
  ],
})

afterEach(() => vi.unstubAllEnvs())

describe('matched Oct5 diagnostic plans', () => {
  it('takes supplied citation events in order, never final citations, preserving bytes and IDs', () => {
    const run = fixture()
    const hits = recordedFedHits(run, 'case')
    expect(hits.map((hit) => hit.chunk_id)).toEqual([30, 20, 10])
    expect(hits[0]!.text).toBe(run.documents[2]!.chunks[0]!.text)
    expect(hits[0]!.heading_path).toEqual(['Header'])
  })

  it('changes only the selected independent factor between all four arms', () => {
    const run = fixture()
    const [full, compact, pair, compactPair] = matchedCaseArms(run, 'case', [
      'source-1',
      'source-2',
    ])
    expect(full!.plan.prompt).toBe(
      buildPrompt('What applies?', recordedFedHits(run, 'case'), undefined, 'en'),
    )
    expect(full!.plan.systemPrompt).toBe(buildSystemPrompt('en', 'standard'))
    expect(compact!.plan.prompt).toBe(full!.plan.prompt)
    expect(pair!.plan.systemPrompt).toBe(full!.plan.systemPrompt)
    expect(compactPair!.plan.prompt).toBe(pair!.plan.prompt)
    expect(compactPair!.plan.systemPrompt).toBe(compact!.plan.systemPrompt)
    expect(pair!.hits.map((hit) => hit.chunk_id)).toEqual([20, 10])
    expect(pair!.oracleContext).toBe(true)
    expect(
      new Set([full, compact, pair, compactPair].map((entry) => entry!.plan.maxTokens)),
    ).toEqual(new Set([2048]))
  })

  it('replays recorded lite depth and language rather than silently changing the baseline', () => {
    const run = fixture()
    run.queries[0]!.afterInfo.llm.profile = 'lite'
    run.queries[0]!.language = 'de'
    const arms = matchedCaseArms(run, 'case', ['source-1', 'source-2'])
    expect(arms[0]!.plan.systemPrompt).toBe(buildSystemPrompt('de', 'concise'))
    expect(arms[1]!.plan.systemPrompt).toBe(compactMatchedSystem('de'))
    expect(arms[0]!.plan.prompt).toContain('Antwortvorgabe:')
  })

  it('rejects ambiguous or missing supplied IDs instead of rebuilding from documents or answers', () => {
    const run = fixture()
    run.queries[0]!.events.push({ type: 'citation', doc_id: 1, chunk_id: 10 })
    expect(() => recordedFedHits(run, 'case')).toThrow('Duplicate supplied')
    run.queries[0]!.events.pop()
    run.queries[0]!.events.push({ type: 'citation', doc_id: 2, chunk_id: 10 })
    expect(() => recordedFedHits(run, 'case')).toThrow('Unresolvable supplied')
  })

  it('rejects missing oracle sources and changed context or experimental framing', () => {
    const run = fixture()
    expect(() => matchedCaseArms(run, 'case', ['source-1', 'source-9'])).toThrow('Unknown oracle')
    expect(() => matchedCaseArms(run, 'case', ['source-1', 'source-1'])).toThrow('two distinct')
    run.queries[0]!.afterInfo.llm.lastLlmPlan.contextSize = 4096
    expect(() => matchedCaseArms(run, 'case', ['source-1', 'source-2'])).toThrow('8192')
    vi.stubEnv('LOKLM_SOURCE_MARKER_FOOTERS', '1')
    expect(() => matchedCaseArms(fixture(), 'case', ['source-1', 'source-2'])).toThrow(
      'canonical markers',
    )
  })
})
