import type { RetrievalHit } from '../../../shared/documents'
import { findCitationAttempts } from '../../../shared/citationMarkers'

/** Visible-answer bounds and supplied-source membership only. This deliberately
 * does not claim to verify entailment, authority, or complete claim attribution. */
export function validateVisibleAnswer(
  answer: unknown,
  hits: readonly Pick<RetrievalHit, 'document_id' | 'chunk_id'>[],
  maxAnswerChars: number,
): string | null {
  if (
    !Number.isSafeInteger(maxAnswerChars) ||
    maxAnswerChars < 1 ||
    maxAnswerChars > 32_000 ||
    typeof answer !== 'string' ||
    !answer.trim() ||
    Array.from(answer).length > maxAnswerChars
  )
    return null
  const supplied = new Set(hits.map((hit) => `${hit.document_id}:${hit.chunk_id}`))
  if (
    findCitationAttempts(answer).some(
      (marker) =>
        !Number.isSafeInteger(marker.documentId) ||
        marker.documentId <= 0 ||
        !Number.isSafeInteger(marker.chunkId) ||
        marker.chunkId <= 0 ||
        !supplied.has(`${marker.documentId}:${marker.chunkId}`),
    ) ||
    /#cite-/iu.test(answer)
  )
    return null
  return answer
}
