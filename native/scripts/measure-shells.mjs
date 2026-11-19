// Paired locked-shell samples. Not a cold-cache or feature-complete RAG benchmark.
import {_electron as electron,chromium} from '@playwright/test'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {resolve,join} from 'node:path'
import {performance} from 'node:perf_hooks'
import os from 'node:os'
const exec=promisify(execFile)
const out=resolve('native/artifacts');await mkdir(out,{recursive:true})
const profile=await mkdtemp(join(out,'paired-shell-'))
const nativeProfile=join(profile,'native-webview')
const runs=[]
async function nativeRun(){
 await rm(join(nativeProfile,'EBWebView','DevToolsActivePort'),{force:true})
 const started=performance.now()
 const child=spawn(resolve('native/target/release/loklm-native.exe'),[],{windowsHide:true,env:{...process.env,LOKLM_NATIVE_DATA_DIR:join(profile,'native-vault'),WEBVIEW2_USER_DATA_FOLDER:nativeProfile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0 --remote-debugging-address=127.0.0.1'},stdio:'ignore'})
 let browser,page,result,failure
 try{
  let port;const deadline=Date.now()+30000
  while(Date.now()<deadline){try{port=Number((await readFile(join(nativeProfile,'EBWebView','DevToolsActivePort'),'utf8')).split('\n')[0]);if(port)break}catch{/* The test-only CDP file appears asynchronously. */}await new Promise(r=>setTimeout(r,20))}
  if(!port)throw new Error('Native CDP endpoint missing')
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  page=browser.contexts()[0].pages()[0]
  await page.getByLabel('Password',{exact:true}).waitFor()
  const readyMs=performance.now()-started
  result=await sample('native',child.pid,readyMs,await browser.version())
 }catch(error){failure=error
 }finally{
  if(page)await page.evaluate(()=>window.__TAURI__.core.invoke('dispatch',{input:{action:'close'}})).catch(()=>{})
  if(child.exitCode===null)await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,5000))])
  await browser?.close().catch(()=>{})
  if(child.exitCode===null){child.kill();failure??=new Error('Native failed graceful close')}
 }
 if(failure)throw failure
 return result
}
async function electronRun(){
 const env={...process.env,NODE_ENV:'test',LOKLM_DATA_DIR:join(profile,'electron-vault')}
 delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
 const started=performance.now()
 const app=await electron.launch({args:[resolve('out/main/index.js'),`--user-data-dir=${join(profile,'electron-profile')}`],env,timeout:60000})
 try{
  const page=await app.firstWindow()
  await page.locator('input').first().waitFor()
  const readyMs=performance.now()-started
  // Match outer DIP dimensions for settled memory/CPU. Original initial window
  // is 1280x800; startup values therefore remain descriptive, not a speed claim.
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.setSize(1200,800)))
  return await sample('electron',app.process().pid,readyMs,await app.evaluate(()=>process.versions.electron))
 }finally{await app.close()}
}
async function sample(engine,pid,readyMs,runtime){
 await new Promise(r=>setTimeout(r,5000))
 const {stdout}=await exec('pwsh',['-NoProfile','-File',resolve('native/scripts/sample-process-tree.ps1'),'-RootProcessId',String(pid)],{windowsHide:true,timeout:15000})
 return {engine,readyMs,runtime,...JSON.parse(stdout)}
}
for(let round=0;round<6;round++){
 for(const run of round%2?[nativeRun,electronRun]:[electronRun,nativeRun]){
  const result={round,profileState:round===0?'fresh-profile':'reused-profile',...await run()};runs.push(result);console.log(JSON.stringify(result))
  await writeFile(join(out,'paired-shells.json'),JSON.stringify({cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,ramBytes:os.totalmem(),platform:os.release(),conditions:'Same Windows host, alternating engines, visible locked registration shell, no models. Outer window 1200x800 DIP for settled samples; Electron initially 1280x800, native1200x800. Five-second settle then two-second-plus-enumeration Win32 process-tree CPU delta. Working set sums shared pages and is not exclusive physical usage; private bytes are committed memory. Includes descendant webviews/renderers/GPU processes. CDP/Playwright observation overhead present. Round0 fresh profiles, subsequent profiles reused. No cache eviction: no cold-cache timing. Original production Vite bundle, unpackaged Electron; native release executable. Other host applications remain running.',runs},null,2))
 }
}
