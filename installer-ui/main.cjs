const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const { execFile } = require('node:child_process')
const { appendFile, cp, mkdir, rm, stat, writeFile } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const execFileAsync = promisify(execFile)

const PRODUCT_NAME = 'LokLM'
const APP_EXE = 'LokLM.exe'
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LokLM'
const SETUP_KEY = 'HKCU\\Software\\LokLM\\Setup'
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
let mainWindow = null

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`
  void appendFile(path.join(os.tmpdir(), 'loklm-installer.log'), line, 'utf8').catch(() => undefined)
}

process.on('uncaughtException', (error) => {
  log(`uncaughtException: ${error.stack || error.message}`)
})

process.on('unhandledRejection', (error) => {
  log(`unhandledRejection: ${error instanceof Error ? error.stack || error.message : String(error)}`)
})

log('main loaded')

function defaultInstallDir() {
  return path.join(localProgramsDir(), 'LokLM')
}

function localProgramsDir() {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(root, 'Programs')
}

function appDataDir() {
  const root = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  return path.join(root, 'loklm')
}

function payloadDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'payload', 'win-unpacked')
    : path.resolve(__dirname, '..', 'release', 'win-unpacked')
}

function installerIcon() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.resolve(__dirname, '..', 'resources', 'icon.ico')
}

function regExe() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'reg.exe')
    : 'reg.exe'
}

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function regAdd(key, name, type, value) {
  await execFileAsync(regExe(), ['add', key, '/v', name, '/t', type, '/d', String(value), '/f'], {
    windowsHide: true,
  })
}

async function regQueryValue(key, name) {
  const { stdout } = await execFileAsync(regExe(), ['query', key, '/v', name], {
    windowsHide: true,
  })
  const line = stdout
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
  if (!line) return null

  const parts = line.split(/\s{2,}/)
  return parts.length >= 3 ? parts.slice(2).join('  ').trim() : null
}

async function regDeleteValue(key, name) {
  await execFileAsync(regExe(), ['delete', key, '/v', name, '/f'], { windowsHide: true }).catch(
    () => undefined,
  )
}

async function existingInstallDir() {
  const fromRegistry = await regQueryValue(UNINSTALL_KEY, 'InstallLocation').catch(() => null)
  const candidates = [
    fromRegistry,
    defaultInstallDir(),
    path.join(localProgramsDir(), 'loklm'),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await exists(path.join(candidate, APP_EXE))) return candidate
  }

  return null
}

async function suggestedInstallDir() {
  return (await existingInstallDir()) || defaultInstallDir()
}

async function dialogDefaultPath(current) {
  let candidate = current?.trim() || (await suggestedInstallDir())
  while (candidate && !(await exists(candidate))) {
    const parent = path.dirname(candidate)
    if (parent === candidate) return localProgramsDir()
    candidate = parent
  }
  return candidate || localProgramsDir()
}

async function createShortcut(linkPath, targetPath, description) {
  await mkdir(path.dirname(linkPath), { recursive: true })
  const script = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$shortcut = $shell.CreateShortcut(${JSON.stringify(linkPath)})`,
    `$shortcut.TargetPath = ${JSON.stringify(targetPath)}`,
    `$shortcut.WorkingDirectory = ${JSON.stringify(path.dirname(targetPath))}`,
    `$shortcut.Description = ${JSON.stringify(description)}`,
    `$shortcut.IconLocation = ${JSON.stringify(`${targetPath},0`)}`,
    '$shortcut.Save()',
  ].join('; ')
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true },
  )
}

async function writeSetupState(options) {
  const dir = appDataDir()
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'setup.json'),
    JSON.stringify(
      {
        firstRunDone: true,
        options: {
          createDesktopShortcut: options.createDesktopShortcut,
          createStartMenuShortcut: options.createStartMenuShortcut,
          enableAutostart: options.enableAutostart,
        },
      },
      null,
      2,
    ),
    'utf8',
  )
}

