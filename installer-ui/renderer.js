const i18n = window.LokLMI18n.createI18n('de')
const t = (key, vars) => i18n.t(key, vars)

const pages = ['welcome', 'license', 'options', 'install', 'finish']
let pageIndex = 0
let installResult = null
let isInstalling = false
let licenseLoaded = false
// Sticky: once the user reaches the bottom of the license text we leave the
// accept toggle unlocked, even if the body element later scrolls back up or
// is re-rendered (e.g. on locale switch).
let licenseScrolled = false
// Marks whether the actual MIT license text is currently shown in the pre.
// Used so a locale switch doesn't accidentally overwrite the literal license
// with a re-rendered loading/error message.
let licenseBodyState = 'loading' // 'loading' | 'loaded' | 'error'
let installerState = {
  payloadReady: false,
  existingInstallDir: null,
}

const els = {
  back: document.getElementById('back'),
  next: document.getElementById('next'),
  licenseBody: document.getElementById('license-body'),
  licenseAccept: document.getElementById('license-accept'),
  licenseAcceptRow: document.getElementById('license-accept-row'),
  licenseScrollHint: document.getElementById('license-scroll-hint'),
  installDir: document.getElementById('install-dir'),
  installDirHint: document.getElementById('install-dir-hint'),
  chooseDir: document.getElementById('choose-dir'),
  desktopShortcut: document.getElementById('desktop-shortcut'),
  startMenuShortcut: document.getElementById('startmenu-shortcut'),
  autostart: document.getElementById('autostart'),
  launchAfterInstall: document.getElementById('launch-after-install'),
  installSummary: document.getElementById('install-summary'),
  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  installError: document.getElementById('install-error'),
  finishDir: document.getElementById('finish-dir'),
  finishShortcuts: document.getElementById('finish-shortcuts'),
  finishAutostart: document.getElementById('finish-autostart'),
}

let progressState = { key: 'install.waiting', percent: 0 }
let licenseText = null

function options() {
  return {
    installDir: els.installDir.value.trim(),
    createDesktopShortcut: els.desktopShortcut.checked,
    createStartMenuShortcut: els.startMenuShortcut.checked,
    enableAutostart: els.autostart.checked,
    // Renderer-side concern: not part of the IPC `install` payload, used
    // only to decide whether to auto-launch + close after a successful run.
    launchAfterInstall: els.launchAfterInstall.checked,
  }
}

// Re-renders every node with a data-i18n attribute. Cheap; we run it on every
// language switch.
function applyStaticTranslations() {
  document.documentElement.lang = i18n.locale
  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n)
  }
}

