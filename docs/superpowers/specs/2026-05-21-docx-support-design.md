# DOCX Support — Design

**Date:** 2026-05-21
**Status:** Approved, ready for inline implementation
**Author:** Denys Tudosa (with Claude)

## Goal

Allow workspaces to import `.docx` (Word OOXML) files alongside the existing PDF / Markdown / plain-text formats. Imported `.docx` files participate in RAG retrieval with heading-based citations and render in the existing SourceViewer when a citation is clicked.

Out of scope:
- Legacy `.doc` binary format (Word 97–2003).
- Library-level document preview (clicking a row to view a doc outside the citation flow). A separate feature.
- Faithful full-fidelity rendering (page breaks, headers/footers, comments, tracked changes, embedded images).

## Decisions

1. **Parsing**: Use `mammoth` to convert `.docx` → markdown at import time. The result flows into the existing `parseMarkdownSections` + `chunkMarkdown` pipeline.
2. **Chunking**: No new chunker. DOCX uses the existing markdown section-aware chunking. Citations come out as `§ Heading 1 › Heading 2` breadcrumbs (no page numbers — DOCX pagination is reflow-dependent and not stable across viewers).
3. **Preview**: Reuse the SourceViewer's existing markdown branch (react-markdown + remarkGfm). No new viewer component, no `dangerouslySetInnerHTML`, no separate HTML pipeline.
4. **Embedded images**: Stripped at parse time via mammoth's `convertImage` no-op. RAG doesn't use them, and they'd bloat both embeddings and chunk text.

## Architecture

### Component changes

| File | Change |
|------|--------|
| `package.json` | Add `mammoth` dependency. |
| `src/main/services/documents/parser.ts` | Add `.docx` extension handling. New `parseDocx(filePath)` returns a `ParsedDocument` with `kind: 'markdown'`. |
| `src/main/services/documents/DocumentService.ts` | Extend `mimeFromExt` with the OOXML MIME (`application/vnd.openxmlformats-officedocument.wordprocessingml.document`). |
| `src/renderer/src/chat/SourceViewer.tsx` | Extend `pickBodyMode` to treat `.docx` (and its MIME) as the `'markdown'` body mode. |
| `tests/unit/parser.test.ts` | Replace the "rejects docx" assertion with positive coverage; add fixture-based parse tests. |
| `tests/unit/fixtures/` | Add a small `sample.docx` fixture (a few paragraphs with headings + a table). |

### Data flow

```
import('foo.docx')
  └─ DocumentService.importFile
      └─ parseFile (parser.ts)
          └─ parseDocx
              └─ mammoth.convertToMarkdown({ buffer, convertImage: noop })
              └─ parseMarkdownSections(markdown)
              └─ returns { kind: 'markdown', sections, pages, fullText }
      └─ chunkMarkdown(sections)              // existing
      └─ embedder.embed(chunks)               // existing
      └─ persistChunks(...)                   // existing, headingPath populated

retrieve('foo.docx' chunk)
  └─ SourceViewer
      └─ pickBodyMode(source) → 'markdown'    // new branch for .docx mime/ext
      └─ getChunkWithContext(...)              // existing
      └─ react-markdown(chunk.text)            // existing markdown branch
```

### Why this shape

- **Markdown as the common middle representation** lets DOCX inherit the citation breadcrumb behavior we already trust for Markdown files. Adding a `'docx'` `ParsedDocument` kind would have meant duplicating both a chunker and a preview branch for the same outcome.
- **No HTML preview pipeline** means no DOMPurify dependency, no `dangerouslySetInnerHTML`, no IPC endpoint for HTML, and no second mammoth invocation at preview time. We render the markdown the user is going to be cited from — same text, same component, same code path as Markdown files.
- **Image stripping** at parse time is one option flag on mammoth, applied where the text first enters our pipeline. RAG never sees them; preview doesn't show them; storage doesn't carry them. If we want image previews later, that's a follow-up decision.

## Parser behavior

