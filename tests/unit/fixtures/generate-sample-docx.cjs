/* Generates tests/unit/fixtures/sample.docx — a minimal valid OOXML file with
 * two top-level headings, a sub-heading, and a small table. Run once when the
 * fixture needs to be regenerated:
 *   node tests/unit/fixtures/generate-sample-docx.cjs
 * The .docx output is committed; this script is committed for reproducibility
 * but not run during tests.
 *
 * Uses jszip via mammoth's transitive dep (no extra package needed).
 */
const path = require('path')
const fs = require('fs')

// jszip ships with mammoth — resolve via mammoth's node_modules so we don't
// need a direct jszip dependency.
const mammothDir = path.dirname(require.resolve('mammoth/package.json'))
const jszipPath = path.join(mammothDir, '..', '..', '..', '.pnpm')
// Fallback: just require by name; pnpm flattens it for us in modern setups.
let JSZip
try {
  JSZip = require('jszip')
} catch {
  // Use the path we found earlier in this repo.
  JSZip = require(path.join(__dirname, '..', '..', '..', 'node_modules', '.pnpm', 'jszip@3.10.1', 'node_modules', 'jszip', 'lib', 'index.js'))
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

// Define Heading 1 / Heading 2 styles so mammoth maps them to # / ##.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`

const para = (text, styleId) => {
  const stylePart = styleId ? `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>` : ''
  return `<w:p>${stylePart}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
}

const cell = (text) => `<w:tc><w:tcPr/>${para(text)}</w:tc>`
const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${para('Einführung', 'Heading1')}
    ${para('Dies ist ein Absatz unter Einführung. Erste zeile auf deutsch.')}
    ${para('Hintergrund', 'Heading2')}
    ${para('Second paragraph in english below a sub-heading.')}
    ${para('Methoden', 'Heading1')}
    ${para('Ein dritter Absatz mit ein bisschen mehr Inhalt damit der Chunker etwas zu tun hat.')}
    <w:tbl>
      <w:tblPr/>
      <w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
      ${row(['Spalte A', 'Spalte B'])}
      ${row(['Wert 1', 'Wert 2'])}
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`

async function main() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.folder('_rels').file('.rels', RELS)
  zip.folder('word').file('document.xml', DOCUMENT)
  zip.folder('word').file('styles.xml', STYLES)
  zip.folder('word/_rels').file('document.xml.rels', DOC_RELS)
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const out = path.join(__dirname, 'sample.docx')
  fs.writeFileSync(out, buf)
  console.log(`wrote ${out} (${buf.length} bytes)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
