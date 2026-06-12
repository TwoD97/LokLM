const i18n = window.LokLMI18n.createI18n('en')
const t = (key, vars) => i18n.t(key, vars)

const pages = ['welcome', 'license', 'hardware', 'options', 'install', 'finish']
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

// Hardware-page state. probe runs once ( cached for the whole session ) when
// the user lands on the hardware page ; result drives the recommended-badge
// + auto-selects that tier. User can override before clicking Next.
let hardwareProfile = null
let hardwareProbePromise = null
let hardwareProbeFailed = false
// Default to standard so the install flow has a sane tier even before the
// user opens the hardware page ( edge-case : Next-spammed past it ).
let selectedTier = 'standard'

// Per-file download state — updated by every model-progress event so the
// install page can show which model is currently downloading.
let activeDownload = { id: null, label: null, kind: null }

const els = {
  back: document.getElementById('back'),
  next: document.getElementById('next'),
  licenseBody: document.getElementById('license-body'),
  licenseAccept: document.getElementById('license-accept'),
  licenseAcceptRow: document.getElementById('license-accept-row'),
  licenseScrollHint: document.getElementById('license-scroll-hint'),
  hardwareSummary: document.getElementById('hardware-summary'),
  tierCards: Array.from(document.querySelectorAll('.tier-card')),
  tierRadios: Array.from(document.querySelectorAll('input[name="tier"]')),
  installDir: document.getElementById('install-dir'),
  installDirHint: document.getElementById('install-dir-hint'),
  chooseDir: document.getElementById('choose-dir'),
  desktopShortcut: document.getElementById('desktop-shortcut'),
  startMenuShortcut: document.getElementById('startmenu-shortcut'),
  autostart: document.getElementById('autostart'),
  cudaRow: document.getElementById('cuda-row'),
  cudaDownload: document.getElementById('cuda-download'),
  cudaHelp: document.getElementById('cuda-help'),
  installSummary: document.getElementById('install-summary'),
  progressFill: document.getElementById('progress-fill'),
  progressLabel: document.getElementById('progress-label'),
  progressModel: document.getElementById('progress-model'),
  installError: document.getElementById('install-error'),
  finishDir: document.getElementById('finish-dir'),
  finishShortcuts: document.getElementById('finish-shortcuts'),
  finishAutostart: document.getElementById('finish-autostart'),
  titlebarMin: document.getElementById('titlebar-min'),
  titlebarClose: document.getElementById('titlebar-close'),
}

els.titlebarMin?.addEventListener('click', () => void window.installer.minimize())
els.titlebarClose?.addEventListener('click', () => void window.installer.close())

let progressState = { key: 'install.waiting', percent: 0 }
let licenseText = null

function options() {
  return {
    installDir: els.installDir.value.trim(),
    createDesktopShortcut: els.desktopShortcut.checked,
    createStartMenuShortcut: els.startMenuShortcut.checked,
    enableAutostart: els.autostart.checked,
    tier: selectedTier,
    // Snapshot of what probe_hardware returned. Persisted into the tier-
    // marker as forensic context ( "this machine looked like X when the
    // user installed" ) ; the recommendation algorithm runs server-side
    // in Rust so we just pass through what we received.
    hardwareSnapshot: hardwareProfile,
    // v0.3.0+ : whether to additionally fetch the CUDA llama-cpp variant
    // from Bunny. The checkbox is hidden ( hence .checked == false ) when
    // the wizard is built for mac , so this round-trips as false on mac
    // even if the user somehow toggled it.
    downloadCuda: els.cudaDownload?.checked === true,
  }
}

