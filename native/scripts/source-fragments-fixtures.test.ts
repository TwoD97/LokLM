import {afterAll,vi} from 'vitest'
import {writeFile} from 'node:fs/promises'
const {cases,encoded}=vi.hoisted(()=>({cases:[] as unknown[],encoded:(value:unknown)=>typeof value==='string'?{units:Array.from({length:value.length},(_,i)=>value.charCodeAt(i))}:{nonString:true}}))
vi.mock('../../src/main/services/qa/sourceFragments',async importOriginal=>{
  const original=await importOriginal<typeof import('../../src/main/services/qa/sourceFragments')>()
  const factory=(kind:'fragment'|'excerpt',source:string)=>{
    const match=kind==='fragment'?original.createSourceFragmentMatcher(source):original.createSourceExcerptMatcher(source)
    return (value:unknown,max=160,onReject?:Parameters<typeof match>[2])=>{
      let rejection:string|null=null
      const expected=match(value,max,reason=>{rejection=reason;onReject?.(reason)})
      cases.push({kind,source:encoded(source),value:encoded(value),max,expected,rejection})
      return expected
    }
  }
  return {...original,
    createSourceFragmentMatcher:(source:string)=>factory('fragment',source),
    createSourceExcerptMatcher:(source:string)=>factory('excerpt',source),
    isDisplayFragment:(value:unknown,max:number,title=false)=>{
      const expected=original.isDisplayFragment(value,max,title)
      cases.push({kind:'display',value:encoded(value),max,title,expected})
      return expected
    },
  }
})
await import('../../tests/unit/source-fragments.test')
afterAll(async()=>{
  await writeFile('native/crates/core/tests/fixtures/original-source-fragments.json',JSON.stringify({runtime:{node:process.versions.node,icu:process.versions.icu,unicode:process.versions.unicode},cases},null,2)+'\n')
})
