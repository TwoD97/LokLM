// Reads a COPY of the synthetic native-ui vault through the original engine.
import {readFile,cp,mkdtemp,writeFile} from 'node:fs/promises'
import {resolve,join,basename} from 'node:path'
import {tmpdir} from 'node:os'
import assert from 'node:assert/strict'
import {AuthService} from '../../src/main/services/auth/AuthService'
const phase=JSON.parse(await readFile('native/artifacts/native-ui-phase.json','utf8'))
const source=resolve(phase.profile)
assert.equal(resolve(source,'..'),resolve('native/artifacts'))
assert.match(basename(source),/^native-ui-/)
const destination=join(await mkdtemp(join(tmpdir(),'loklm-native-copy-')),'vault')
await cp(join(source,'vault'),destination,{recursive:true,errorOnExist:true,force:false})
const auth=new AuthService(destination)
try{
 await auth.login('Replacement-desktop-49!') // public synthetic harness credential
 const db=await auth.getWorkspaceDb(1)
 const docs=await db.listDocuments()
 assert.equal(docs.length,1)
 assert.equal(docs[0]!.title,'Überblick Berlin.md')
 await writeFile('native/artifacts/native-original-roundtrip.json',JSON.stringify({passed:true,documents:docs.length,scope:'Original AuthService and sqlite3mc read copied native-created v6 vault after native password recovery; synthetic data only.'},null,2))
 console.log('Original engine opened native-created vault and indexed document')
}finally{await auth.lock()}
