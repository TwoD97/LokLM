// Run the real upstream synthetic unit tests while recording pure helper I/O.
import {afterAll,it,vi} from 'vitest'
import {writeFile} from 'node:fs/promises'
import type {CalculationPassage} from '../../src/main/services/qa/sourceCalculations'
const {cases}=vi.hoisted(()=>({cases:[] as unknown[]}))
vi.mock('../../src/main/services/qa/sourceCalculations',async importOriginal=>{
  const original=await importOriginal<typeof import('../../src/main/services/qa/sourceCalculations')>()
  return {...original,sourceCalculationAnnotations(question:string,passages:readonly CalculationPassage[]){
    const expected=original.sourceCalculationAnnotations(question,passages)
    cases.push({question,passages,expected})
    return expected
  }}
})
await import('../../tests/unit/source-calculations.test')
it('records floating-point edges and complete-source boundaries',async()=>{
  const {sourceCalculationAnnotations:annotate}=await import('../../src/main/services/qa/sourceCalculations')
  for(const value of ['-0','-0.1','-0.5','-1.5','0.49999999999999994','0.5000000000000001','1e21','1e-7','1e-6','1e-324','-1e-324','1000000000000000100','1.7976931348623157e308']){
    for(const expression of ['value','Math.round(value)','Math.min(value, 0)','Math.max(value, -0)','value * 2','value / 3']){
      annotate(`clip(${value})`,[{document_id:7,chunk_id:11,document_title:'edge.ts',text:`function clip(value) { return ${expression} }`}])
    }
  }
  for(const newline of ['\n','\r\n','\r','\u2028','\u2029']){
    const declaration='function clip(value) { return value + 1 }'
    for(const text of [newline+declaration,`/*comment\u0085*/${newline}${declaration}`,`# Document${newline}~~~ts\n${declaration}\n~~~${newline}`]){
      annotate('🚀 clip(9)',[{document_id:7,chunk_id:11,document_title:text.includes('~~~')?'edge.md':'edge.ts',text}])
    }
  }
  // Deterministic finite IEEE-754 samples check decimal parsing/formatting too.
  let bits=0x4c6f6b4c4d202607n
  const buffer=new DataView(new ArrayBuffer(8))
  for(let i=0;i<128;i++){
    bits=BigInt.asUintN(64,bits*6364136223846793005n+1442695040888963407n)
    buffer.setBigUint64(0,bits)
    const value=buffer.getFloat64(0)
    if(Number.isFinite(value))annotate(`clip(${value})`,[{document_id:7,chunk_id:11,document_title:'float.ts',text:'function clip(value) { return value }'}])
  }
})
afterAll(async()=>{
  await writeFile('native/crates/core/tests/fixtures/original-source-calculations.json',JSON.stringify(cases,null,2)+'\n')
})
