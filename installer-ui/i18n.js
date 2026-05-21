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
        launchAfterInstallTitle: 'Direkt loslegen',
        launchAfterInstallDesc:
          'Nach der Installation startet LokLM von selbst und dieser Dialog schließt sich.',
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
      },
      progress: {
        'preparing-folder': 'Installationsordner wird vorbereitet',
        'copying-files': 'Dateien werden kopiert',
        'applying-options': 'Verknüpfungen und Autostart werden gesetzt',
        'registering-uninstaller': 'Uninstaller wird registriert',
        done: 'Fertig',
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
        launchAfterInstallTitle: 'Jump straight in',
        launchAfterInstallDesc:
          'After install, LokLM starts itself and this setup window closes.',
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
      },
      progress: {
        'preparing-folder': 'Preparing install folder',
        'copying-files': 'Copying files',
        'applying-options': 'Setting up shortcuts and autostart',
        'registering-uninstaller': 'Registering uninstaller',
        done: 'Done',
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