async function writeUninstaller(installDir) {
  const scriptPath = path.join(installDir, 'Uninstall LokLM.ps1')
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Remove-Item "$env:USERPROFILE\\Desktop\\LokLM.lnk" -Force
Remove-Item "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\LokLM.lnk" -Force
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "LokLM" /f | Out-Null
reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\LokLM" /f | Out-Null
reg delete "HKCU\\Software\\LokLM\\Setup" /f | Out-Null
Start-Process -WindowStyle Hidden -FilePath "$env:ComSpec" -ArgumentList "/c timeout /t 1 > nul & rmdir /s /q ""${installDir}"""
`
  await writeFile(scriptPath, script.trimStart(), 'utf8')
  return scriptPath
}

async function writeUninstallRegistry(installDir, appExePath, uninstallerPath) {
  await regAdd(UNINSTALL_KEY, 'DisplayName', 'REG_SZ', PRODUCT_NAME)
  await regAdd(UNINSTALL_KEY, 'DisplayVersion', 'REG_SZ', app.getVersion())
  await regAdd(UNINSTALL_KEY, 'Publisher', 'REG_SZ', 'Projektgruppe LokLM')
  await regAdd(UNINSTALL_KEY, 'InstallLocation', 'REG_SZ', installDir)
  await regAdd(UNINSTALL_KEY, 'DisplayIcon', 'REG_SZ', appExePath)
  await regAdd(
    UNINSTALL_KEY,
    'UninstallString',
    'REG_SZ',
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${uninstallerPath}"`,
  )
  await regAdd(UNINSTALL_KEY, 'NoModify', 'REG_DWORD', 1)
  await regAdd(UNINSTALL_KEY, 'NoRepair', 'REG_DWORD', 1)
}

async function applyOptions(options, appExePath) {
  await regAdd(
    SETUP_KEY,
    'DesktopShortcut',
    'REG_SZ',
    options.createDesktopShortcut ? '1' : '0',
  )
  await regAdd(
    SETUP_KEY,
    'StartMenuShortcut',
    'REG_SZ',
    options.createStartMenuShortcut ? '1' : '0',
  )

  const desktopLink = path.join(os.homedir(), 'Desktop', 'LokLM.lnk')
  const startMenuLink = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'LokLM.lnk',
  )

  if (options.createDesktopShortcut) {
    await createShortcut(desktopLink, appExePath, 'LokLM starten')
  } else {
    await rm(desktopLink, { force: true }).catch(() => undefined)
  }

  if (options.createStartMenuShortcut) {
    await createShortcut(startMenuLink, appExePath, 'LokLM starten')
  } else {
    await rm(startMenuLink, { force: true }).catch(() => undefined)
  }

  if (options.enableAutostart) {
    await regAdd(RUN_KEY, 'LokLM', 'REG_SZ', `"${appExePath}"`)
  } else {
    await regDeleteValue(RUN_KEY, 'LokLM')
  }
}

function sendProgress(event, step, percent) {
  event.sender.send('installer:progress', { step, percent })
}

async function install(event, options) {
  const source = payloadDir()
  const installDir = options.installDir || defaultInstallDir()
  const appExePath = path.join(installDir, APP_EXE)

  if (!(await exists(path.join(source, APP_EXE)))) {
    throw new Error(`Payload nicht gefunden: ${source}`)
  }

  sendProgress(event, 'Installationsordner vorbereiten', 8)
  await mkdir(installDir, { recursive: true })

  sendProgress(event, 'LokLM-Dateien kopieren', 20)
  await cp(source, installDir, { recursive: true, force: true })

  sendProgress(event, 'Verknuepfungen und Autostart anwenden', 72)
  await applyOptions(options, appExePath)

  sendProgress(event, 'Setup-Status schreiben', 84)
  await writeSetupState(options)

  sendProgress(event, 'Uninstaller registrieren', 92)
  const uninstallerPath = await writeUninstaller(installDir)
  await writeUninstallRegistry(installDir, appExePath, uninstallerPath)

  sendProgress(event, 'Fertig', 100)
  return { installDir, appExePath }
}

function createWindow() {
  log(`createWindow packaged=${app.isPackaged} resources=${process.resourcesPath}`)
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 860,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'LokLM Installer',
    icon: installerIcon(),
    backgroundColor: '#0B1B2B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    log('ready-to-show')
    mainWindow?.show()
  })
  mainWindow.on('closed', () => {
    log('window closed')
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  void mainWindow
    .loadFile(path.join(__dirname, 'index.html'))
    .then(() => log('index loaded'))
    .catch((error) => log(`loadFile failed: ${error.stack || error.message}`))
}

ipcMain.handle('installer:get-state', async () => ({
  defaultInstallDir: await suggestedInstallDir(),
  existingInstallDir: await existingInstallDir(),
  payloadReady: await exists(path.join(payloadDir(), APP_EXE)),
}))

ipcMain.handle('installer:choose-dir', async (event, current) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const options = {
    defaultPath: await dialogDefaultPath(current),
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('installer:install', async (event, options) => install(event, options))

ipcMain.handle('installer:launch', async (_event, appExePath) => {
  await shell.openPath(appExePath)
})

ipcMain.handle('installer:close', () => {
  app.quit()
})

void app.whenReady().then(() => {
  log('app ready')
  createWindow()
})

app.on('window-all-closed', () => {
  log('window-all-closed')
  app.quit()
})
