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

    'social.stars': 'Sterne auf GitHub',
    'social.contributors': 'Mitwirkende',
    'social.contributorsMore': '+{n} weitere',
    'social.trust': 'MIT · Open Source · Code auf GitHub',

    'how.eyebrow': 'So funktioniert es',
    'how.title': 'In drei Schritten.',
    'how.subtitle':
      'Installieren, Dokumente importieren, Fragen stellen — mit Quellen, die du anklicken kannst.',
    'how.step1.label': 'Schritt 1',
    'how.step1.title': 'Dokumente in den Vault ziehen',
    'how.step1.body':
      'PDF, Markdown, Text oder Code per Drag & Drop. LokLM indexiert lokal und verschlüsselt — kein Upload, kein Account.',
    'how.step1.alt': 'Screenshot: Vault-Importansicht mit eingeworfenen Dokumenten',
    'how.step2.label': 'Schritt 2',
    'how.step2.title': 'In natürlicher Sprache fragen',
    'how.step2.body':
      'Stell eine Frage zu deinen Dokumenten. Das Modell läuft auf deiner Maschine — keine Anfrage geht ins Netz.',
    'how.step2.alt': 'Screenshot: Chat-Eingabe mit einer Beispielanfrage',
    'how.step3.label': 'Schritt 3',
    'how.step3.title': 'Quelle prüfen — direkt anklicken',
    'how.step3.body':
      'Jede Antwort enthält Quellenverweise. Ein Klick öffnet die Originalstelle im Dokument.',
    'how.step3.alt': 'Screenshot: aufgeklappte Quellenstelle im Dokumentenpanel',

    'deepdive.citations.eyebrow': 'Belege',
    'deepdive.citations.title': 'Antworten, die ihre Quelle nennen.',
    'deepdive.citations.body':
      'Jede Antwort kommt mit klickbaren Verweisen auf die Stelle im Originaldokument. Wenn das Modell etwas nicht belegen kann, sagt es das.',
    'deepdive.citations.cta': 'Zur Architektur',
    'deepdive.citations.alt': 'Screenshot: Antwort mit Quellen-Chip und Vorschau-Popover',
    'deepdive.vault.eyebrow': 'Vault',
    'deepdive.vault.title': 'Eine verschlüsselte Datei — dein gesamtes Wissen.',
    'deepdive.vault.body':
      'Argon2id-Passwort-Hashing, AES-GCM-Verschlüsselung pro Datei, Wiederherstellung über eine 18-Wort-Phrase. Eine einzige Vault-Datei zum Sichern.',
    'deepdive.vault.cta': 'Architektur ansehen',
    'deepdive.vault.alt': 'Screenshot: Vault-Übersicht mit Verschlüsselungsindikator',
    'deepdive.offline.eyebrow': 'Offline',
    'deepdive.offline.title': 'Kein Netz, kein Problem.',
    'deepdive.offline.body':
      'Das Modell läuft lokal, der Index liegt lokal, die Verschlüsselung passiert lokal. Du kannst LokLM den Netzwerkzugriff entziehen — es ändert nichts.',
    'deepdive.offline.cta': 'Diagramm ansehen',
    'deepdive.offline.alt': 'Screenshot: Statusleiste mit Offline-Indikator',

    'features.moreEyebrow': 'Mehr Funktionen',

    'security.eyebrow': 'Sicherheit',
    'security.title': 'Wo deine Daten leben — und wo nicht.',
    'security.subtitle':
      'Eine Übersicht des Datenflusses. Die gestrichelte Linie ist das Netz — LokLM überquert sie nie.',
    'security.label.documents': 'Deine Dokumente',
    'security.label.index': 'Lokaler Index',
    'security.label.model': 'Lokales Modell',
    'security.label.answer': 'Antwort + Quelle',
    'security.label.vault': 'Verschlüsselter Vault auf Festplatte',
    'security.label.cloud': 'Cloud / Internet',
    'security.label.boundary': 'LokLM überquert diese Linie nie',
    'security.callout.argon': 'Argon2id Passwort-Hashing',
    'security.callout.aes': 'AES-GCM pro Datei',
    'security.callout.phrase': '18-Wort-Wiederherstellungsphrase',
    'security.callout.telemetry': 'Keine Telemetrie, kein Account',

    'usecase.eyebrow': 'Wofür',
    'usecase.title': 'Wo LokLM gut ist.',
    'usecase.subtitle':
      'Vier Beispiele aus der Praxis. Honest framing: das hier ist die Stärke — nicht offene Wissensfragen ohne Kontext.',
    'usecase.lawyer.label': 'Anwalt',
    'usecase.lawyer.question': 'Wo steht die Cap-Rate-Klausel im Mietvertrag?',
    'usecase.lawyer.outcome': 'Belegt in §4.2 von Mietvertrag.pdf',
    'usecase.researcher.label': 'Forscher',
    'usecase.researcher.question': 'Fasse die Methodik dieser drei Paper zusammen.',
    'usecase.researcher.outcome': 'Mit Seitenangaben je Paper',
    'usecase.consultant.label': 'Berater',
    'usecase.consultant.question': 'Was hat der Kunde im Q3-Review zugesagt?',
    'usecase.consultant.outcome': 'Zitiert aus review.docx:12',
    'usecase.developer.label': 'Entwickler',
    'usecase.developer.question': 'Wie ist die Auth-Middleware in diesem Repo konfiguriert?',
    'usecase.developer.outcome': 'Belegt in src/main/auth.ts:88',

    'faq.eyebrow': 'FAQ',
    'faq.title': 'Häufige Fragen.',
    'faq.q1.q': 'Ist LokLM wirklich offline?',
    'faq.q1.a':
      'Ja. Modelle und Index laufen lokal. Die einzige Netzwerkaktivität ist der einmalige Modell-Download bei der Installation und Updates, wenn du sie startest.',
    'faq.q2.q': 'Wie groß sind die Modelle und woher kommen sie?',
    'faq.q2.a':
      'Die Erstinstallation lädt etwa 20 GB Modelldateien (Embedding + LLM) von Hugging Face. Danach läuft alles lokal.',
    'faq.q3.q': 'Kann ich ein eigenes Modell mitbringen (GGUF)?',
    'faq.q3.a':
      'Ja. LokLM nutzt llama.cpp unter der Haube. Eigene GGUF-Modelle lassen sich in den Modellordner legen und in den Einstellungen auswählen.',
    'faq.q4.q': 'Braucht es eine GPU?',
    'faq.q4.a':
      'Nein, aber mit GPU geht es spürbar schneller. Auf 16 GB RAM ohne GPU sind die kleineren Modelle nutzbar.',
    'faq.q5.q': 'Wo werden meine Dokumente gespeichert?',
    'faq.q5.a':
      'In einer einzigen verschlüsselten Vault-Datei in deinem Benutzerordner. Verschlüsselt mit AES-GCM, der Schlüssel wird aus deinem Passwort via Argon2id abgeleitet.',
    'faq.q6.q': 'Ist LokLM so klug wie ChatGPT oder Claude?',
    'faq.q6.a':
      'Nein. Cloud-Modelle laufen auf um Größenordnungen mehr Hardware. LokLM ist für etwas anderes optimiert: Privatsphäre, Quellenverweise auf deine eigenen Dokumente, und vollständig offline. Für offene Wissensfragen ohne Kontext sind Cloud-Modelle weiter besser — LokLM ist stark, wenn die Antwort in deinen eigenen Unterlagen steht.',
    'faq.q7.q': 'Wie sichere ich den Vault?',
    'faq.q7.a':
      'Die Vault-Datei kopierst du wohin du willst — externe Festplatte, Cloud-Speicher (sie ist verschlüsselt), Backup-Tool deiner Wahl.',
    'faq.q8.q': 'Was passiert, wenn ich das Passwort verliere?',
    'faq.q8.a':
      'Du kannst den Vault mit deiner 18-Wort-Wiederherstellungsphrase wiederherstellen. Ohne beides ist der Vault nicht zu öffnen — das ist Absicht.',

    'finalcta.eyebrow': 'Bereit?',
    'finalcta.title': 'Dein Wissen,',
    'finalcta.titleAccent': 'auf deiner Maschine.',
    'finalcta.cta': 'Jetzt herunterladen',
    'finalcta.otherPlatforms': 'Weitere Plattformen',

    'footer.col.product': 'Produkt',
    'footer.col.product.features': 'Funktionen',
    'footer.col.product.download': 'Download',
    'footer.col.product.changelog': 'Changelog',
    'footer.col.product.roadmap': 'Roadmap',
    'footer.col.devs': 'Entwickler',
    'footer.col.devs.repo': 'Repository',
    'footer.col.devs.license': 'Lizenz (MIT)',
    'footer.col.devs.architecture': 'Architektur',
    'footer.col.devs.contributing': 'Mitwirken',
    'footer.col.community': 'Community',
    'footer.col.community.discussions': 'Diskussionen',
    'footer.col.community.issues': 'Issues',
    'footer.col.legal': 'Rechtliches',
    'footer.col.legal.imprint': 'Impressum',
    'footer.col.legal.privacy': 'Datenschutz',

    'imprint.title': 'Impressum',
    'imprint.description': 'Angaben gemäß § 5 ECG / § 25 MedienG',
    'imprint.operatorTitle': 'Betreiber',
    'imprint.operator': 'Denys Tudosa & Dominik Furlan',
    'imprint.contactTitle': 'Kontakt',
    'imprint.contact': 'denys.tudosa@ncm.at',
    'imprint.responsibleTitle': 'Inhaltlich verantwortlich',
    'imprint.responsible': 'Denys Tudosa & Dominik Furlan',
    'imprint.purposeTitle': 'Unternehmensgegenstand',
    'imprint.purpose': 'Entwicklung quelloffener Software (LokLM, MIT-lizenziert).',

    'privacy.title': 'Datenschutz',
    'privacy.description': 'Was diese Seite sammelt — kurze ehrliche Antwort: nichts.',
    'privacy.summaryTitle': 'Kurzfassung',
    'privacy.summary':
      'Diese Webseite sammelt keine personenbezogenen Daten. Keine Analytics, keine Cookies, keine Tracker, keine Drittanbieter-Skripte.',
    'privacy.outboundTitle': 'Ausgehende Verbindungen dieser Seite',
    'privacy.outbound.font':
      'Inter Variable Font wird selbst gehostet — keine externen Schriftladungen.',
    'privacy.outbound.avatars':
      'GitHub-Avatar-Bilder werden direkt von GitHub geladen (für die Mitwirkenden-Reihe). Beim Laden überträgt dein Browser deine IP an GitHub.',
    'privacy.outbound.downloads':
      'Die Installer werden vom LokLM-Mirror geladen. Beim Download überträgt dein Browser deine IP an unseren Mirror.',
    'privacy.appTitle': 'Die LokLM-App',
    'privacy.app':
      'Die Desktop-App selbst macht keine Telemetrie-Aufrufe und braucht keinen Account. Eine Beschreibung des Datenflusses findest du im Abschnitt Architektur auf der Startseite.',
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

    'social.stars': 'GitHub stars',
    'social.contributors': 'Contributors',
    'social.contributorsMore': '+{n} more',
    'social.trust': 'MIT · Open source · Code on GitHub',

    'how.eyebrow': 'How it works',
    'how.title': 'In three steps.',
    'how.subtitle': 'Install, import your documents, ask — with clickable sources.',
    'how.step1.label': 'Step 1',
    'how.step1.title': 'Drag documents into the vault',
    'how.step1.body':
      'PDF, Markdown, text, or code by drag and drop. LokLM indexes locally and encrypted — no upload, no account.',
    'how.step1.alt': 'Screenshot: vault import view with dropped documents',
    'how.step2.label': 'Step 2',
    'how.step2.title': 'Ask in natural language',
    'how.step2.body':
      'Ask about your documents. The model runs on your machine — no request goes to the network.',
    'how.step2.alt': 'Screenshot: chat input with a sample query',
    'how.step3.label': 'Step 3',
    'how.step3.title': 'Verify the source — click straight through',
    'how.step3.body':
      'Every answer carries citations. One click opens the passage in the original document.',
    'how.step3.alt': 'Screenshot: opened source passage in the document panel',

    'deepdive.citations.eyebrow': 'Citations',
    'deepdive.citations.title': 'Answers that name their source.',
    'deepdive.citations.body':
      'Every answer comes with clickable references back to the spot in the original document. If the model cannot back something up, it says so.',
    'deepdive.citations.cta': 'See the architecture',
    'deepdive.citations.alt': 'Screenshot: answer with source chip and preview popover',
    'deepdive.vault.eyebrow': 'Vault',
    'deepdive.vault.title': 'One encrypted file — all of your knowledge.',
    'deepdive.vault.body':
      'Argon2id password hashing, AES-GCM per-file encryption, recovery via an 18-word phrase. A single vault file to back up.',
    'deepdive.vault.cta': 'See the architecture',
    'deepdive.vault.alt': 'Screenshot: vault overview with encryption indicator',
    'deepdive.offline.eyebrow': 'Offline',
    'deepdive.offline.title': 'No network, no problem.',
    'deepdive.offline.body':
      'The model runs locally, the index lives locally, encryption happens locally. You can revoke network access — nothing changes.',
    'deepdive.offline.cta': 'See the diagram',
    'deepdive.offline.alt': 'Screenshot: status bar with offline indicator',

    'features.moreEyebrow': 'More features',

    'security.eyebrow': 'Security',
    'security.title': 'Where your data lives — and where it does not.',
    'security.subtitle':
      'A view of the data flow. The dashed line is the network — LokLM never crosses it.',
    'security.label.documents': 'Your documents',
    'security.label.index': 'Local index',
    'security.label.model': 'Local model',
    'security.label.answer': 'Answer + citation',
    'security.label.vault': 'Encrypted vault on disk',
    'security.label.cloud': 'Cloud / internet',
    'security.label.boundary': 'LokLM never crosses this line',
    'security.callout.argon': 'Argon2id password hashing',
    'security.callout.aes': 'AES-GCM per file',
    'security.callout.phrase': '18-word recovery phrase',
    'security.callout.telemetry': 'No telemetry, no account',

    'usecase.eyebrow': 'Built for',
    'usecase.title': 'What LokLM is good at.',
    'usecase.subtitle':
      'Four real examples. Honest framing: this is its strength — not open knowledge questions without context.',
    'usecase.lawyer.label': 'Lawyer',
    'usecase.lawyer.question': 'Where is the cap rate clause in the lease?',
    'usecase.lawyer.outcome': 'Cited at §4.2 of Lease.pdf',
    'usecase.researcher.label': 'Researcher',
    'usecase.researcher.question': 'Summarise the methodology across these three papers.',
    'usecase.researcher.outcome': 'With page references for each',
    'usecase.consultant.label': 'Consultant',
    'usecase.consultant.question': 'What did the client commit to in the Q3 review?',
    'usecase.consultant.outcome': 'Quoted from review.docx:12',
    'usecase.developer.label': 'Developer',
    'usecase.developer.question': 'How is the auth middleware configured in this codebase?',
    'usecase.developer.outcome': 'Cited at src/main/auth.ts:88',

    'faq.eyebrow': 'FAQ',
    'faq.title': 'Common questions.',
    'faq.q1.q': 'Is LokLM really offline?',
    'faq.q1.a':
      'Yes. Models and index run locally. The only network activity is the one-time model download at install and updates when you initiate them.',
    'faq.q2.q': 'How big are the models, and where do they come from?',
    'faq.q2.a':
      'First install pulls about 20 GB of model files (embedding + LLM) from Hugging Face. After that everything runs locally.',
    'faq.q3.q': 'Can I bring my own model (GGUF)?',
    'faq.q3.a':
      'Yes. LokLM uses llama.cpp under the hood. Drop GGUF files into the model directory and pick them in settings.',
    'faq.q4.q': 'Does it need a GPU?',
    'faq.q4.a':
      "No, but with a GPU it's noticeably faster. On 16 GB of RAM without a GPU the smaller models are usable.",
    'faq.q5.q': 'Where are my documents stored?',
    'faq.q5.a':
      'In a single encrypted vault file in your user directory. Encrypted with AES-GCM, the key derived from your password via Argon2id.',
    'faq.q6.q': 'Is LokLM as smart as ChatGPT or Claude?',
    'faq.q6.a':
      'No. Cloud models run on orders of magnitude more hardware. LokLM is optimised for something different: privacy, citations into your own documents, and fully offline use. For open knowledge questions without context, cloud models remain better — LokLM is strong when the answer is in your own files.',
    'faq.q7.q': 'How do I back up the vault?',
    'faq.q7.a':
      'You copy the vault file anywhere — external drive, cloud storage (it stays encrypted), backup tool of choice.',
    'faq.q8.q': 'What happens if I lose my password?',
    'faq.q8.a':
      'You can recover the vault with your 18-word recovery phrase. Without either, the vault cannot be opened — by design.',

    'finalcta.eyebrow': 'Ready?',
    'finalcta.title': 'Your knowledge,',
    'finalcta.titleAccent': 'on your machine.',
    'finalcta.cta': 'Download now',
    'finalcta.otherPlatforms': 'Other platforms',

    'footer.col.product': 'Product',
    'footer.col.product.features': 'Features',
    'footer.col.product.download': 'Download',
    'footer.col.product.changelog': 'Changelog',
    'footer.col.product.roadmap': 'Roadmap',
    'footer.col.devs': 'Developers',
    'footer.col.devs.repo': 'Repository',
    'footer.col.devs.license': 'Licence (MIT)',
    'footer.col.devs.architecture': 'Architecture',
    'footer.col.devs.contributing': 'Contributing',
    'footer.col.community': 'Community',
    'footer.col.community.discussions': 'Discussions',
    'footer.col.community.issues': 'Issues',
    'footer.col.legal': 'Legal',
    'footer.col.legal.imprint': 'Imprint',
    'footer.col.legal.privacy': 'Privacy',

    'imprint.title': 'Imprint',
    'imprint.description': 'Disclosure under § 5 ECG / § 25 MedienG (Austria).',
    'imprint.operatorTitle': 'Operator',
    'imprint.operator': 'Denys Tudosa & Dominik Furlan',
    'imprint.contactTitle': 'Contact',
    'imprint.contact': 'denys.tudosa@ncm.at',
    'imprint.responsibleTitle': 'Responsible for content',
    'imprint.responsible': 'Denys Tudosa & Dominik Furlan',
    'imprint.purposeTitle': 'Business purpose',
    'imprint.purpose': 'Open-source software development (LokLM, MIT-licensed).',

    'privacy.title': 'Privacy',
    'privacy.description': 'What this site collects — short honest answer: nothing.',
    'privacy.summaryTitle': 'Summary',
    'privacy.summary':
      'This website collects no personal data. No analytics, no cookies, no tracking, no third-party scripts.',
    'privacy.outboundTitle': 'Outbound requests from this site',
    'privacy.outbound.font': 'Inter Variable font is self-hosted — no external font loads.',
    'privacy.outbound.avatars':
      'GitHub avatar images load directly from GitHub (for the contributor row). When they load, your browser sends your IP to GitHub.',
    'privacy.outbound.downloads':
      'Installers are pulled from the LokLM mirror. On download, your browser sends your IP to our mirror.',
    'privacy.appTitle': 'The LokLM app',
    'privacy.app':
      'The desktop app itself makes no telemetry calls and needs no account. A description of the data flow lives in the Architecture section on the home page.',
  },
} as const

export type UIKey = keyof (typeof ui)['de']

export function t(lang: Lang, key: UIKey): string {
  return ui[lang][key] ?? ui[defaultLang][key]
}
