import type { SearchHit } from '../../../src/main/db/types'

/** Artificial evidence and index scores for control-flow regressions, not a model-quality dataset. */
export interface ProductionCase {
  id: string
  question: string
  language: 'de' | 'en'
  category: 'date' | 'table' | 'cross-language' | 'multi-source' | 'oversize' | 'no-answer'
  lexical: Array<[number, number]>
  dense: Array<[number, number]>
  required: Array<{ chunkId: number; text: string }>
  shouldRefuse: boolean
  neighbourRadius?: number
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  pinnedDocumentIds?: number[]
  knownLimitation?: string
}

function chunk(
  id: number,
  documentId: number,
  ordinal: number,
  language: 'de' | 'en',
  text: string,
): SearchHit {
  return {
    chunk_id: id,
    document_id: documentId,
    ordinal,
    language,
    text,
    document_title: `Synthetic reference ${documentId}`,
    page_from: ordinal + 1,
    page_to: ordinal + 1,
    heading_path: null,
    score: 0,
    added_at: 0,
  }
}

export const CORPUS: SearchHit[] = [
  chunk(
    11,
    1,
    0,
    'de',
    'Der Workshop beginnt am 14. Oktober 2026 um 09:30 Uhr. Die Teilnahme kostet 85 Euro. Anmeldung bis zum 7. Oktober 2026.',
  ),
  chunk(
    21,
    2,
    0,
    'en',
    '| Service | Basic | Plus |\n|---|---:|---:|\n| Monthly fee | EUR 12 | EUR 19 |\n| Storage | 5 GB | 20 GB |\nThe prices include VAT.',
  ),
  chunk(
    31,
    3,
    0,
    'en',
    'The replacement filter must be changed every 90 days. Disconnect the pump before maintenance. The cartridge code is F-27.',
  ),
  chunk(
    41,
    4,
    0,
    'de',
    'Die Garantie für den Sensor beträgt 24 Monate ab Kaufdatum. Zum Austausch muss die Seriennummer angegeben werden.',
  ),
  chunk(
    51,
    5,
    0,
    'en',
    'North warehouse holds 520 units. This is the confirmed inventory for 24 September 2026.',
  ),
  chunk(52, 5, 1, 'en', 'Historical packing instructions, not current inventory. '.repeat(1000)),
  chunk(
    61,
    6,
    0,
    'en',
    'South warehouse holds 210 units. This is the confirmed inventory for 24 September 2026.',
  ),
  chunk(71, 7, 0, 'de', 'Die Projektkennung ist ALPHA-71. '.repeat(1200)),
  chunk(
    81,
    8,
    0,
    'en',
    'This unrelated gardening note discusses compost and spring flowers. It contains no company revenue or accounting figures.',
  ),
]

export const CASES: ProductionCase[] = [
  {
    id: 'de-date',
    question: 'Wann beginnt der Workshop und wie viel kostet die Teilnahme?',
    language: 'de',
    category: 'date',
    lexical: [[11, 9]],
    dense: [[11, 0.91]],
    required: [
      { chunkId: 11, text: '14. Oktober 2026 um 09:30' },
      { chunkId: 11, text: '85 Euro' },
    ],
    shouldRefuse: false,
  },
  {
    id: 'en-table',
    question: 'What is the monthly fee and storage allowance of Plus?',
    language: 'en',
    category: 'table',
    lexical: [[21, 8]],
    dense: [[21, 0.89]],
    required: [
      { chunkId: 21, text: '| Monthly fee | EUR 12 | EUR 19 |' },
      { chunkId: 21, text: '| Storage | 5 GB | 20 GB |' },
    ],
    shouldRefuse: false,
  },
  {
    id: 'de-to-en',
    question: 'Nach wie vielen Tagen muss der Filter gewechselt werden?',
    language: 'de',
    category: 'cross-language',
    lexical: [],
    dense: [[31, 0.92]],
    required: [{ chunkId: 31, text: 'every 90 days' }],
    shouldRefuse: false,
  },
  {
    id: 'en-to-de',
    question: 'How many months does the sensor warranty last?',
    language: 'en',
    category: 'cross-language',
    lexical: [],
    dense: [[41, 0.9]],
    required: [{ chunkId: 41, text: '24 Monate' }],
    shouldRefuse: false,
  },
  {
    id: 'multi-source',
    question: 'State the inventory of the North and South warehouses.',
    language: 'en',
    category: 'multi-source',
    lexical: [
      [51, 9],
      [61, 8],
    ],
    dense: [
      [51, 0.91],
      [61, 0.88],
    ],
    required: [
      { chunkId: 51, text: '520 units' },
      { chunkId: 61, text: '210 units' },
    ],
    shouldRefuse: false,
  },
  {
    id: 'oversize-neighbour',
    question: 'State the inventory of the North and South warehouses.',
    language: 'en',
    category: 'multi-source',
    lexical: [
      [51, 9],
      [61, 8],
    ],
    dense: [
      [51, 0.91],
      [61, 0.88],
    ],
    required: [
      { chunkId: 51, text: '520 units' },
      { chunkId: 61, text: '210 units' },
    ],
    shouldRefuse: false,
    neighbourRadius: 1,
  },
  {
    id: 'long-history',
    question: 'State the inventory of the North and South warehouses.',
    language: 'en',
    category: 'multi-source',
    lexical: [
      [51, 9],
      [61, 8],
    ],
    dense: [
      [51, 0.91],
      [61, 0.88],
    ],
    required: [
      { chunkId: 51, text: '520 units' },
      { chunkId: 61, text: '210 units' },
    ],
    shouldRefuse: false,
    history: Array.from({ length: 16 }, (_, index) => ({
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      content:
        'An earlier discussion about shipping and packaging, without current stock information. '.repeat(
          50,
        ),
    })),
  },
  {
    id: 'single-oversize',
    question: 'Was ist die Projektkennung?',
    language: 'de',
    category: 'oversize',
    lexical: [[71, 9]],
    dense: [[71, 0.91]],
    required: [],
    shouldRefuse: true,
  },
  {
    id: 'empty-de',
    question: 'Welchen Umsatz hatte das Unternehmen im Jahr 2025?',
    language: 'de',
    category: 'no-answer',
    lexical: [],
    dense: [],
    required: [],
    shouldRefuse: true,
  },
  {
    id: 'empty-en',
    question: 'What revenue did the company earn in 2025?',
    language: 'en',
    category: 'no-answer',
    lexical: [],
    dense: [],
    required: [],
    shouldRefuse: true,
  },
  {
    id: 'weak-only',
    question: 'What revenue did the company earn in 2025?',
    language: 'en',
    category: 'no-answer',
    lexical: [],
    dense: [[81, 0.05]],
    required: [],
    shouldRefuse: true,
    knownLimitation:
      'Top-ranked weak dense evidence is retained; calibrated answerability admission is outside this change.',
  },
]

const historyCase = CASES.find((entry) => entry.id === 'long-history')!
CASES.push({
  ...historyCase,
  id: 'long-history-pins',
  pinnedDocumentIds: [1, 5],
  required: [...historyCase.required, { chunkId: 11, text: '85 Euro' }],
})
