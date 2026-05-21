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
        copy: 'Richte LokLM lokal ein, lege Verknuepfungen fest und starte direkt in deinen sicheren Arbeitsbereich.',
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
        title: 'Ein Installer, der sich wie LokLM anfuehlt.',
        copy: 'Dieser Bootstrapper installiert die fertige LokLM-App in dein Benutzerprofil. Keine altmodischen Wizard-Seiten, keine Control-ID-Hacks, kein schwerfaelliger Setup-Dialog.',
        feature_local_title: 'Lokal',
        feature_local_desc: 'Installation unter deinem Windows-Benutzer.',
        feature_cleanup_title: 'Aufraeumbar',
        feature_cleanup_desc: 'Ein Uninstaller-Eintrag wird registriert.',
        feature_appstyle_title: 'App-nah',
        feature_appstyle_desc: 'Optionen und Startverhalten im LokLM-Stil.',
      },
      license: {
        kicker: 'Lizenz',
        title: 'Lizenzvereinbarung',
        copy: 'LokLM steht unter der MIT-Lizenz. Bitte zur Kenntnis nehmen, danach geht es weiter.',
        loading: 'Lizenztext wird geladen ...',
        loadError:
          'Lizenztext konnte nicht geladen werden. Siehe LICENSE-Datei im Projektverzeichnis.',
        scrollHint: 'Bitte bis zum Ende der Lizenz scrollen, um zustimmen zu koennen.',
        acceptTitle: 'Ich akzeptiere die MIT-Lizenzbedingungen.',
        acceptDesc: 'Erforderlich, um mit der Installation fortzufahren.',
      },
      options: {
        kicker: 'Optionen',
        title: 'Installationsziel und Startverhalten',
        installDirLabel: 'Installationsordner',
        chooseDir: 'Waehlen',
        hintExisting: 'Vorhandene LokLM-Installation erkannt. Dieser Ordner wird aktualisiert.',
        hintDefault:
          'Du kannst diesen Ordner verwenden oder ueber "Waehlen" einen anderen Zielordner aussuchen.',
        hintEmpty: 'Bitte einen Installationsordner auswaehlen.',
        desktopTitle: 'Desktop-Verknuepfung',
        desktopDesc: 'Legt eine LokLM-Verknuepfung auf dem Desktop an.',
        startMenuTitle: 'Startmenue-Verknuepfung',
        startMenuDesc: 'Fuegt LokLM im Windows-Startmenue hinzu.',
        autostartTitle: 'Mit Windows starten',
        autostartDesc: 'Startet LokLM automatisch nach der Anmeldung.',
        launchAfterInstallTitle: 'LokLM direkt starten',
        launchAfterInstallDesc:
          'Startet LokLM nach erfolgreicher Installation automatisch und schliesst das Setup.',
      },
      install: {
        kicker: 'Installieren',
        title: 'Bereit fuer die Installation',
        waiting: 'Wartet auf Start',
        starting: 'Installation startet',
        summaryDir: 'LokLM wird nach {dir} installiert.',
        summaryShortcutsNone: 'Es werden keine Verknuepfungen erstellt.',
        summaryShortcutsList: 'Verknuepfungen: {list}.',
        summaryAutostartOn: 'Autostart wird aktiviert.',
        summaryAutostartOff: 'Autostart bleibt deaktiviert.',
        payloadMissing:
          'Die Installations-Payload fehlt. Bitte zuerst den Windows-Payload-Build ausfuehren.',
      },
      finish: {
        kicker: 'Fertig',
        title: 'LokLM ist installiert.',
        copy: 'Die App wurde eingerichtet. Du kannst LokLM jetzt starten und mit deinem lokalen Arbeitsbereich loslegen.',
        installLocation: 'Installationsort',
        shortcuts: 'Verknuepfungen',
        autostart: 'Autostart',
        shortcutsNone: 'Keine',
        autostartOn: 'Aktiviert',
        autostartOff: 'Deaktiviert',
      },
      nav: {
        back: 'Zurueck',
        next: 'Weiter',
        install: 'Installieren',
        launch: 'LokLM starten',
      },
      progress: {
        'preparing-folder': 'Installationsordner vorbereiten',
        'copying-files': 'LokLM-Dateien kopieren',
        'applying-options': 'Verknuepfungen und Autostart anwenden',
        'registering-uninstaller': 'Uninstaller registrieren',
        done: 'Fertig',
      },
      shortcutNames: {
        desktop: 'Desktop',
        startMenu: 'Startmenue',
      },
    },
    en: {
      brand: {
        eyebrow: 'Local AI knowledge assistant',
        title: 'Install LokLM',
        copy: 'Set up LokLM locally, configure shortcuts, and jump straight into your secure workspace.',
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
        title: 'An installer that feels like LokLM.',
        copy: 'This bootstrapper installs the LokLM app into your user profile. No old-school wizard pages, no control-ID hacks, no clunky setup dialog.',
        feature_local_title: 'Local',
        feature_local_desc: 'Installs under your Windows user account.',
        feature_cleanup_title: 'Cleanable',
        feature_cleanup_desc: 'A standard uninstaller entry is registered.',
        feature_appstyle_title: 'App-native',
        feature_appstyle_desc: 'Options and startup behaviour in the LokLM style.',
      },
      license: {
        kicker: 'License',
        title: 'License agreement',
        copy: 'LokLM is released under the MIT license. Please review, then proceed.',
        loading: 'Loading license text ...',
        loadError:
          'Could not load the license text. See the LICENSE file in the project directory.',
        scrollHint: 'Please scroll to the end of the license to enable acceptance.',
        acceptTitle: 'I accept the MIT license terms.',
        acceptDesc: 'Required in order to continue with the installation.',
      },
      options: {
        kicker: 'Options',
        title: 'Install location and startup behaviour',
        installDirLabel: 'Install folder',
        chooseDir: 'Choose',
        hintExisting:
          'An existing LokLM installation was detected. This folder will be updated.',
        hintDefault:
          'You can use this folder, or pick a different target via the "Choose" button.',
        hintEmpty: 'Please pick an install folder.',
        desktopTitle: 'Desktop shortcut',
        desktopDesc: 'Places a LokLM shortcut on the desktop.',
        startMenuTitle: 'Start-menu shortcut',
        startMenuDesc: 'Adds LokLM to the Windows start menu.',
        autostartTitle: 'Start with Windows',
        autostartDesc: 'Launches LokLM automatically after sign-in.',
        launchAfterInstallTitle: 'Launch LokLM right away',
        launchAfterInstallDesc:
          'Starts LokLM automatically after a successful install and closes this setup window.',
      },
      install: {
        kicker: 'Install',
        title: 'Ready to install',
        waiting: 'Waiting to start',
        starting: 'Starting installation',
        summaryDir: 'LokLM will be installed into {dir}.',
        summaryShortcutsNone: 'No shortcuts will be created.',
        summaryShortcutsList: 'Shortcuts: {list}.',
        summaryAutostartOn: 'Autostart will be enabled.',
        summaryAutostartOff: 'Autostart will stay disabled.',
        payloadMissing:
          'The installation payload is missing. Please run the Windows payload build first.',
      },
      finish: {
        kicker: 'Done',
        title: 'LokLM is installed.',
        copy: 'The app is set up. You can launch LokLM now and start working in your local workspace.',
        installLocation: 'Install location',
        shortcuts: 'Shortcuts',
        autostart: 'Autostart',
        shortcutsNone: 'None',
        autostartOn: 'Enabled',
        autostartOff: 'Disabled',
      },
      nav: {
        back: 'Back',
        next: 'Next',
        install: 'Install',
        launch: 'Launch LokLM',
      },
      progress: {
        'preparing-folder': 'Preparing install folder',
        'copying-files': 'Copying LokLM files',
        'applying-options': 'Applying shortcuts and autostart',
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
