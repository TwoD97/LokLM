/** Recognize only a final, explicit EN/DE single-sentence imperative.
 * This deliberately declines questions with possible quoted/code/HTML/math
 * literals rather than interpreting them as active formatting instructions.
 * It selects an eligible response shape, not a sentence counter or a semantic
 * determination that the question is answerable. */
export function requestsSingleSentence(question: string): boolean {
  if (/[`'"<>$“”„‟‘’‚‛«»‹›]/u.test(question) || question.includes('~~~')) return false
  const trimmed = question.trimEnd()
  const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1)
  if (/^(?: {4}|\t)/u.test(lastLine)) return false
  // Require a complete separate instruction, not a fragment of a question,
  // negated imperative, source title, or a colon-introduced example.
  return /(?:^|[.!?][ \t\r\n]+)(?:(?:please[ \t]+)?(?:answer|respond|reply)[ \t]+in[ \t]+(?:one|a[ \t]+single)[ \t]+(?:short[ \t]+)?sentence|(?:bitte[ \t]+)?(?:antworte|beantworte[ \t]+(?:die|diese)[ \t]+frage)[ \t]+in[ \t]+einem[ \t]+(?:kurzen[ \t]+)?satz)[.!]?[ \t]*$/iu.test(
    trimmed,
  )
}
