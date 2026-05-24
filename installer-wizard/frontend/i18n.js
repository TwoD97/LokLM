// Translation dictionary + lookup factory for the LokLM bootstrapper.
//
// Self-contained (no DOM access, no Electron) so the same module can be
// require()'d from vitest. Loads in the renderer as a <script> tag — it
// exposes `window.LokLMI18n` at the bottom, but the same exports work via
// CommonJS for tests (the UMD-ish footer at the end).
//
// Conventions:
//   - keys are dot-joined paths: 'license.acceptTitle', 'progress.copying-files'
//   - {placeholders} are filled by passing a context object to t()
//   - missing keys return the key string itself — visible in the UI, easy to
//     spot during translation review
;(function (root) {
  const DICT = {
    de: {
      brand: {
        eyebrow: 'Lokaler KI-Wissensassistent',
        title: 'LokLM installieren',
        copy: 'Wir richten LokLM unter deinem Konto ein — Verknüpfungen, Autostart und Installationsort wählst du selbst.',
      },
      steps: {
        welcome: 'Start',
        license: 'Lizenz',
        hardware: 'Hardware',
        options: 'Optionen',
        install: 'Installieren',
        finish: 'Fertig',
      },
      welcome: {
        kicker: 'Willkommen',
        title: 'Schön, dass du LokLM ausprobierst.',
        copy: 'Wir richten LokLM jetzt unter deinem Konto ein. Kein Adminrecht, keine Systemordner — alles bleibt in deinem Benutzerprofil. Auf den nächsten Schritten wählst du Installationsort, Verknüpfungen und Autostart.',
        feature_local_title: 'Ohne Admin',
        feature_local_desc: 'Alles unter deinem Konto, nichts wird systemweit geändert.',
        feature_cleanup_title: 'Wieder weg',
        feature_cleanup_desc: 'Aus „Apps & Features" mit einem Klick deinstallierbar.',
        feature_appstyle_title: 'Dein Setup',
        feature_appstyle_desc: 'Du entscheidest, wo und wie tief LokLM sich integriert.',
      },
      license: {
        kicker: 'Lizenz',
        title: 'Bevor wir loslegen — die MIT-Lizenz',
        copy: 'LokLM ist Open Source und steht unter der MIT-Lizenz. Lies sie kurz durch, dann geht es weiter.',
        loading: 'Lizenztext wird geladen …',
        loadError:
          'Lizenztext konnte nicht geladen werden. Du findest ihn in der LICENSE-Datei im Projektverzeichnis.',
        scrollHint: 'Scroll bis ans Ende der Lizenz, dann kannst du zustimmen.',
        acceptTitle: 'Ich akzeptiere die MIT-Lizenzbedingungen.',
        acceptDesc: 'Wir brauchen dein OK, um fortzufahren.',
      },
      hardware: {
        kicker: 'Hardware',
        title: 'Welche Edition passt zu deinem Rechner?',
        copy: 'Wir haben deine Hardware kurz geprüft. Die empfohlene Edition ist markiert — du kannst aber jederzeit eine andere wählen.',
        probing: 'Hardware wird geprüft …',
        probeFailed: 'Hardware-Prüfung fehlgeschlagen — du kannst trotzdem eine Edition wählen.',
        recommended: 'Empfohlen',
        gpu: 'GPU',
        cpu: 'CPU',
        ram: 'RAM',
        noGpu: 'Keine GPU erkannt',
        vramSuffix: 'VRAM',
        threadsSuffix: 'Threads',
      },
      tiers: {
        lite: {
          title: 'Lite',
          subtitle: 'Klein und sparsam',
          model: 'Qwen3.5-2B',
          size: '~2,3 GB Download',
          latency: '~2 s pro Antwort',
          body: 'Läuft auch auf 8 GB RAM ganz ohne GPU. Schnell und unkompliziert , bei komplexen Fragen aber knapper als die größeren Editionen.',
        },
        standard: {
          title: 'Standard',
          subtitle: 'Der empfohlene Default',
          model: 'Qwen3.5-4B',
          size: '~4,0 GB Download',
          latency: '~3 s pro Antwort',
          body: 'Beste Antwort-Qualität in unserem Eval-Pool. Passt auf jede Dev-Maschine mit ein paar GB freier VRAM oder unified memory.',
        },
        pro: {
          title: 'Pro',
          subtitle: 'Reserven für lange Fragen',
          model: 'Qwen3.5-9B',
          size: '~7,0 GB Download',
          latency: '~6 s pro Antwort',
          body: 'Mehr Spielraum für Nischen-Themen und längere Kontexte. Braucht eine GPU mit mindestens 8 GB VRAM oder Apple Silicon mit 16+ GB unified memory.',
        },
      },
      options: {
        kicker: 'Optionen',
        title: 'Wohin soll LokLM, und wie soll es starten?',
        installDirLabel: 'Installationsordner',
        chooseDir: 'Ändern',
        hintExisting:
          'Wir haben eine vorhandene LokLM-Installation gefunden — dieser Ordner wird aktualisiert.',
        hintDefault: 'Dieser Ordner passt für die meisten — über „Ändern" wählst du einen anderen.',
        hintEmpty: 'Bitte einen Installationsordner wählen.',
        desktopTitle: 'Verknüpfung auf dem Desktop',
        desktopDesc: 'Legt ein LokLM-Icon direkt auf deinem Desktop ab.',
        startMenuTitle: 'Im Startmenü',
        startMenuDesc: 'Fügt LokLM zu deinem Windows-Startmenü hinzu.',
        autostartTitle: 'Mit Windows starten',
        autostartDesc: 'LokLM startet automatisch, sobald du dich anmeldest.',
      },
      install: {
        kicker: 'Installieren',
        title: 'Alles bereit — sollen wir?',
        waiting: 'Warte auf den Start',
        starting: 'Geht los …',
        summaryDir: 'LokLM landet in {dir}.',
        summaryShortcutsNone: 'Keine Verknüpfungen.',
        summaryShortcutsList: 'Verknüpfungen: {list}.',
        summaryAutostartOn: 'Autostart ist aktiviert.',
        summaryAutostartOff: 'Autostart bleibt aus.',
        payloadMissing:
          'Die Installationsdateien fehlen. Bitte zuerst den Windows-Payload-Build ausführen.',
      },
      finish: {
        kicker: 'Fertig',
        title: 'Geschafft — LokLM ist da.',
        copy: 'Alles eingerichtet. Du kannst LokLM jetzt starten und in deinem lokalen Arbeitsbereich loslegen.',
        installLocation: 'Installiert in',
        shortcuts: 'Verknüpfungen',
        autostart: 'Autostart',
        shortcutsNone: 'Keine',
        autostartOn: 'Ja',
        autostartOff: 'Nein',
      },
      nav: {
        back: 'Zurück',
        next: 'Weiter',
        install: 'Installieren',
        launch: 'LokLM starten',
        close: 'Schließen',
      },
      progress: {
        'preparing-folder': 'Installationsordner wird vorbereitet',
        'copying-files': 'Dateien werden kopiert',
        'applying-options': 'Verknüpfungen und Autostart werden gesetzt',
        'registering-uninstaller': 'Uninstaller wird registriert',
        'downloading-models': 'Modelle werden geladen',
        'writing-tier-marker': 'Konfiguration wird gespeichert',
        done: 'Fertig',
        modelStart: 'Lade {model} …',
        modelProgress: 'Lade {model} … {done} / {total}',
        modelDone: '{model} fertig',
        modelSkip: '{model} ist bereits da , wird übersprungen',
      },
      shortcutNames: {
        desktop: 'Desktop',
        startMenu: 'Startmenü',
      },
    },
    en: {
      brand: {
        eyebrow: 'Local AI knowledge assistant',
        title: 'Install LokLM',
        copy: "We'll set up LokLM under your user account — shortcuts, autostart, and the install location are up to you.",
      },
      steps: {
        welcome: 'Start',
        license: 'License',
        hardware: 'Hardware',
        options: 'Options',
        install: 'Install',
        finish: 'Done',
      },
      welcome: {
        kicker: 'Welcome',
        title: "Glad you're giving LokLM a try.",
        copy: "We'll install LokLM under your user account. No admin rights, no system folders — everything stays in your profile. On the next screens you'll pick the install location, shortcuts, and autostart.",
        feature_local_title: 'No admin needed',
        feature_local_desc: 'Everything stays under your account, nothing changes system-wide.',
        feature_cleanup_title: 'Clean to remove',
        feature_cleanup_desc: 'Uninstall from "Apps & features" with one click.',
        feature_appstyle_title: 'Your setup',
        feature_appstyle_desc: 'You decide where and how deeply LokLM integrates.',
      },
      license: {
        kicker: 'License',
        title: 'Before we start — the MIT license',
        copy: "LokLM is open source under the MIT license. Take a quick read, then we'll move on.",
        loading: 'Loading license text …',
        loadError:
          "We couldn't load the license text. You'll find it in the LICENSE file in the project directory.",
        scrollHint: 'Please scroll to the end of the license to enable acceptance.',
        acceptTitle: 'I accept the MIT license terms.',
        acceptDesc: 'We need your OK before we can continue.',
      },
      hardware: {
        kicker: 'Hardware',
        title: 'Which edition fits your machine?',
        copy: "We took a quick look at your hardware. The recommended edition is marked , but you can pick a different one any time.",
        probing: 'Probing hardware …',
        probeFailed: "Hardware probe failed — you can still pick an edition manually.",
        recommended: 'Recommended',
        gpu: 'GPU',
        cpu: 'CPU',
        ram: 'RAM',
        noGpu: 'No GPU detected',
        vramSuffix: 'VRAM',
        threadsSuffix: 'threads',
      },
      tiers: {
        lite: {
          title: 'Lite',
          subtitle: 'Small and frugal',
          model: 'Qwen3.5-2B',
          size: '~2.3 GB download',
          latency: '~2 s per response',
          body: 'Runs on 8 GB RAM with no GPU. Fast and uncomplicated , but more terse on complex questions than the bigger editions.',
        },
        standard: {
          title: 'Standard',
          subtitle: 'The recommended default',
          model: 'Qwen3.5-4B',
          size: '~4.0 GB download',
          latency: '~3 s per response',
          body: 'Highest answer quality in our eval pool. Fits any dev machine with a few GB of free VRAM or unified memory.',
        },
        pro: {
          title: 'Pro',
          subtitle: 'Headroom for long queries',
          model: 'Qwen3.5-9B',
          size: '~7.0 GB download',
          latency: '~6 s per response',
          body: 'More room for niche topics and longer contexts. Needs a GPU with 8+ GB VRAM or Apple Silicon with 16+ GB unified memory.',
        },
      },
      options: {
        kicker: 'Options',
        title: 'Where should LokLM go, and how should it start?',
        installDirLabel: 'Install folder',
        chooseDir: 'Change',
        hintExisting: 'We found an existing LokLM install — this folder will be updated.',
        hintDefault: 'This folder works for most setups — use "Change" to pick a different one.',
        hintEmpty: 'Please pick an install folder.',
        desktopTitle: 'Shortcut on the desktop',
        desktopDesc: 'Drops a LokLM icon onto your desktop.',
        startMenuTitle: 'In the start menu',
        startMenuDesc: 'Adds LokLM to your Windows start menu.',
        autostartTitle: 'Start with Windows',
        autostartDesc: 'LokLM launches automatically when you sign in.',
      },
      install: {
        kicker: 'Install',
        title: 'Everything ready — shall we?',
        waiting: 'Waiting to start',
        starting: 'Here we go …',
        summaryDir: 'LokLM goes to {dir}.',
        summaryShortcutsNone: 'No shortcuts.',
        summaryShortcutsList: 'Shortcuts: {list}.',
        summaryAutostartOn: 'Autostart is on.',
        summaryAutostartOff: 'Autostart stays off.',
        payloadMissing:
          'The install files are missing. Please run the Windows payload build first.',
      },
      finish: {
        kicker: 'Done',
        title: 'All set — LokLM is here.',
        copy: 'Everything is in place. You can launch LokLM now and start working in your local workspace.',
        installLocation: 'Installed in',
        shortcuts: 'Shortcuts',
        autostart: 'Autostart',
        shortcutsNone: 'None',
        autostartOn: 'Yes',
        autostartOff: 'No',
      },
      nav: {
        back: 'Back',
        next: 'Next',
        install: 'Install',
        launch: 'Launch LokLM',
        close: 'Close',
      },
      progress: {
        'preparing-folder': 'Preparing install folder',
        'copying-files': 'Copying files',
        'applying-options': 'Setting up shortcuts and autostart',
        'registering-uninstaller': 'Registering uninstaller',
        'downloading-models': 'Downloading models',
        'writing-tier-marker': 'Saving configuration',
        done: 'Done',
        modelStart: 'Downloading {model} …',
        modelProgress: 'Downloading {model} … {done} / {total}',
        modelDone: '{model} done',
        modelSkip: '{model} already present , skipping',
      },
      shortcutNames: {
        desktop: 'Desktop',
        startMenu: 'Start menu',
      },
    },
  }

  function lookup(table, key) {
    const parts = String(key).split('.')
    let node = table
    for (const part of parts) {
      if (node == null || typeof node !== 'object' || !(part in node)) return null
      node = node[part]
    }
    return typeof node === 'string' ? node : null
  }

  function interpolate(template, vars) {
    if (!vars) return template
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    })
  }

  // Build a translator bound to a mutable locale. Switch via setLocale().
  // `t()` falls back to English then to the key string itself so missing
  // entries surface visibly instead of crashing the wizard.
  function createI18n(initialLocale = 'de') {
    let locale = DICT[initialLocale] ? initialLocale : 'de'

    function t(key, vars) {
      const primary = lookup(DICT[locale], key)
      if (primary != null) return interpolate(primary, vars)
      const fallback = lookup(DICT.en, key)
      if (fallback != null) return interpolate(fallback, vars)
      return key
    }

    return {
      get locale() {
        return locale
      },
      setLocale(next) {
        if (DICT[next]) locale = next
        return locale
      },
      t,
      availableLocales: Object.keys(DICT),
    }
  }

  const api = { createI18n, DICT }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  } else {
    root.LokLMI18n = api
  }
})(typeof self !== 'undefined' ? self : globalThis)