`parseDocx(filePath: string): Promise<ParsedDocument>`:
1. `await readFile(filePath)` → Buffer
2. `mammoth.convertToMarkdown({ buffer })` — produces markdown with `#`/`##`/`###` headings derived from Word Heading 1/2/3 styles, markdown tables for tables, ordered/unordered lists, bold/italic. Embedded images are stripped (either via mammoth's image-converter option or by post-processing `![...](...)` lines out of the result — the exact mechanism is an implementation detail). Warnings collected in the `messages` array are logged via `console.warn` (same convention as `parser.ts`'s PDF outline failures).
3. `const sections = parseMarkdownSections(markdown)` — existing function.
4. `const fullText = stripFrontmatter(markdown)` — no-op for DOCX (it has no `---` frontmatter) but keeps the pipeline uniform.
5. Return `{ kind: 'markdown', sections, pages: [{ num: 1, text: fullText }], fullText }`.

`isSupported(filePath)` returns true for `.docx`. `.doc` and other Word variants stay false.

## Preview behavior

`SourceViewer.pickBodyMode` extends to:

```ts
function pickBodyMode(source: ChunkSource | null): BodyMode {
  if (!source) return 'text'
  const path = (source.sourcePath ?? '').toLowerCase()
  if (source.mimeType === 'application/pdf' || path.endsWith('.pdf')) return 'pdf'
  if (
    source.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    path.endsWith('.docx') ||
    path.endsWith('.md') ||
    path.endsWith('.markdown')
  ) return 'markdown'
  return 'text'
}
```

Existing markdown rendering handles the rest: target chunk + neighbors via `getChunkWithContext`, each rendered through `<ReactMarkdown remarkPlugins={[remarkGfm]}>`, target chunk gets the `--cited` highlight. Heading breadcrumb in the header is already wired to `source.headingPath`.

## Edge cases

- **DOCX with no headings**: `parseMarkdownSections` produces a single preamble section with `headingPath: []`. Chunks get `headingPath: null`. Header shows just the title. Consistent with current behavior for a heading-less Markdown file.
- **`.doc` (legacy binary)**: `isSupported` returns false; `importFile` throws `ImportError('unsupported', ...)`. Same path any unknown extension hits today.
- **Mammoth conversion warnings** (unsupported styles, dropped elements): logged via `console.warn`, not surfaced to the user. Matches the existing PDF outline failure handling.
- **Oversized tables**: a table that pushes its containing section past `maxChars` is split by the existing separator cascade in `chunkMarkdown`. Each fragment retains the section's `headingPath`. We accept that mid-table splits are ugly in preview rather than building DOCX-specific table handling now.
- **Footnotes**: mammoth emits them as a numbered list appended to the document end. They fall into the last section's chunks and embed/render like any other text. Acceptable for v1.
- **File size**: reuses the existing 50 MB import limit (`MAX_IMPORT_BYTES`). No DOCX-specific cap.

## Testing

`tests/unit/parser.test.ts`:
1. Replace `it('rejects docx (deferred to v0.3)')` with `it('accepts docx')` asserting `isSupported('foo.docx') === true`.
2. Add `describe('parseFile (docx)')` block:
   - Parses a fixture with headings → returns `kind: 'markdown'`, at least one section with a non-empty `headingPath`, `fullText` contains expected body text.
   - Parses a fixture without headings → returns `kind: 'markdown'` with one section, `headingPath: []`.
   - `.doc` (legacy) is rejected by `isSupported`.

Fixture: `tests/unit/fixtures/sample.docx` — a small Word document with two top-level headings, a sub-heading, a paragraph under each, and one small table. Generated once and committed (binary; ~10 KB).

## What does NOT change

- Database schema. DOCX chunks persist with `mime_type` = OOXML, `heading_path` populated, `page_from`/`page_to` null. No migration.
- `chunker.ts`, `markdownParser.ts`. Untouched.
- `LibraryView.tsx`, `DocumentTable.tsx`. Untouched. The existing `DropZone` and "Pick files" dialog accept whatever `isSupported` returns true for; no UI wording needs to change unless we want to advertise DOCX support — minor copy tweak, optional.
- Embedding / retrieval / reranking. DOCX chunks look identical to Markdown chunks downstream.

## Implementation order

1. `pnpm add mammoth` + typings.
2. `parser.ts`: extend `isSupported`, add `parseDocx`, route `.docx` in `parseFile`.
3. `DocumentService.ts`: extend `mimeFromExt`.
4. `SourceViewer.tsx`: extend `pickBodyMode`.
5. `parser.test.ts`: update tests, add DOCX fixture.
6. Typecheck, run tests, build.
