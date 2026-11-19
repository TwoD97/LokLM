// Actual original mammoth pipeline versus native text/heading extraction.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {parseFile} from '../../src/main/services/documents/parser'
const file=resolve('native/crates/documents/tests/fixtures/synthetic.docx')
const original=await parseFile(file,{onOcrProgress:()=>{throw new Error('Unexpected OCR')}})
const result=spawnSync(resolve('native/target/debug/examples/isolated.exe'),['--loklm-docx-worker-v1'],{input:await readFile(file),windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024})
assert.equal(result.status,0)
const native=JSON.parse(result.stdout).Ok as {markdown:string}
// Markdown escaping differs; compare content words without treating source tags
// as markup and separately require the original shared heading.
const words=(s:string)=>s.replace(/\\([^\p{L}\p{N}\s])/gu,'$1').replace(/#+\s*/g,'').split(/\s+/).filter(Boolean)
assert.deepEqual(words(original.fullText),words(native.markdown))
assert.match(native.markdown,/^# Reisen\n/)
await writeFile('native/artifacts/docx-original-compat.json',JSON.stringify({passed:true,scope:'Original parseFile/mammoth versus Rust on synthetic text/headings; normalized words match. Style/formatting/table/OCR equivalence is not claimed.'},null,2))
console.log('Original and native DOCX parsers preserve synthetic DE/EN words and heading')
