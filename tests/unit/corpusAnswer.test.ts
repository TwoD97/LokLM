import { describe, it, expect } from 'vitest'
import { renderCorpusAnswer, CORPUS_LIST_MAX, type CorpusDoc } from '@main/services/qa/corpusAnswer'

const doc = (id: number, title: string, hits = 1): CorpusDoc => ({
  id,
  title,
  chunkHits: hits,
  firstChunkId: id * 10,
})

describe('renderCorpusAnswer', () => {
  it('DE count with theme: bold count + one marker per doc', () => {
    const out = renderCorpusAnswer(
      'de',
      'count',
      ['strom', 'spannung'],
      [doc(1, 'Grundlagen.pdf', 5), doc(2, 'Notizen.md', 2)],
    )
    expect(out).toContain('**2** Dokumente zum Thema „strom spannung“')
    expect(out).toContain('- Grundlagen.pdf [doc:1, chunk:10]')
    expect(out).toContain('- Notizen.md [doc:2, chunk:20]')
  })

  it('DE count without theme: workspace-wide wording + singular noun', () => {
    const out = renderCorpusAnswer('de', 'count', [], [doc(1, 'Einzeldokument.pdf')])
    expect(out).toContain('insgesamt **1** Dokument in diesem Workspace')
    expect(out).not.toContain('Dokumente ')
  })

  it('themeless count under a source-focus pin says "selection", not "workspace"', () => {
    // searchDocumentsByTheme scopes to the pin , so "wie viele dokumente habe
    // ich" returns the SELECTION count — the wording must not claim it's the
    // whole workspace.
    const deCount = renderCorpusAnswer('de', 'count', [], [doc(1, 'a.pdf'), doc(2, 'b.pdf')], {
      scoped: true,
    })
    expect(deCount).toContain('in deiner aktuellen Quellen-Auswahl')
    expect(deCount).not.toContain('Workspace')

    const enCount = renderCorpusAnswer('en', 'count', [], [doc(1, 'a.pdf')], { scoped: true })
    expect(enCount).toContain('in your current source selection')
    expect(enCount).not.toContain('workspace')

    const deList = renderCorpusAnswer('de', 'list', [], [doc(1, 'a.pdf')], { scoped: true })
    expect(deList).toContain('aktuellen Quellen-Auswahl')
    expect(deList).not.toContain('Workspace')
  })

  it('EN list with theme', () => {
    const out = renderCorpusAnswer('en', 'list', ['optics'], [doc(1, 'a.pdf'), doc(2, 'b.pdf')])
    expect(out).toContain('These documents cover “optics”:')
  })

  it('EN list singular', () => {
    const out = renderCorpusAnswer('en', 'list', ['optics'], [doc(1, 'a.pdf')])
    expect(out).toContain('This document covers “optics”:')
  })

  it('caps the list and announces the cut — never silent truncation', () => {
    const many = Array.from({ length: CORPUS_LIST_MAX + 7 }, (_, i) => doc(i + 1, `d${i + 1}.pdf`))
    const de = renderCorpusAnswer('de', 'count', ['x'], many)
    expect(de).toContain(`**${CORPUS_LIST_MAX + 7}**`)
    expect(de.match(/\[doc:/g)).toHaveLength(CORPUS_LIST_MAX)
    expect(de).toContain('… und 7 weitere')
    const en = renderCorpusAnswer('en', 'list', ['x'], many)
    expect(en).toContain('… and 7 more')
  })

  it('doc without a first chunk renders without a marker', () => {
    const out = renderCorpusAnswer(
      'en',
      'count',
      [],
      [{ id: 1, title: 'empty.pdf', chunkHits: 0, firstChunkId: null }],
    )
    expect(out).toContain('- empty.pdf')
    expect(out).not.toContain('[doc:')
  })
})
