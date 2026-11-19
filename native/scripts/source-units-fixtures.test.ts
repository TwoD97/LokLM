import {afterAll,it,vi} from 'vitest'
import {writeFile} from 'node:fs/promises'
import type {SourceUnitPassage} from '../../src/main/services/qa/sourceUnits'
const {cases}=vi.hoisted(()=>({cases:[] as unknown[]}))
vi.mock('../../src/main/services/qa/sourceUnits',async importOriginal=>{
  const original=await importOriginal<typeof import('../../src/main/services/qa/sourceUnits')>()
  return {...original,createSourceUnitCatalog(input:readonly SourceUnitPassage[]){
    const result=original.createSourceUnitCatalog(input)
    const expected=result.ok?{ok:true,units:result.units,labelled:input.map(p=>result.promptSourceText(p.document_id,p.chunk_id))}:result
    cases.push({input:structuredClone(input),expected})
    return result
  }}
})
await import('../../tests/unit/source-units.test')
it('records DE/EN ICU segmentation and structured source boundaries',async()=>{
  const {createSourceUnitCatalog:create}=await import('../../src/main/services/qa/sourceUnits')
  const texts=[
    'Ein Messwert beträgt 2,25 m³. Das gilt nur für Mitglieder. Ohne Freigabe gilt dies nicht!',
    'The setting is 18.5 units. It applies only after approval. The proposal is not approved.',
    'Das ist z. B. eine Ausnahme. Nicht jede Person ist berechtigt.',
    'Mr. Green reports 18. The approval is still pending.',
    'Wait... What happened? “Nothing.” Then proceed.',
    'Preis: 18 €. Am 19. November gilt eine Ausnahme.',
    'Look at Fig. 5. This caption qualifies the text.',
    'A. Person owns it. B. Person proposed another value.',
    '第一句。第二句！ 🧪 Third sentence.',
    'Literal <script> text. This is not executable.',
    '|Name|Value|\n|---|---|\n|Berlin|18.5|\n',
    '# Header\nParagraph. More text.\n\nNext paragraph.',
    '- One.\n\n  Qualified only with approval.\n\nOutside sentence. Next sentence.',
    '```text\nOne.\n\nTwo.\n````\n\nAfter the fence.',
    '~~~text\nOne.\n\nTwo.\n~~~not closing\n\nStill fenced.',
    '① One sentence. ② Another sentence. Required qualifiers remain.',
  ]
  for(const text of texts)for(const newline of ['\n','\r\n','\r','\u2028','\u2029']){
    create([{document_id:1,chunk_id:10,text:text.replaceAll('\n',newline)}])
  }
  create([{document_id:1,chunk_id:10,text:'One sentence.\u0085Then text.\ufeffQualifies it.'}])
})
afterAll(async()=>{
  await writeFile('native/crates/core/tests/fixtures/original-source-units.json',JSON.stringify({runtime:{node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode},cases},null,2)+'\n')
})
