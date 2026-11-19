// Compare the actual original parser with Rust on one public synthetic fixture.
// Both pages exceed the original OCR threshold; no model or OCR job is launched.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
import {parseFile} from '../../src/main/services/documents/parser'
const file=resolve('native/crates/documents/tests/fixtures/synthetic.pdf')
const original=await parseFile(file,{onOcrProgress:()=>{throw new Error('Unexpected OCR in text fixture')}})
const result=spawnSync(resolve('native/target/debug/examples/isolated.exe'),['--loklm-pdf-worker-v1'],{input:await readFile(file),windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:1024*1024})
assert.equal(result.status,0)
const native=JSON.parse(result.stdout).Ok as {pages:[number,string][]}
assert.equal(original.pages.length,native.pages.length)
const normalized=(text:string)=>text.replace(/\s+/g,' ').trim()
for(const [index,page] of original.pages.entries()){
 assert.equal(page.num,native.pages[index]![0])
 assert.equal(normalized(page.text),normalized(native.pages[index]![1]))
}
await writeFile('native/artifacts/pdf-original-compat.json',JSON.stringify({passed:true,pages:native.pages.length,scope:'Actual original parseFile/pdfjs versus Rust pdf-extract on synthetic DE/EN text-layer PDF; whitespace-normalized text and exact page numbers. Not broad PDF/OCR equivalence.'},null,2))
console.log('Original and native PDF parsers agree on synthetic two-page DE/EN text and page identity')