function setProgress(key, percent) {
  progressState = { key, percent }
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`
  els.progressLabel.textContent = key.includes('.') ? t(key) : t(`progress.${key}`)
}

function renderSummary() {
  const current = options()
  const shortcutParts = []
  if (current.createDesktopShortcut) shortcutParts.push(t('shortcutNames.desktop'))
  if (current.createStartMenuShortcut) shortcutParts.push(t('shortcutNames.startMenu'))

  const parts = [t('install.summaryDir', { dir: current.installDir })]
  parts.push(
    shortcutParts.length > 0
      ? t('install.summaryShortcutsList', { list: shortcutParts.join(' + ') })
      : t('install.summaryShortcutsNone'),
  )
  parts.push(
    current.enableAutostart ? t('install.summaryAutostartOn') : t('install.summaryAutostartOff'),
  )
  els.installSummary.textContent = parts.join(' ')
}

function renderInstallDirHint() {
  const selected = els.installDir.value.trim()
  if (installerState.existingInstallDir && selected === installerState.existingInstallDir) {
    els.installDirHint.textContent = t('options.hintExisting')
    return
  }

  els.installDirHint.textContent = selected ? t('options.hintDefault') : t('options.hintEmpty')
}

function renderFinish() {
  const current = options()
  const shortcutParts = []
  if (current.createDesktopShortcut) shortcutParts.push(t('shortcutNames.desktop'))
  if (current.createStartMenuShortcut) shortcutParts.push(t('shortcutNames.startMenu'))

  els.finishDir.textContent = installResult?.installDir ?? current.installDir
  els.finishShortcuts.textContent =
    shortcutParts.length > 0 ? shortcutParts.join(', ') : t('finish.shortcutsNone')
  els.finishAutostart.textContent = current.enableAutostart
    ? t('finish.autostartOn')
    : t('finish.autostartOff')
}

// Re-evaluate scroll state against the current license body. Returns true if
// the body is already fully revealed (no scroll required) — handy when the
// MIT text happens to fit inside the viewport.
function isLicenseFullyRevealed() {
  const el = els.licenseBody
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 5
}

function applyLicenseBodyText() {
  if (!licenseLoaded) {
    els.licenseBody.textContent = t('license.loading')
    licenseBodyState = 'loading'
    return
  }
  if (licenseText == null) {
    els.licenseBody.textContent = t('license.loadError')
    licenseBodyState = 'error'
    return
  }
  // Only set the literal license text once — re-setting it would reset the
  // scroll position and re-lock the accept toggle, which is the opposite of
  // what we want when the user changes locale after already reading.
  if (licenseBodyState !== 'loaded') {
    els.licenseBody.textContent = licenseText
    licenseBodyState = 'loaded'
    // Some users get a license shorter than the pre's max-height — no scroll
    // needed, unlock immediately.
    if (isLicenseFullyRevealed()) licenseScrolled = true
  }
}

function applyLicenseAcceptLock() {
  // Lock the accept row until the user has scrolled to the bottom of the
  // loaded license. While the text is still loading or errored we also keep
  // the row locked — nothing meaningful to accept yet.
  const unlocked = licenseBodyState === 'loaded' && licenseScrolled
  els.licenseAccept.disabled = !unlocked
  els.licenseAcceptRow.classList.toggle('is-locked', !unlocked)
  els.licenseAcceptRow.setAttribute('aria-disabled', String(!unlocked))
  if (!unlocked && els.licenseAccept.checked) {
    // Defensive: a re-lock shouldn't carry over a stale "accepted" state.
    els.licenseAccept.checked = false
  }
  els.licenseScrollHint.hidden = unlocked || licenseBodyState !== 'loaded'
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

  applyLicenseBodyText()
  applyLicenseAcceptLock()
  if (active === 'install') renderSummary()
  if (active === 'finish') renderFinish()
  renderInstallDirHint()

  // Re-apply progress label after locale switch so the running step keeps its
  // translated form.
  setProgress(progressState.key, progressState.percent)

  els.next.disabled =
    isInstalling ||
    (active === 'license' && !els.licenseAccept.checked) ||
    (active === 'options' && !els.installDir.value.trim()) ||
    (active === 'install' && !installerState.payloadReady)

  if (active === 'install') {
    els.next.textContent = t('nav.install')
  } else if (active === 'finish') {
    els.next.textContent = t('nav.launch')
  } else {
    els.next.textContent = t('nav.next')
  }
}

async function install() {
  isInstalling = true
  els.next.disabled = true
  els.back.disabled = true
  els.installError.hidden = true
  setProgress('install.starting', 3)

  const current = options()
  const { launchAfterInstall: _autoLaunch, ...installPayload } = current
  try {
    installResult = await window.installer.install(installPayload)
    isInstalling = false
    // If the user opted in to auto-launch on the options page, skip the
    // finish screen entirely: launch the freshly-installed app and close
    // the bootstrapper. Otherwise fall through to the finish step so the
    // user can review the summary and decide.
    if (current.launchAfterInstall && installResult?.appExePath) {
      await window.installer.launch(installResult.appExePath)
      await window.installer.close()
      return
    }
    pageIndex = pages.indexOf('finish')
    render()
  } catch (err) {
    els.installError.textContent = err instanceof Error ? err.message : String(err)
    els.installError.hidden = false
    isInstalling = false
    render()
  }
}

function setLocale(next) {
  if (next === i18n.locale) return
  i18n.setLocale(next)
  for (const btn of document.querySelectorAll('.lang-switch__btn')) {
    btn.classList.toggle('is-active', btn.dataset.locale === i18n.locale)
  }
  applyStaticTranslations()
  render()
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
els.licenseAccept.addEventListener('change', render)
els.desktopShortcut.addEventListener('change', render)
els.startMenuShortcut.addEventListener('change', render)
els.autostart.addEventListener('change', render)
els.launchAfterInstall.addEventListener('change', render)

els.licenseBody.addEventListener('scroll', () => {
  if (licenseScrolled) return
  if (licenseBodyState !== 'loaded') return
  if (isLicenseFullyRevealed()) {
    licenseScrolled = true
    render()
  }
})

for (const btn of document.querySelectorAll('.lang-switch__btn')) {
  btn.addEventListener('click', () => setLocale(btn.dataset.locale))
}

window.installer.onProgress(({ step, percent }) => setProgress(step, percent))

applyStaticTranslations()

window.installer.getLicense().then((text) => {
  licenseText = text
  licenseLoaded = true
  render()
})

window.installer.getState().then((state) => {
  installerState = state
  els.installDir.value = state.defaultInstallDir
  if (!state.payloadReady) {
    els.installError.textContent = t('install.payloadMissing')
    els.installError.hidden = false
  }
  render()
})
