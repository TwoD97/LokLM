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

    'why.eyebrow': 'Warum',
    'why.title': 'Lokale KI ist mühsam.\nWir machen sie zugänglich.',
    'why.subtitle':
      'Modelle vergleichen, RAG-Pipelines bauen, Inference lokal aufsetzen, Daten verschlüsseln — das ist eine Menge Arbeit, bevor du die erste Frage stellst. LokLM nimmt dir diesen Teil ab.',
    'why.problem.title': 'Der harte Weg',
    'why.problem.item1': 'Modelle finden, evaluieren und quantisieren',
    'why.problem.item2': 'RAG-Pipeline bauen — Chunking, Embeddings, Retrieval, Reranking',
    'why.problem.item3': 'Inference-Stack lokal aufsetzen (llama.cpp, GPU/CPU, Quant-Level)',
    'why.problem.item4': 'Vault verschlüsseln, Schlüssel verwalten, Backups planen',
    'why.problem.item5': 'Aktuelle RAG-Forschung verfolgen und nachziehen',
    'why.solution.title': 'Mit LokLM',
    'why.solution.tagline': 'Installieren. Dokumente ablegen. Fragen stellen.',
    'why.solution.body':
      'Modellauswahl, Pipeline-Tuning und Verschlüsselung haben wir im Hintergrund erledigt. Du brauchst kein ML-Engineer zu sein, um deine eigenen Dokumente mit einer lokalen KI zu befragen.',
    'why.stat.install': 'Installieren',
    'why.stat.import': 'Importieren',
    'why.stat.ask': 'Fragen',

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

    'why.eyebrow': 'Why',
    'why.title': 'Local AI is hard.\nWe make it usable.',
    'why.subtitle':
      'Comparing models, building RAG pipelines, running inference locally, encrypting data — that is a lot of work before you can ask the first question. LokLM takes that part off your hands.',
    'why.problem.title': 'The hard way',
    'why.problem.item1': 'Find, evaluate, and quantize models',
    'why.problem.item2': 'Build a RAG pipeline — chunking, embeddings, retrieval, reranking',
    'why.problem.item3': 'Set up a local inference stack (llama.cpp, GPU/CPU, quant levels)',
    'why.problem.item4': 'Encrypt the vault, manage keys, plan backups',
    'why.problem.item5': 'Track current RAG research and keep up',
    'why.solution.title': 'With LokLM',
    'why.solution.tagline': 'Install. Drop in documents. Ask.',
    'why.solution.body':
      'We handled model selection, pipeline tuning, and encryption under the hood. You do not need to be an ML engineer to query your own documents with a local AI.',
    'why.stat.install': 'Install',
    'why.stat.import': 'Import',
    'why.stat.ask': 'Ask',

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
