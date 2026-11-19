// Measures only this checkout's locked shell, with isolated synthetic profiles.
// No registration/unlock/model load; includes Electron utility/renderer processes.
import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import os from 'node:os'

const out=resolve('native/artifacts'); await mkdir(out,{recursive:true})
const runs=[]
for(let run=0;run<5;run++) {
  const profile=await mkdtemp(join(out,'electron-shell-'))
  const env={...process.env,NODE_ENV:'test',LOKLM_DATA_DIR:join(profile,'vault')}
  delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL
  const start=performance.now()
  const app=await electron.launch({args:[resolve('out/main/index.js'),`--user-data-dir=${profile}`],env,timeout:60000})
  try {
    const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded')
    await page.locator('input').first().waitFor({timeout:30000})
    const readyMs=performance.now()-start
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.hide()))
    await new Promise(r=>setTimeout(r,5000))
    await app.evaluate(({app})=>app.getAppMetrics())
    await new Promise(r=>setTimeout(r,2000))
    const metrics=await app.evaluate(({app})=>app.getAppMetrics())
    runs.push({run,readyMs,metrics,workingSetKiB:metrics.reduce((n,m)=>n+m.memory.workingSetSize,0),privateBytesKiB:metrics.reduce((n,m)=>n+(m.memory.privateBytes??0),0),idleCpuPercent:metrics.reduce((n,m)=>n+m.cpu.percentCPUUsage,0)})
    if(run===0) await page.screenshot({path:join(out,'electron-locked.png')})
  } finally {await app.close()}
}
await writeFile(join(out,'electron-shell.json'),JSON.stringify({revision:'4651557',platform:process.platform,arch:process.arch,cpu:os.cpus()[0].model,ramBytes:os.totalmem(),conditions:'Production Vite bundle, unpackaged Electron 42.11.10, fresh isolated profile each run; locked registration shell; 5 second settle plus 2 second CPU sample; no models loaded; first run is NOT a cold-cache measurement; window hidden after input ready. KiB from Electron getAppMetrics includes process tree.',runs},null,2))
console.log(JSON.stringify(runs.map(({run,readyMs,workingSetKiB,privateBytesKiB,idleCpuPercent})=>({run,readyMs,workingSetKiB,privateBytesKiB,idleCpuPercent}))))