// Drive the CUDA checkbox's default + helper text from the hardware
// probe result. Called once on probe success. Hidden entirely when the
// wizard runs on mac ( payload-manifest has no `cuda` entry ).
const NVIDIA_PASCAL_PLUS = new Set([
  'nvidia-pascal',
  'nvidia-turing',
  'nvidia-ampere',
  'nvidia-ada',
  'nvidia-blackwell',
])
function isMacUserAgent() {
  return /mac|darwin/i.test(navigator.userAgent || '')
}
function applyCudaDefault() {
  if (!els.cudaRow || !els.cudaDownload || !els.cudaHelp) return
  if (isMacUserAgent()) {
    els.cudaRow.hidden = true
    els.cudaDownload.checked = false
    return
  }
  els.cudaRow.hidden = false
  const arch = hardwareProfile?.gpuArch ?? null
  const name = hardwareProfile?.gpuName ?? ''
  const isNvidia = arch && NVIDIA_PASCAL_PLUS.has(arch)
  els.cudaDownload.checked = !!isNvidia
  if (isNvidia) {
    els.cudaHelp.textContent = t('options.cudaHelpNvidia', { gpu: name })
  } else if (name) {
    els.cudaHelp.textContent = t('options.cudaHelpOther', { gpu: name })
  } else {
    els.cudaHelp.textContent = t('options.cudaHelpNoGpu')
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

// Steps that come from the Rust download phase ( models.rs ) are encoded
// as "<event>:<model-id>" — e.g. "model-progress:Qwen_Qwen3.5-4B-Q4_K_M".
// We split on the first colon : prefix is the event type ( looked up in
// i18n.progress.* with model={name} interpolation ) , suffix is the model
// id which we munge into a friendly display name.
const MODEL_EVENTS = new Set([
  'model-start',
  'model-progress',
  'model-done',
  'model-skip',
  'model-retry',
])

function friendlyModelName(id) {
  // "Qwen_Qwen3.5-4B-Q4_K_M" → "Qwen3.5-4B" ( drop vendor prefix + quant ).
  // "bge-m3-Q4_K_M" → "bge-m3". "bge-reranker-v2-m3-Q4_K_M" → "bge-reranker-v2-m3".
  return id
    .replace(/^Qwen_/, '')
    .replace(/-(Q\d[\w_]+|IQ\d_\w+|UD-Q\d[\w_]+|MTP-Q\d[\w_]+)$/, '')
}

function setProgress(key, percent) {
  progressState = { key, percent }
  els.progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`

  // Per-file download events : route to the active-download sub-label and
  // pick a generic top-level label so the user sees "Modelle werden geladen"
  // up top + "Lade Qwen3.5-4B … 35%" underneath.
  if (key.includes(':')) {
    const [event, modelId] = key.split(':', 2)
    if (MODEL_EVENTS.has(event)) {
      const name = friendlyModelName(modelId)
      activeDownload = { id: modelId, label: name, kind: event }
      els.progressLabel.textContent = t('progress.downloading-models')
      const subKey =
        event === 'model-start'
          ? 'progress.modelStart'
          : event === 'model-done'
            ? 'progress.modelDone'
            : event === 'model-skip'
              ? 'progress.modelSkip'
              : event === 'model-retry'
                ? 'progress.modelRetry'
                : 'progress.modelProgress'
      els.progressModel.textContent = t(subKey, {
        model: name,
        done: `${percent}%`,
        total: '100%',
      })
      els.progressModel.hidden = false
      return
    }
  }

  // Non-model step ( prepare , copy , registry , done ) : clear the per-file
  // sub-label so the user doesn't see stale "Lade …" text after the download
  // phase finishes.
  activeDownload = { id: null, label: null, kind: null }
  els.progressModel.hidden = true
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

// ---- Hardware page : probe + tier picker ---------------------------------

function formatGiB(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '?'
  const gib = bytes / (1024 * 1024 * 1024)
  return gib >= 10 ? gib.toFixed(0) : gib.toFixed(1)
}

function renderHardwareSummary() {
  if (hardwareProbeFailed) {
    els.hardwareSummary.innerHTML = ''
    const p = document.createElement('p')
    p.className = 'hardware-summary__probing'
    p.textContent = t('hardware.probeFailed')
    els.hardwareSummary.appendChild(p)
    return
  }
  if (!hardwareProfile) {
    els.hardwareSummary.innerHTML = ''
    const p = document.createElement('p')
    p.className = 'hardware-summary__probing'
    p.textContent = t('hardware.probing')
    els.hardwareSummary.appendChild(p)
    return
  }

  const items = []
  if (hardwareProfile.gpuName) {
    const vram = hardwareProfile.gpuVramBytes
      ? ` , ${formatGiB(hardwareProfile.gpuVramBytes)} GiB ${t('hardware.vramSuffix')}`
      : ''
    items.push({ label: t('hardware.gpu'), value: `${hardwareProfile.gpuName}${vram}` })
  } else {
    items.push({ label: t('hardware.gpu'), value: t('hardware.noGpu') })
  }
  if (hardwareProfile.cpuBrand) {
    const threads = hardwareProfile.cpuThreads
      ? ` , ${hardwareProfile.cpuThreads} ${t('hardware.threadsSuffix')}`
      : ''
    items.push({ label: t('hardware.cpu'), value: `${hardwareProfile.cpuBrand}${threads}` })
  }
  if (hardwareProfile.ramBytes) {
    items.push({ label: t('hardware.ram'), value: `${formatGiB(hardwareProfile.ramBytes)} GiB` })
  }

  els.hardwareSummary.innerHTML = ''
  for (const item of items) {
    const wrap = document.createElement('p')
    wrap.className = 'hardware-summary__item'
    const label = document.createElement('span')
    label.className = 'hardware-summary__label'
    label.textContent = item.label
    const value = document.createElement('span')
    value.className = 'hardware-summary__value'
    value.textContent = item.value
    wrap.appendChild(label)
    wrap.appendChild(value)
    els.hardwareSummary.appendChild(wrap)
  }
}

function renderTierCards() {
  const recommended = hardwareProfile?.recommendedTier ?? null
  for (const card of els.tierCards) {
    const tier = card.dataset.tier
    card.classList.toggle('is-selected', tier === selectedTier)
    card.classList.toggle('is-recommended', tier === recommended)
    const badge = card.querySelector('.tier-card__badge')
    if (badge) badge.hidden = tier !== recommended
    const radio = card.querySelector('input[type="radio"]')
    if (radio) radio.checked = tier === selectedTier
  }
}

// One-shot probe per session — first navigation to the hardware page kicks
// it off ; subsequent visits reuse the cached result. ~200-500 ms cost the
// first time ( wgpu driver init ) so the splash is genuinely informative.
function startHardwareProbe() {
  if (hardwareProbePromise || hardwareProfile || hardwareProbeFailed) return
  hardwareProbePromise = window.installer
    .probeHardware()
    .then((profile) => {
      hardwareProfile = profile
      // Auto-select the recommended tier ( user can still override ). Honour
      // an earlier manual pick if the user clicked a card before the probe
      // resolved — selectedTier was already set in that case.
      if (profile?.recommendedTier && selectedTier === 'standard') {
        selectedTier = profile.recommendedTier
      }
      // Default the CUDA checkbox on for detected NVIDIA Pascal+ ;
      // off for AMD / Intel / Apple / CPU-only.
      applyCudaDefault()
      render()
    })
    .catch((err) => {
      console.error('[wizard] hardware probe failed', err)
      hardwareProbeFailed = true
      // Probe failed : we don't know what the GPU is. Default OFF and
      // surface the "no GPU detected" helper text so the user is
      // informed rather than guessing. They can still toggle manually.
      applyCudaDefault()
      render()
    })
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

  // On the finish page the back button is repurposed as "Schließen"
  // ( close without launching ) , so it has to stay enabled there.
  els.back.disabled = pageIndex === 0 || isInstalling
  els.back.style.visibility = pageIndex === 0 ? 'hidden' : 'visible'
  els.back.textContent = active === 'finish' ? t('nav.close') : t('nav.back')

  applyLicenseBodyText()
  applyLicenseAcceptLock()
  if (active === 'hardware') {
    startHardwareProbe()
    renderHardwareSummary()
    renderTierCards()
  }
  if (active === 'install') renderSummary()
  if (active === 'finish') renderFinish()
  renderInstallDirHint()

  // Re-apply progress label after locale switch so the running step keeps its
  // translated form.
  setProgress(progressState.key, progressState.percent)

  els.next.disabled =
    isInstalling ||
    (active === 'license' && !els.licenseAccept.checked) ||
    // Hardware page : block Next until we have a result ( so we don't ship
    // a probe-less hardwareSnapshot ) OR the probe failed ( then user picks
    // manually , selectedTier is always set ).
    (active === 'hardware' && !hardwareProfile && !hardwareProbeFailed) ||
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

  try {
    installResult = await window.installer.install(options())
    isInstalling = false
    // Always land on the finish page so the user decides explicitly
    // whether to launch LokLM now or close without launching. The two
    // buttons on the finish page handle that choice ( see render() ).
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

els.back.addEventListener('click', async () => {
  const active = pages[pageIndex]
  // On the finish page the back button is repurposed as "Close without
  // launching" ( going back to the install progress wouldn't make sense
  // anyway ). On every other page it's just a page-step backward.
  if (active === 'finish') {
    await window.installer.close()
    return
  }
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
    if (installResult?.appExePath) {
      try {
        await window.installer.launch(installResult.appExePath)
      } catch (err) {
        alert('Launch failed: ' + err)
        return
      }
    }
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

for (const radio of els.tierRadios) {
  radio.addEventListener('change', () => {
    if (radio.checked) {
      selectedTier = radio.value
      render()
    }
  })
}

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

// Three things must finish before we hide the boot-splash overlay :
// the two IPC bootstrap calls AND a small minimum-visible delay so
// the splash doesn't flicker on fast machines ( both calls can
// resolve in <50ms and the user wouldn't see anything ).
const licensePromise = window.installer.getLicense().then((text) => {
  licenseText = text
  licenseLoaded = true
  render()
})

const statePromise = window.installer.getState().then((state) => {
  installerState = state
  els.installDir.value = state.defaultInstallDir
  if (!state.payloadReady) {
    els.installError.textContent = t('install.payloadMissing')
    els.installError.hidden = false
  }
  render()
})

const minVisible = new Promise((resolve) => setTimeout(resolve, 800))

Promise.all([licensePromise, statePromise, minVisible]).then(() => {
  document.body.classList.add('is-booted')
})
