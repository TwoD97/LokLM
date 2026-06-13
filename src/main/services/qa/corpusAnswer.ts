import type { ResponseLanguage } from '../llm/prompt'

// Templated corpus-route answer — deliberately NO LLM call (ADR-0003 ,
// RAGFlow's hardcoded COUNT(*) + GraphRAG's no-LLM refusal both validate
// this): a count is exact or it is wrong , and a 2–9B model paraphrasing a
// number it was just told is pure downside. The list lines carry standard
// [doc:X, chunk:Y] markers (each doc's first chunk) so the existing chip
// pipeline , persistence reconciliation and SourceViewer work unchanged.

export interface CorpusDoc {
  id: number
  title: string
  chunkHits: number
  firstChunkId: number | null
}

/** Cap the rendered list. Counts always state the full N; the cap only
 *  bounds the bullet list so a 300-doc workspace doesn't produce a wall of
 *  chips. The cut is announced ("… und 280 weitere") — never silent. */
export const CORPUS_LIST_MAX = 20

export function renderCorpusAnswer(
  lang: ResponseLanguage,
  intent: 'count' | 'list',
  themeTokens: string[],
  docs: ReadonlyArray<CorpusDoc>,
  /** When the conversation has a source-focus pin , searchDocumentsByTheme is
   *  scoped to it — so a themeless count is a count of the SELECTION , not the
   *  workspace. Switches the no-theme wording so the number stays truthful. */
  opts: { scoped?: boolean } = {},
): string {
  const theme = themeTokens.join(' ')
  const scoped = opts.scoped ?? false
  const n = docs.length
  const shown = docs.slice(0, CORPUS_LIST_MAX)
  const rest = n - shown.length

  const lines = shown.map((d) => {
    const marker = d.firstChunkId != null ? ` [doc:${d.id}, chunk:${d.firstChunkId}]` : ''
    return `- ${d.title}${marker}`
  })

  let lead: string
  if (lang === 'de') {
    const noun = n === 1 ? 'Dokument' : 'Dokumente'
    const scope = scoped ? 'in deiner aktuellen Quellen-Auswahl' : 'in diesem Workspace'
    lead =
      intent === 'count'
        ? theme
          ? `Du hast **${n}** ${noun} zum Thema „${theme}“:`
          : `Du hast insgesamt **${n}** ${noun} ${scope}:`
        : theme
          ? n === 1
            ? `Dieses Dokument behandelt „${theme}“:`
            : `Diese Dokumente behandeln „${theme}“:`
          : scoped
            ? `Deine ${noun} in der aktuellen Quellen-Auswahl:`
            : `Deine ${noun} in diesem Workspace:`
    if (rest > 0) lines.push(`- … und ${rest} weitere`)
  } else {
    const noun = n === 1 ? 'document' : 'documents'
    const scope = scoped ? 'in your current source selection' : 'in this workspace'
    lead =
      intent === 'count'
        ? theme
          ? `You have **${n}** ${noun} about “${theme}”:`
          : `You have **${n}** ${noun} ${scope}:`
        : theme
          ? n === 1
            ? `This document covers “${theme}”:`
            : `These documents cover “${theme}”:`
          : `Your ${noun} ${scoped ? 'in the current source selection' : 'in this workspace'}:`
    if (rest > 0) lines.push(`- … and ${rest} more`)
  }

  return `${lead}\n\n${lines.join('\n')}`
}
