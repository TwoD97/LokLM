// Evaluate original pure TypeScript arithmetic; no model or user data involved.
import console from 'node:console'
import {readFile,writeFile} from 'node:fs/promises'
import ts from 'typescript'
import {sourceQuantityAnnotations,type SourceQuantityPassage} from '../../src/main/services/qa/sourceQuantities'
const source=ts.createSourceFile('source-quantities.test.ts',await readFile('tests/unit/source-quantities.test.ts','utf8'),ts.ScriptTarget.Latest,true)
const literals:string[]=[]
function visit(node:ts.Node):void {
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='each'){
    const array=node.arguments[0]
    if(array&&ts.isArrayLiteralExpression(array))for(const element of array.elements){
      const value=ts.isArrayLiteralExpression(element)?element.elements[0]:element
      if(value&&ts.isStringLiteral(value))literals.push(value.text)
    }
  }
  ts.forEachChild(node,visit)
}
visit(source)
const passage=(text:string,document_id=7,chunk_id=41):SourceQuantityPassage=>({text,document_id,chunk_id})
const catalogs:SourceQuantityPassage[][]=[...new Set(literals)].map(text=>[passage(text)])
for(const prefix of ['🚀 ','α','²','_','\n','\r\n','€\n','about\ufeff','about\u0085','about\u2028','1 h ','1 h\n','USD\u202f','word:']){
  for(const suffix of ['.','\n','\nminutes','\u2009per hour',' USD','x','²','\u0301','; 2 m.']){
    catalogs.push([passage(prefix+'90 s'+suffix)])
  }
}
catalogs.push(...[
  ['🧪 The measured volume is 2.25 cubic metres.','Die gemessene Menge ist 2250 Liter.','Eine Probe enthält 2,25\u2009L.'],
  ['First, 25 L. Then wait\u200990\u2009s. Volume:\u202f2,25\u202fm³.'],
  ['Thickness:3mm. Price: €5. Revenue is reported in USD.'],
  ['A: 90 s; B: 1.6 min; C: 90 m; D: 90 g.'],
  ['1 Millisekunde; 2 Sekunden; 3 Minuten; 4 Stunden; 5 Tage; 6 Tagen; 90s; 12cm; 8kg.'],
  ['The first delay is 90 seconds; the other delay is 1.5 minutes.'],
  ['🚀\r\nDelay: 0.00000000000000001 ms.'],
  ['999999999999999999 days; 0 h; 90 s.'],
  ['5 s; '.repeat(100)],
  ['5 s '+'x'.repeat(16000)],
].map(texts=>texts.map((s,i)=>passage(s,i+1,i+100))))
catalogs.push([passage('5 s'),passage('5 s')],[passage('5 s'),passage('6 s')],
  [passage('5 s',0),passage('5 s',-1),passage('5 s',9007199254740992)],
  [passage('5 s'),passage('5 s '+'x'.repeat(16000)),passage('5 s')],
  Array.from({length:17},(_,i)=>passage('5 s',i+1)),
  Array.from({length:5},(_,i)=>passage('5 s.'+' '.repeat(15996),i+1)),
  [passage('5'+'\t'.repeat(8000)+'s')])
const fixtures=catalogs.map(input=>({input,expected:sourceQuantityAnnotations(input)}))
await writeFile('native/crates/core/tests/fixtures/original-source-quantities.json',JSON.stringify(fixtures,null,2)+'\n')
console.log(`Wrote ${fixtures.length} original arithmetic cases`)
