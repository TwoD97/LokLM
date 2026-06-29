import { describe, it, expect } from 'vitest'
import { contextualizeBySignal } from '@main/services/qa/QAService'

// ---------------------------------------------------------------------------
// A mock corpus + a BM25-style probe. Lets us measure the signal-gated
// contextualizer's DECISIONS across many conversation flows without a DB. The
// probe mirrors FTS5/BM25's essential behaviour: idf-weighted term presence,
// top score over documents. Rare topical terms (interpreter, rekursion) anchor
// strongly; absent terms (rust, vorteile) score 0.
// ---------------------------------------------------------------------------
const CORPUS: Record<string, string> = {
  interpreter:
    'Interpreter Computerprogramm führt Anweisungen direkt aus liest Quelldateien analysiert übersetzt Befehle Maschinencode CPU langsamer Compiler einfache Fehleranalyse',
  compiler:
    'Compiler übersetzt Quellcode Programmiersprache ausführbares Programm Linker schneller Ausführung statisch',
  rekursion:
    'Rekursion rekursive Programmierung Funktion Methode ruft sich selbst auf Abbruchbedingung Basisfall Stack',
  jit: 'Just-In-Time-Compiler JIT wandelt Quellcode Bytecode Laufzeit virtuelle Maschine Java NET',
  oop: 'Objektorientierte Programmierung OOP Klassen Objekte Vererbung Polymorphie Kapselung Abstraktion',
  vererbung:
    'Vererbung Oberklasse Unterklasse erbt Eigenschaften Methoden überschreiben super spezialisiert',
  threads:
    'Threads Nebenläufigkeit parallel Prozesse Synchronisation Mutex Deadlock Race Condition',
  interpreterEn:
    'interpreter program executes instructions directly reads source files translates machine code slower compiler debugging',
  compilerEn:
    'compiler translates source code programming language executable program linker faster static',
}

const STOP = new Set(
  (
    'was ist sind war waren der die das ein eine einen einem einer wie warum wieso weshalb wann ' +
    'und oder aber auch zu zum zur von vom mit für im in den dem des mehr genauer noch dazu man ' +
    "the a an is are what what's how why when more of to and or it its them both does do si sich " +
    'tell me about this that benutzt funktioniert genau erklären kannst du'
  ).split(/\s+/),
)

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-zäöüß0-9-]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w))
}

const DOCS = Object.values(CORPUS).map(tokens)
const N = DOCS.length
function df(term: string): number {
  return DOCS.filter((d) => d.includes(term)).length
}
function idf(term: string): number {
  const d = df(term)
  if (d === 0) return 0 // absent → matches nothing → contributes 0
  return Math.max(0, Math.log((N + 1) / (d + 0.5)))
}
// BM25-ish: top over docs of the summed idf of the query's terms present in it.
function probe(query: string): number {
  const qt = [...new Set(tokens(query))]
  let top = 0
  for (const doc of DOCS) {
    let s = 0
    for (const t of qt) if (doc.includes(t)) s += idf(t)
    if (s > top) top = s
  }
  return top
}

const u = (content: string) => ({ role: 'user' as const, content })
const a = (content: string) => ({ role: 'assistant' as const, content })
const run = (history: Array<{ role: 'user' | 'assistant'; content: string }>, q: string) =>
  contextualizeBySignal(history, q, probe)

