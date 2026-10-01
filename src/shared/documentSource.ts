/** Generated notes/translations/transcripts have a durable encrypted text
 * source inside their workspace, but no original file on the filesystem. */
export const GENERATED_DOCUMENT_SOURCE_PREFIX = 'loklm-generated:'

export function isGeneratedDocumentSource(sourcePath: string): boolean {
  return sourcePath.startsWith(GENERATED_DOCUMENT_SOURCE_PREFIX)
}
