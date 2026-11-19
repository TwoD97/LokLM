// Actual generator lock/revocation check on a COPY of the public synthetic UI
// fixture. Never discovers a user vault or connects to shared model services.
import {chromium,expect} from '@playwright/test'
import {readFile,mkdtemp,cp,writeFile} from 'node:fs/promises'
import {resolve,join,basename} from 'node:path'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
const phase=JSON.parse(await readFile('native/artifacts/native-ui-phase.json','utf8'))
const source=resolve(phase.profile)
assert.equal(resolve(source,'..'),resolve('native/artifacts'))
assert.match(basename(source),/^native-ui-/)
assert.equal(phase.name,'reopened-search-passed')
assert.ok(process.env.LOKLM_TEST_MODELS_DIR,'Explicit model directory required')
const profile=await mkdtemp(resolve('native/artifacts/native-ui-stream-lock-'))
await cp(join(source,'vault'),join(profile,'vault'),{recursive:true,errorOnExist:true,force:false})
const child=spawn(resolve('native/artifacts/loklm-native-ui-test.exe'),[],{windowsHide:true,stdio:'ignore',env:{...process.env,LOKLM_NATIVE_DATA_DIR:join(profile,'vault'),LOKLM_NATIVE_TEST_MODELS_DIR:process.env.LOKLM_TEST_MODELS_DIR,WEBVIEW2_USER_DATA_FOLDER:join(profile,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'}})
let browser,page
try{
 let port;const deadline=Date.now()+30000
 while(Date.now()<deadline){try{port=Number((await readFile(join(profile,'webview/EBWebView/DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{}await new Promise(r=>setTimeout(r,50))}
 assert.ok(port)
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0]
 await page.getByLabel('Password',{exact:true}).fill('Replacement-desktop-49!')
 await page.getByRole('button',{name:'Unlock',exact:true}).click()
 await expect(page.getByLabel('Workspace',{exact:true})).toBeVisible({timeout:30000})
 await page.getByLabel('Workspace',{exact:true}).selectOption('1')
 await page.locator('.models summary').click()
 await page.getByRole('button',{name:'Load Qwen3.5-4B',exact:true}).click()
 await expect(page.getByRole('status')).toContainText('Model ready',{timeout:120000})
 await page.getByLabel('Search documents').fill('Explain the library access code ALPHA in detail with citations.')
 await page.getByRole('button',{name:'Ask with sources',exact:true}).click()
 await expect(page.locator('.answer')).toContainText('Provisional',{timeout:240000})
 await page.getByRole('button',{name:'Lock vault',exact:true}).click()
 await expect(page.getByLabel('Password',{exact:true})).toBeVisible()
 await expect(page.locator('.answer')).toHaveCount(0)
 const denied=await page.evaluate(()=>window.__TAURI__.core.invoke('dispatch',{input:{action:'source',chunk_id:1,workspace:1}}).then(()=>false,()=>true))
 assert.ok(denied)
 await page.waitForTimeout(2000)
 assert.ok(!(await page.locator('body').innerText()).includes('ALPHA-47'))
 await page.getByLabel('Password',{exact:true}).fill('Replacement-desktop-49!')
 await page.getByRole('button',{name:'Unlock',exact:true}).click()
 await expect(page.getByLabel('Workspace',{exact:true})).toBeVisible({timeout:30000})
 await page.getByLabel('Workspace',{exact:true}).selectOption('1')
 await expect(page.locator('.doc')).toHaveCount(1)
 await writeFile('native/artifacts/native-stream-lock.json',JSON.stringify({passed:true,synthetic:true,scope:'Actual Windows Qwen4B CPU stream observed, lock cleared UI and revoked source IPC, no late source text, unlock preserved copied document; only own model unloaded.'},null,2))
 console.log('Native actual-generation lock/revocation passed')
}finally{
 if(page)await page.evaluate(()=>window.__TAURI__.core.invoke('dispatch',{input:{action:'close'}})).catch(()=>{})
 if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,10000))])
 await browser?.close().catch(()=>{})
 if(child.exitCode===null){child.kill();throw new Error('Native did not close gracefully')}
}