describe('contextualizeBySignal — battery over conversational scenarios', () => {
  it('prints a decision table for inspection', async () => {
    type Row = {
      name: string
      hist: Array<{ role: 'user' | 'assistant'; content: string }>
      q: string
    }
    const I = u('Was ist ein Interpreter?')
    const C = u('Was ist ein Compiler?')
    const O = u('Was ist OOP?')
    const V = u('Was ist Vererbung?')
    const J = u('Was ist ein JIT?')
    const rows: Row[] = [
      {
        name: 'bare comparison (reported bug)',
        hist: [I, a('…'), C, a('…')],
        q: 'Was ist der Unterschied?',
      },
      { name: 'named comparison', hist: [I, a('…')], q: 'Wie unterscheidet sich vom Compiler?' },
      {
        name: 'reflexive comparison "wie unterscheiden sie sich?"',
        hist: [I, a('…'), C, a('…')],
        q: 'Wie unterscheiden sie sich?',
      },
      { name: 'topic switch PRESENT', hist: [I, a('…'), C, a('…')], q: 'Was ist Rekursion?' },
      {
        name: 'topic switch ABSENT (form guard → standalone)',
        hist: [I, a('…'), C, a('…')],
        q: 'Was ist Rust?',
      },
      { name: 'bare attribute fragment', hist: [I, a('…')], q: 'Vorteile?' },
      { name: 'pure meta', hist: [I, a('…')], q: 'genauer?' },
      { name: 'anaphoric "wann benutzt man das?"', hist: [I, a('…')], q: 'Wann benutzt man das?' },
      {
        name: 'continuation new PRESENT topic',
        hist: [C, a('…'), u('Was ist Rekursion?'), a('…')],
        q: 'und Threads?',
      },
      {
        name: 'EN bare comparison',
        hist: [u('what is an interpreter?'), a('…'), u('what is a compiler?'), a('…')],
        q: "what's the difference?",
      },
      { name: 'EN meta', hist: [u('what is an interpreter?'), a('…')], q: 'tell me more' },
      {
        name: 'EN common-topic switch (form guard → standalone)',
        hist: [u('what is an interpreter?'), a('…')],
        q: 'what is a compiler?',
      },
      {
        name: 'rare-operand comparison (under-enrich risk)',
        hist: [I, a('…')],
        q: 'Unterschied zu Threads?',
      },
      {
        name: 'repeated question (dedup) then fragment',
        hist: [I, a('…'), I, a('…')],
        q: 'Vorteile?',
      },
      {
        name: 'LONG convo → bare difference (last two)',
        hist: [I, a('…'), C, a('…'), J, a('…'), O, a('…'), V, a('…')],
        q: 'Was ist der Unterschied?',
      },
      {
        name: 'LONG convo → meta at end',
        hist: [I, a('…'), C, a('…'), O, a('…'), V, a('…')],
        q: 'kannst du das genauer erklären?',
      },
      {
        name: 'LONG convo → standalone present topic',
        hist: [I, a('…'), C, a('…'), O, a('…')],
        q: 'Was sind Threads?',
      },
      { name: 'no history', hist: [], q: 'Was ist ein Interpreter?' },
    ]
    console.log('\n=== signal-gated contextualization decisions ===')
    for (const r of rows) {
      const d = await run(r.hist, r.q)
      console.log(
        `${d.enriched ? 'ENRICH  ' : 'STANDALN'} | bare=${d.bareScore.toFixed(2)} enr=${d.enrichedScore.toFixed(2)} ` +
          `| ${r.name}\n           q="${r.q}" -> "${d.query}"`,
      )
    }
    expect(rows.length).toBeGreaterThan(0)
  })

  // --- assertions: the behaviours we actually want ---

  it('ENRICHES a bare comparison with BOTH prior subjects (DE)', async () => {
    const d = await run(
      [u('Was ist ein Interpreter?'), a('…'), u('Was ist ein Compiler?'), a('…')],
      'Was ist der Unterschied?',
    )
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('Interpreter')
    expect(d.query).toContain('Compiler')
  })

  it('ENRICHES a reflexive comparison ("wie unterscheiden sie sich?") with both subjects', async () => {
    const d = await run(
      [u('Was ist ein Interpreter?'), a('…'), u('Was ist ein Compiler?'), a('…')],
      'Wie unterscheiden sie sich?',
    )
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('Interpreter')
    expect(d.query).toContain('Compiler')
  })

  it('ENRICHES an English bare comparison with both subjects', async () => {
    const d = await run(
      [u('what is an interpreter?'), a('…'), u('what is a compiler?'), a('…')],
      "what's the difference?",
    )
    expect(d.enriched).toBe(true)
    expect(d.query.toLowerCase()).toContain('interpreter')
    expect(d.query.toLowerCase()).toContain('compiler')
  })

  it('leaves a STANDALONE topic switch (present in corpus) bare', async () => {
    const d = await run(
      [u('Was ist ein Interpreter?'), a('…'), u('Was ist ein Compiler?'), a('…')],
      'Was ist Rekursion?',
    )
    expect(d.enriched).toBe(false)
    expect(d.query).toBe('Was ist Rekursion?')
  })

  it('form guard: a definitional switch to a corpus-COMMON topic stays bare', async () => {
    // BM25 alone got this wrong (the common "compiler" anchors weakly, the prior
    // "interpreter" inflated the enriched probe → over-enrich). The definitional
    // form guard ("what is X?", no comparison head) now keeps it standalone before
    // the probe runs.
    const d = await run([u('what is an interpreter?'), a('…')], 'what is a compiler?')
    expect(d.enriched).toBe(false)
  })

  it('form guard: the live misfire — "Was ist ein kompiler?" after "…interpreter?" stays bare', async () => {
    // The reported regression: "kompiler" (a spelling the corpus does not contain)
    // anchors nothing, so the bare probe scored ~0 and the prior "interpreter"
    // dragged itself back in. The definitional guard fixes it independent of the
    // corpus — no probe, no enrichment.
    const d = await run([u('Was ist ein interpreter?'), a('…')], 'Was ist ein kompiler?')
    expect(d.enriched).toBe(false)
    expect(d.query).toBe('Was ist ein kompiler?')
  })

  it('known limit (risky): a comparison naming a RARE operand can under-enrich', async () => {
    // "Threads" is a rare, strong anchor → the bare query retrieves it on its
    // own, so the gate keeps it bare and DROPS the prior subject (Interpreter).
    // This is the one failure direction the floor can't fix (a missing chunk
    // can't be re-ranked back in). Mitigations: the operand is usually present
    // in the bare result anyway, and live BM25 tuning on the real corpus moves
    // the boundary. Asserted so it's measured, not hidden.
    const d = await run([u('Was ist ein Interpreter?'), a('…')], 'Unterschied zu Threads?')
    expect(d.enriched).toBe(false)
    expect(d.query).toBe('Unterschied zu Threads?')
  })

  it('ENRICHES a bare attribute fragment ("Vorteile?")', async () => {
    const d = await run([u('Was ist ein Interpreter?'), a('…')], 'Vorteile?')
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('Interpreter')
  })

  it('ENRICHES an anaphoric "Wann benutzt man das?"', async () => {
    const d = await run([u('Was ist ein Interpreter?'), a('…')], 'Wann benutzt man das?')
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('Interpreter')
  })

  it('ENRICHES a pure-meta follow-up ("genauer?")', async () => {
    const d = await run([u('Was ist ein Interpreter?'), a('…')], 'genauer?')
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('Interpreter')
  })

  it('de-duplicates a repeated prior question when enriching', async () => {
    const d = await run(
      [u('Was ist ein Interpreter?'), a('…'), u('Was ist ein Interpreter?'), a('…')],
      'Vorteile?',
    )
    expect(d.enriched).toBe(true)
    // "Interpreter" appears once, not twice.
    expect(d.query).toBe('Was ist ein Interpreter? Vorteile?')
  })

  it('uses only the LAST TWO subjects for a comparison in a long conversation', async () => {
    const d = await run(
      [
        u('Was ist ein Interpreter?'),
        a('…'),
        u('Was ist ein Compiler?'),
        a('…'),
        u('Was ist OOP?'),
        a('…'),
        u('Was ist Vererbung?'),
        a('…'),
      ],
      'Was ist der Unterschied?',
    )
    expect(d.enriched).toBe(true)
    expect(d.query).toContain('OOP')
    expect(d.query).toContain('Vererbung')
    // the earlier subjects are NOT dragged in
    expect(d.query).not.toContain('Interpreter')
  })

  it('leaves a standalone present-topic question bare even in a long conversation', async () => {
    const d = await run(
      [
        u('Was ist ein Interpreter?'),
        a('…'),
        u('Was ist ein Compiler?'),
        a('…'),
        u('Was ist OOP?'),
        a('…'),
      ],
      'Was sind Threads?',
    )
    expect(d.enriched).toBe(false)
  })

  it('returns the bare query unchanged with no history', async () => {
    const d = await run([], 'Was ist ein Interpreter?')
    expect(d.enriched).toBe(false)
    expect(d.query).toBe('Was ist ein Interpreter?')
  })

  it('form guard: a definitional switch to an ABSENT topic stays bare', async () => {
    // Previously the documented over-enrich (Rust isn't in the corpus → bare ~0 →
    // the prior subjects inflated the enriched probe → enrich). The definitional
    // guard now keeps it standalone, so an absent topic cleanly refuses instead of
    // answering tangentially about the prior topic.
    const d = await run(
      [u('Was ist ein Interpreter?'), a('…'), u('Was ist ein Compiler?'), a('…')],
      'Was ist Rust?',
    )
    expect(d.enriched).toBe(false)
    expect(d.query).toBe('Was ist Rust?')
  })
})
