const pages = ['welcome', 'options', 'install', 'finish']
let pageIndex = 0
let installResult = null
let isInstalling = false
let installerState = {
  payloadReady: false,
  existingInstallDir: null,
}

const els = {
  back: document.getElementById('back'),
  next: document.getElementById('next'),
  installDir: document.getElementById('install-dir'),
  installDirHint: document.getElementById('install-dir-hint'),
  chooseDir: document.getElementById('choose-dir'),
  desktopShortcut: document.getElementById('desktop-shortcut'),
  startMenuShortcut: document.getElementById('startmenu-shortcut'),
  autostart: document.getElementById('autostart'),
  installSummary: document.getElementById('install-summary'),
  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  installError: document.getElementById('install-error'),
  finishDir: document.getElementById('finish-dir'),
  finishShortcuts: document.getElementById('finish-shortcuts'),
  finishAutostart: document.getElementById('finish-autostart'),
}

function options() {
  return {
    installDir: els.installDir.value.trim(),
    createDesktopShortcut: els.desktopShortcut.checked,
    createStartMenuShortcut: els.startMenuShortcut.checked,
    enableAutostart: els.autostart.checked,
  }
}

function setProgress(step, percent) {
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`
  els.progressLabel.textContent = step
}

function renderSummary() {
  const current = options()
  const shortcutParts = []
  if (current.createDesktopShortcut) shortcutParts.push('Desktop')
  if (current.createStartMenuShortcut) shortcutParts.push('Startmenue')

  els.installSummary.textContent = `LokLM wird nach ${current.installDir} installiert. ${
    shortcutParts.length > 0
      ? `Verknuepfungen: ${shortcutParts.join(' und ')}.`
      : 'Es werden keine Verknuepfungen erstellt.'
  } ${current.enableAutostart ? 'Autostart wird aktiviert.' : 'Autostart bleibt deaktiviert.'}`
}

function renderInstallDirHint() {
  const selected = els.installDir.value.trim()
  if (installerState.existingInstallDir && selected === installerState.existingInstallDir) {
    els.installDirHint.textContent = 'Vorhandene LokLM-Installation erkannt. Dieser Ordner wird aktualisiert.'
    return
  }

  els.installDirHint.textContent = selected
    ? 'Du kannst diesen Ordner verwenden oder ueber "Waehlen" einen anderen Zielordner aussuchen.'
    : 'Bitte einen Installationsordner auswaehlen.'
}

function renderFinish() {
  const current = options()
  const shortcutParts = []
  if (current.createDesktopShortcut) shortcutParts.push('Desktop')
  if (current.createStartMenuShortcut) shortcutParts.push('Startmenue')

  els.finishDir.textContent = installResult?.installDir ?? current.installDir
  els.finishShortcuts.textContent = shortcutParts.length > 0 ? shortcutParts.join(', ') : 'Keine'
  els.finishAutostart.textContent = current.enableAutostart ? 'Aktiviert' : 'Deaktiviert'
}

function render() {
  const active = pages[pageIndex]
  for (const page of pages) {
    document.querySelector(`[data-page="${page}"]`)?.classList.toggle('is-active', page === active)
    const dot = document.querySelector(`[data-step-dot="${page}"]`)
    dot?.classList.toggle('is-active', page === active)
    dot?.classList.toggle('is-done', pages.indexOf(page) < pageIndex)
  }

  els.back.disabled = pageIndex === 0 || isInstalling || active === 'finish'
  els.back.style.visibility = pageIndex === 0 ? 'hidden' : 'visible'

  if (active === 'install') renderSummary()
  if (active === 'finish') renderFinish()
  renderInstallDirHint()

  els.next.disabled =
    isInstalling ||
    (active === 'options' && !els.installDir.value.trim()) ||
    (active === 'install' && !installerState.payloadReady)
  els.next.textContent =
    active === 'install'
      ? 'Installieren'
      : active === 'finish'
        ? 'LokLM starten'
        : 'Weiter'
}

async function install() {
  isInstalling = true
  els.next.disabled = true
  els.back.disabled = true
  els.installError.hidden = true
  setProgress('Installation startet', 3)

  try {
    installResult = await window.installer.install(options())
    isInstalling = false
    pageIndex = pages.indexOf('finish')
    render()
  } catch (err) {
    els.installError.textContent = err instanceof Error ? err.message : String(err)
    els.installError.hidden = false
    isInstalling = false
    render()
  }
}

els.back.addEventListener('click', () => {
  pageIndex = Math.max(0, pageIndex - 1)
  render()
})

els.next.addEventListener('click', async () => {
  const active = pages[pageIndex]
  if (active === 'install') {
    await install()
    return
  }
  if (active === 'finish') {
    if (installResult?.appExePath) await window.installer.launch(installResult.appExePath)
    await window.installer.close()
    return
  }
  pageIndex = Math.min(pages.length - 1, pageIndex + 1)
  render()
})

els.chooseDir.addEventListener('click', async () => {
  const selected = await window.installer.chooseDir(els.installDir.value)
  if (selected) {
    els.installDir.value = selected
    render()
  }
})

els.installDir.addEventListener('input', render)

window.installer.onProgress(({ step, percent }) => setProgress(step, percent))

window.installer.getState().then((state) => {
  installerState = state
  els.installDir.value = state.defaultInstallDir
  if (!state.payloadReady) {
    els.installError.textContent =
      'Die Installations-Payload fehlt. Bitte zuerst den Windows-Payload-Build ausfuehren.'
    els.installError.hidden = false
  }
  render()
})
