// Synthetic expansion fixture, never sent to an in-process parser. Memory while
// generating is bounded by stream backpressure; the target worker has a 512 MiB
// Windows Job Object. No personal files, GPU, ports or persistent source data.
import {Readable} from 'node:stream'
import {createDeflate} from 'node:zlib'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
const chunk=Buffer.alloc(64*1024,32)
const source=Readable.from((function*(){for(let i=0;i<8192;i++)yield chunk})())
const compressed=[]
for await(const part of source.pipe(createDeflate()))compressed.push(part)
const data=Buffer.concat(compressed)
const objects=[
  Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
  Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
  Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>'),
  Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`),data,Buffer.from('\nendstream')]),
]
const parts=[Buffer.from('%PDF-1.4\n')];const offsets=[];let length=parts[0].length
for(const [i,object] of objects.entries()){offsets.push(length);const part=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);parts.push(part);length+=part.length}
parts.push(Buffer.from(`xref\n0 5\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
await mkdir('native/artifacts',{recursive:true})
const path=resolve('native/artifacts/pdf-expansion.pdf');await writeFile(path,Buffer.concat(parts))
const result=spawnSync(resolve('native/target/debug/examples/isolated.exe'),['--stress',path],{windowsHide:true,encoding:'utf8',timeout:45000,maxBuffer:1024*1024})
if(result.status!==0)throw new Error(`Isolated stress test failed: ${result.error?.message??result.stderr}`)
console.log(result.stdout.trim())
await writeFile('native/artifacts/pdf-stress-result.json',JSON.stringify({passed:true,expandedBytes:512*1024*1024,compressedBytes:data.length,scope:'One synthetic compressed expansion case; isolated rejection plus concurrent cancel/session lock and reaping. Not comprehensive PDF fuzzing.'},null,2))
