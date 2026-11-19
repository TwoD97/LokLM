// Frozen outputs from the actual original pure provenance helpers, no models.
import {writeFile} from 'node:fs/promises'
import console from 'node:console'
import {anchorSourceQuote,expandSourceQuoteContext} from '../../src/main/services/qa/sourceQuote'
import {createSourceQuoteResolver} from '../../src/main/services/qa/sourceQuoteResolver'
const pairs:[string,string][]=[
 ['Berlin ist die Hauptstadt.','Berlin'],
 ['🚀  Grüße\n  Berlin. Nur mit Freigabe.','Grüße Berlin.'],
 ['Before.\r\nSecond line applies.\r\n\r\nNext paragraph.','Second line applies.'],
 ['Before.\r\nSecond line applies.\r\n\r\nNext paragraph.','applies. Next'],
 ['\ufeffA\tB\u00a0',' A B '],
 ['A\u0085B','A B'],
 ['A\u2007\u2028\u3000B','A B'],
 ['Same phrase. Same phrase.','Same phrase.'],
 ['ababa','aba'],
 ['A'+' '.repeat(500)+'B | A B','A B'],
 ['A'+' '.repeat(500)+'B','A B'],
 ['Rule applies only after approval.','Rule applies.'],
 ['Rule applies only after approval.','rule applies'],
 ['Rule applies only after approval.','Rule ... approval.'],
 ['Äpfel','A\u0308pfel'],
 ['Source code:\n   ```rust\nlet x = 1;\n```\nAfter.','let x = 1;'],
 ['word '.repeat(200)+'target','target'],
 ['x'.repeat(63997)+'END','END'],
 ['x'.repeat(64000)+'END','END'],
 ['🚀'.repeat(200),'🚀'.repeat(200)],
 ['🚀'.repeat(201),'🚀'.repeat(201)],
 ['Anything','   '],
 ['A\nB','AB'],
 ['Before\r\n\r\n  target  \r\n\r\nAfter','target'],
]
const anchors=pairs.map(([source,proposed])=>{const anchor=anchorSourceQuote(source,proposed);return {source,proposed,anchor,expanded:anchor?expandSourceQuoteContext(source,anchor):null}})
const catalogs=[
 [{document_id:1,chunk_id:1,text:'A is 7. B is 9.'},{document_id:2,chunk_id:4,text:'Only after approval.'}],
 [{document_id:1,chunk_id:1,text:'A is 7.'},{document_id:2,chunk_id:4,text:'A is 7.'}],
 [{document_id:1,chunk_id:1,text:'A is 7. A is 7.'}],
 [{document_id:1,chunk_id:1,text:'A'+' '.repeat(500)+'B'},{document_id:2,chunk_id:1,text:'A B'}],
 [{document_id:1,chunk_id:1,text:'A is 7.'},{document_id:1,chunk_id:1,text:'Different'}],
 [{document_id:0,chunk_id:1,text:'A is 7.'}],
 [{document_id:Number.MAX_SAFE_INTEGER+1,chunk_id:1,text:'A is 7.'}],
 [{document_id:1,chunk_id:1,text:'\ufeff'}],
 [],
 Array.from({length:33},(_,i)=>({document_id:i+1,chunk_id:1,text:'A is 7.'})),
 Array.from({length:5},(_,i)=>({document_id:i+1,chunk_id:1,text:'x'.repeat(64000)})),
]
const queries=['A is 7.','Only after approval.','A B','a is 7.','missing','   ','🚀'.repeat(201)]
const resolvers=catalogs.map(input=>{const resolver=createSourceQuoteResolver(input);return {input,valid:!!resolver,results:resolver?queries.map(proposed=>({proposed,result:resolver(proposed)})):[]}})
await writeFile('native/crates/core/tests/fixtures/original-source-quotes.json',JSON.stringify({sourceRevision:'4651557',anchors,resolvers},null,2)+'\n')
console.log(`Generated ${anchors.length} anchors and ${resolvers.length} original resolver catalogs`)
