# DOCX text/heading/table preview

The Rust importer reads OOXML in the same isolated Windows worker used for PDFs:
private pipes, 512 MiB committed memory limit, one process, a 30-second deadline,
cancellation and vault revocation. `zip = 9.7.0` uses only stored/deflate support;
`quick-xml = 0.42.0` resolves XML namespaces. No archive entry is written to disk.

Limits: 16 MiB input, 4,096 ZIP entries, 64 MiB declared total uncompressed size,
8 MiB per selected XML part, 128 XML nesting levels/namespace bindings and 16 MiB
extracted text. Entry names with traversal/absolute/backslash paths and duplicate
entries are rejected. Encrypted ZIPs, DTDs and unknown entity references fail.
Only UTF-8 XML is supported in this preview. No external relationship is fetched.

Word paragraph styles, explicit outline levels and inherited heading styles map
to heading metadata. Paragraph text, tabs, line breaks, Unicode and ordinary
table rows/cells remain source content. Structured sections go directly to the
shared chunker; literal `#` text in a paragraph cannot invent a heading. A
heading-only section is retained. The Markdown projection is also available for
compatibility inspection, but is not reparsed to infer source metadata.

Images/OCR, embedded objects, notes, comments, headers/footers, tracked changes,
numbered lists, fields, hyperlinks, content controls, merged/nested tables and
other rich content currently fail explicitly. This is limited DOCX support, not
Word layout or full Mammoth/OCR parity. The original file is preserved, and a
failure never publishes a partial document or overwrites an existing revision.

The synthetic fixture generator is `native/scripts/docx-fixtures.py`. Rust tests
cover Unicode, inherited headings, table rows, literal Markdown, DTDs, revisions,
lists, images with case-varied part names and custom header references.
`docx-original-compat.ts` runs the actual original Mammoth
pipeline and compares normalized content words and the shared heading. Mammoth
warns about the custom inherited style; the native parser retains that style's
heading. This comparison deliberately does not claim identical escaping or
formatting. Dependencies are documented in THIRD_PARTY_NOTICES.md.

## Manual testing

1. Use a new synthetic native-preview vault and workspace. Import
   `native/crates/documents/tests/fixtures/synthetic.docx`; search `Berlin` and
   `ALPHA`, open sources, and verify Unicode text and the retained content.
2. Import `table.docx`; search `London` and verify the row still associates it
   with `England`. Import `literal.docx` and verify its literal `#` paragraph
   stays text, with heading metadata inherited from Word styles.
3. Import the `dtd.docx`, `revision.docx`, `list.docx`, `image.docx`,
   `uppercase-media.docx` and `header-reference.docx` fixtures.
   Expect visible rejection and no partially imported document. No external
   resource should be fetched. The earlier source IDs and text must survive.
4. Reimport the unchanged successful file; expect no duplicate. Close/reopen and
   verify sources. The automated `LOKLM_TEST_DOCX=1` UI harness checks the same
   synthetic import/error/recovery/reopen path using its compile-time picker.
