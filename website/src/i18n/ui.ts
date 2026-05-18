export const languages = {
  de: 'Deutsch',
  en: 'English',
} as const

export type Lang = keyof typeof languages

export const defaultLang: Lang = 'de'

export const ui = {
  de: {
    'nav.features': 'Funktionen',
    'nav.download': 'Download',
    'nav.github': 'GitHub',

    'hero.eyebrow': 'Lokaler KI-Wissensassistent',
    'hero.title': 'Eigene Dokumente befragen — \nvollständig offline.',
    'hero.subtitle':
      'LokLM speichert deine Dokumente verschlüsselt auf dem Gerät und beantwortet Fragen über eine Chat-Oberfläche — mit klickbaren Quellenverweisen. Keine Cloud, keine externen KI-APIs.',
    'hero.cta.download': 'Jetzt herunterladen',
    'hero.cta.learn': 'Funktionen ansehen',
    'hero.badge.offline': '100% offline',
    'hero.badge.encrypted': 'Lokale Verschlüsselung',
    'hero.badge.opensource': 'Open Source · MIT',

    'marquee.eyebrow': 'Unser Stack',
    'marquee.title': 'Auf den Schultern der Open-Source-Community gebaut',

    'features.title': 'Was LokLM kann',
    'features.subtitle':
      'Eine Desktop-Anwendung für alle, die Antworten mit verlässlichen Quellen brauchen — ohne ihre Daten aus der Hand zu geben.',
    'features.offline.title': 'Vollständig offline',
    'features.offline.body':
      'Modelle laufen lokal. Kein Account, kein Telemetrie-Ping, keine API-Aufrufe an externe Anbieter.',
    'features.sources.title': 'Klickbare Quellenverweise',
    'features.sources.body':
      'Jede Antwort enthält Belege aus deinen eigenen Dokumenten — direkt anklickbar bis zur Originalstelle.',
    'features.formats.title': 'PDF, Markdown, Text, Code',
    'features.formats.body':
      'Importiere Dokumente in den gängigen Formaten und organisiere sie in Arbeitsbereichen.',
    'features.crypto.title': 'Verschlüsselter Vault',
    'features.crypto.body':
      'Argon2id-Passwort-Hashing, AES-GCM-Verschlüsselung pro Datei, Wiederherstellung über 18-Wort-Phrase.',
    'features.local.title': 'Daten bleiben bei dir',
    'features.local.body':
      'Alles wird in einer einzigen Vault-Datei gespeichert — leicht zu sichern, leicht zu migrieren.',
    'features.opensource.title': 'Quelltext einsehbar',
    'features.opensource.body':
      'MIT-Lizenz. Audit, fork, beitragen — der gesamte Code ist auf GitHub einsehbar.',

    'download.title': 'Download',
    'download.subtitle':
      'Aktuelle Version. Verifiziere die SHA-256-Prüfsumme vor der Installation.',
    'download.version': 'Version',
    'download.released': 'Veröffentlicht',
    'download.size': 'Größe',
    'download.checksum': 'SHA-256',
    'download.button.windows': 'Für Windows herunterladen',
    'download.button.macos': 'Für macOS herunterladen',
    'download.button.linux': 'Für Linux herunterladen',
    'download.detected': 'Erkannt für dein System',
    'download.comingSoon': 'Bald verfügbar',
    'download.otherPlatforms': 'Weitere Plattformen',
    'download.notice':
      'Erste Installation lädt ca. 20 GB Modelldateien. Stabile Verbindung empfohlen.',
    'download.requirements.title': 'Systemanforderungen',
    'download.requirements.windows': 'Windows 10/11 (x64)',
    'download.requirements.ram': '16 GB RAM empfohlen',
    'download.requirements.disk': '25 GB freier Speicher',

    'footer.tagline': 'LokLM — dein Wissen bleibt lokal.',
    'footer.repo': 'Repository',
    'footer.license': 'Lizenz',
    'footer.imprint': 'Impressum',
    'footer.authors': 'Entwickelt von Denys Tudosa und Dominik Furlan.',
  },
  en: {
    'nav.features': 'Features',
    'nav.download': 'Download',
    'nav.github': 'GitHub',

    'hero.eyebrow': 'Local AI knowledge assistant',
    'hero.title': 'Query your own documents — \nfully offline.',
    'hero.subtitle':
      'LokLM keeps your documents encrypted on-device and answers questions through a chat interface — with clickable citations. No cloud, no external AI APIs.',
    'hero.cta.download': 'Download now',
    'hero.cta.learn': 'See features',
    'hero.badge.offline': '100% offline',
    'hero.badge.encrypted': 'Local encryption',
    'hero.badge.opensource': 'Open source · MIT',

    'marquee.eyebrow': 'Our stack',
    'marquee.title': 'Standing on the shoulders of the open-source community',

    'features.title': 'What LokLM does',
    'features.subtitle':
      'A desktop app for anyone who needs answers with verifiable sources — without handing their data over to a third party.',
    'features.offline.title': 'Fully offline',
    'features.offline.body':
      'Models run locally. No account, no telemetry ping, no calls out to external providers.',
    'features.sources.title': 'Clickable citations',
    'features.sources.body':
      'Every answer cites your own documents — click straight through to the original passage.',
    'features.formats.title': 'PDF, Markdown, Text, Code',
    'features.formats.body':
      'Import documents in the common formats and organise them into workspaces.',
    'features.crypto.title': 'Encrypted vault',
    'features.crypto.body':
      'Argon2id password hashing, AES-GCM per-file encryption, recovery via an 18-word passphrase.',
    'features.local.title': 'Your data stays with you',
    'features.local.body':
      'Everything lives in a single vault file — easy to back up, easy to migrate.',
    'features.opensource.title': 'Source-available',
    'features.opensource.body':
      'MIT licence. Audit, fork, contribute — the full source is on GitHub.',

    'download.title': 'Download',
    'download.subtitle': 'Latest release. Verify the SHA-256 checksum before installing.',
    'download.version': 'Version',
    'download.released': 'Released',
    'download.size': 'Size',
    'download.checksum': 'SHA-256',
    'download.button.windows': 'Download for Windows',
    'download.button.macos': 'Download for macOS',
    'download.button.linux': 'Download for Linux',
    'download.detected': 'Detected for your system',
    'download.comingSoon': 'Coming soon',
    'download.otherPlatforms': 'Other platforms',
    'download.notice':
      'First install pulls ~20 GB of model files. A stable connection is recommended.',
    'download.requirements.title': 'System requirements',
    'download.requirements.windows': 'Windows 10/11 (x64)',
    'download.requirements.ram': '16 GB RAM recommended',
    'download.requirements.disk': '25 GB free disk space',

    'footer.tagline': 'LokLM — your knowledge stays local.',
    'footer.repo': 'Repository',
    'footer.license': 'Licence',
    'footer.imprint': 'Imprint',
    'footer.authors': 'Built by Denys Tudosa and Dominik Furlan.',
  },
} as const

export type UIKey = keyof (typeof ui)['de']

export function t(lang: Lang, key: UIKey): string {
  return ui[lang][key] ?? ui[defaultLang][key]
}
