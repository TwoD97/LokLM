export const languages = {
  de: 'Deutsch',
  en: 'English',
} as const

export type Lang = keyof typeof languages

export const defaultLang: Lang = 'de'

export const ui = {
  de: {
    'nav.features': 'Funktionen',
    'nav.menu': 'Menü',
    'nav.label': 'Hauptnavigation',
    'nav.language': 'Sprache',
    'nav.download': 'Download',
    'nav.blog': 'Blog',
    'nav.github': 'GitHub',

    'hero.eyebrow': 'Lokaler KI-Wissensassistent',
    'hero.title': 'Eigene Dokumente befragen — \nvollständig offline.',
    'hero.subtitle':
      'LokLM speichert Arbeitsbereichsdaten lokal und beantwortet Fragen mit klickbaren Quellenverweisen. Vault und Arbeitsbereichs-Datenbanken sind verschlüsselt; mitgelieferte Modelle benötigen keine externen KI-APIs.',
    'hero.cta.download': 'Jetzt herunterladen',
    'hero.cta.learn': 'Funktionen ansehen',
    'hero.badge.offline': 'Offline nutzbar',
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
      'Eine Desktop-Anwendung zum Befragen eigener Dokumente — mit Quellenverweisen zum Gegenprüfen und lokalem Betrieb mit den mitgelieferten Modellen.',
    'features.offline.title': 'Vollständig offline',
    'features.offline.body':
      'Mit den mitgelieferten Modellen läuft die Verarbeitung lokal. Kein Cloud-Account, keine Telemetrie; ein externer Ollama-Server ist nur nach deiner Freigabe nutzbar.',
    'features.sources.title': 'Klickbare Quellenverweise',
    'features.sources.body':
      'Klickbare Quellenverweise öffnen die Originalstelle in deinen Dokumenten und helfen dir, Antworten selbst zu prüfen.',
    'features.formats.title': 'PDF, Word, Code & mehr',
    'features.formats.body':
      'Importiere PDF (auch gescannt, per OCR), Word (DOCX), Markdown, Text, HTML und Quellcode — organisiert in Arbeitsbereichen.',
    'features.crypto.title': 'Verschlüsselter Vault',
    'features.crypto.body':
      'Argon2id-Schlüsselableitung und AES-256-GCM für den Vault. Dein Passwort oder die 18-Wort-Wiederherstellungsphrase entsperrt den Hauptschlüssel; jede Arbeitsbereichs-Datenbank hat einen eigenen Schlüssel.',
    'features.local.title': 'Daten bleiben bei dir',
    'features.local.body':
      'Vault und Arbeitsbereichs-Datenbanken liegen verschlüsselt auf deinem Gerät. Originaldateien bleiben unverändert. Mit den mitgelieferten Modellen werden ihre Inhalte nicht an einen KI-Server übertragen.',
    'features.opensource.title': 'Quelltext einsehbar',
    'features.opensource.body':
      'MIT-Lizenz. Audit, fork, beitragen — der gesamte Code ist auf GitHub einsehbar.',
    'features.translate.title': 'Lokale Übersetzung',
    'features.translate.body':
      'Übersetze Dokumente und Textstellen mit dem ausgewählten Sprachmodell. Mit dem mitgelieferten Modell bleibt der Text lokal.',
    'features.transcribe.title': 'Audio-Transkription',
    'features.transcribe.body':
      'Transkribiere Audio lokal mit Whisper, inklusive Sprechertrennung — speichere das Transkript in einen Arbeitsbereich und befrage es wie jedes Dokument.',
    'features.code.title': 'Codebasen durchsuchen',
    'features.code.body':
      'Indiziere ganze Repositories mit code-spezifischen Embeddings; Antworten verweisen auf Datei und Zeile (z. B. auth.ts:88), inklusive Ordner-Sync.',
    'features.study.title': 'Lernen, zusammenfassen, schreiben',
    'features.study.body':
      'Erzeuge Quizze und Zusammenfassungen aus deinen Dokumenten und nutze den Schreibassistenten — mit den mitgelieferten Modellen lokal.',

    'download.title': 'Download',
    'download.verify': 'Prüfsumme anzeigen',
    'download.hardware': 'Hardware vor dem Download prüfen',
    'download.hardware.note':
      'Die lokalen KI-Modelle benötigen eine unterstützte GPU. 4 GB Grafikspeicher erlauben nicht jedes Modell und jede Kontextlänge. Prüfe zuerst die Anforderungen und plane Zeit für den Modell-Download ein.',
    'download.subtitle':
      'Aktuelle Version. Verifiziere die SHA-256-Prüfsumme vor der Installation.',
    'download.version': 'Version',
    'download.released': 'Veröffentlicht',
    'download.size': 'Größe',
    'download.checksum': 'SHA-256',
    'download.button.windows': 'Für Windows herunterladen',
    'download.button.macos': 'Für macOS herunterladen',
    'download.button.linux': 'Für Linux herunterladen',
    'download.button.linux.run': 'Linux (.run)',
    'download.button.linux.deb': 'Ubuntu / Debian (.deb)',
    'download.detected': 'Erkannt für dein System',
    'download.comingSoon': 'Bald verfügbar',
    'download.otherPlatforms': 'Weitere Plattformen',
    'download.notice':
      'Bei der Installation lädst du eine Modell-Edition — je nach Wahl ca. 4–8 GB (Lite / Standard / Pro). Stabile Verbindung empfohlen.',
    'download.requirements.title': 'Systemanforderungen',
    'download.requirements.windows': 'Windows 10/11, macOS oder Linux (64-bit)',
    'download.requirements.ram': '12 GB RAM (16 GB für Pro), unterstützte GPU',
    'download.requirements.disk': '~10 GB freier Speicher',

    'footer.tagline': 'LokLM — dein Wissen lokal befragen.',
    'footer.repo': 'Repository',
    'footer.license': 'Lizenz',
    'footer.imprint': 'Impressum',
    'footer.authors': 'Entwickelt von Denys Tudosa.',

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
      'PDF, Markdown, Text oder Code per Drag & Drop. Das mitgelieferte Embedding-Modell indexiert lokal. Der Vektorindex ist standardmäßig verschlüsselt gespeichert; Originaldateien bleiben unverändert.',
    'how.step1.alt': 'Screenshot: Vault-Importansicht mit eingeworfenen Dokumenten',
    'how.step2.label': 'Schritt 2',
    'how.step2.title': 'In natürlicher Sprache fragen',
    'how.step2.body':
      'Stell eine Frage zu deinen Dokumenten. Mit dem mitgelieferten Sprachmodell bleiben Frage und Dokumentkontext auf deiner Maschine.',
    'how.step2.alt': 'Screenshot: Chat-Eingabe mit einer Beispielanfrage',
    'how.step3.label': 'Schritt 3',
    'how.step3.title': 'Quelle prüfen — direkt anklicken',
    'how.step3.body':
      'Klicke auf einen Quellenverweis, um die Originalstelle zu öffnen und zu prüfen, ob sie die Aussage stützt.',
    'how.step3.alt': 'Screenshot: aufgeklappte Quellenstelle im Dokumentenpanel',

    'deepdive.citations.eyebrow': 'Belege',
    'deepdive.citations.title': 'Antworten, die ihre Quelle nennen.',
    'deepdive.citations.body':
      'Klickbare Verweise helfen dir, Aussagen mit den Originalstellen zu vergleichen. Sie garantieren nicht, dass eine Antwort korrekt belegt ist: Das Modell kann Fehler machen oder Widersprüche übersehen.',
    'deepdive.citations.cta': 'Zur Architektur',
    'deepdive.citations.alt': 'Screenshot: Antwort mit Quellen-Chip und Vorschau-Popover',
    'deepdive.vault.eyebrow': 'Vault',
    'deepdive.vault.title': 'Verschlüsselt auf deinem Gerät.',
    'deepdive.vault.body':
      'Argon2id-Schlüsselableitung, AES-256-GCM und ein eigener Schlüssel pro Arbeitsbereich. Der lokale Vault wird über Passwort oder die 18-Wort-Wiederherstellungsphrase entsperrt.',
    'deepdive.vault.cta': 'Architektur ansehen',
    'deepdive.vault.alt': 'Screenshot: Vault-Übersicht mit Verschlüsselungsindikator',
    'deepdive.offline.eyebrow': 'Offline',
    'deepdive.offline.title': 'Kein Netz, kein Problem.',
    'deepdive.offline.body':
      'Mit den mitgelieferten Modellen bleiben Inferenz, Index und Verschlüsselung lokal. Nach dem Modell-Download kannst du diese Funktionen ohne Netzwerkzugriff nutzen.',
    'deepdive.offline.cta': 'Diagramm ansehen',
    'deepdive.offline.alt': 'Screenshot: Statusleiste mit Offline-Indikator',
    'deepdive.study.eyebrow': 'Lernwerkzeuge',
    'deepdive.study.title': 'Aus deinen Unterlagen lernen.',
    'deepdive.study.body':
      'Generiere Quizze aus deinen Dokumenten, fasse lange Texte zusammen und lass dir beim Schreiben helfen — mit den mitgelieferten Modellen auf deinem Gerät.',
    'deepdive.study.cta': 'Funktionen ansehen',
    'deepdive.study.alt': 'Screenshot: aus einem Dokument generiertes Quiz',
    'deepdive.translate.eyebrow': 'Übersetzung',
    'deepdive.translate.title': 'Übersetzen, ohne Cloud.',
    'deepdive.translate.body':
      'Übersetze markierten Text oder ganze Dokumente mit dem ausgewählten Sprachmodell. Mit dem mitgelieferten Modell bleibt der Text lokal; bei freigegebenem externem Ollama wird er an diesen Server gesendet.',
    'deepdive.translate.cta': 'Funktionen ansehen',
    'deepdive.translate.alt': 'Screenshot: Übersetzungsansicht mit Quell- und Zieltext',

    'features.moreEyebrow': 'Mehr Funktionen',

    'security.eyebrow': 'Sicherheit',
    'security.title': 'Wo deine Daten leben — und wo nicht.',
    'security.subtitle':
      'Der Datenfluss mit den mitgelieferten Modellen: Dokumentinhalte bleiben auf dem Gerät. Optional freigegebene externe Ollama-Server sind in diesem lokalen Ablauf nicht dargestellt.',
    'security.label.documents': 'Deine Dokumente',
    'security.label.index': 'Lokaler Index',
    'security.label.model': 'Lokales Modell',
    'security.label.answer': 'Antwort + Quelle',
    'security.label.vault': 'Verschlüsselter Vault auf Festplatte',
    'security.label.cloud': 'Cloud / Internet',
    'security.label.boundary': 'Lokale Verarbeitung ohne Dokument-Upload',
    'security.callout.argon': 'Argon2id Passwort-Hashing',
    'security.callout.aes': 'AES-256-GCM-Verschlüsselung',
    'security.callout.phrase': '18-Wort-Wiederherstellungsphrase',
    'security.callout.telemetry': 'Keine Telemetrie, kein Account',

    'usecase.eyebrow': 'Wofür',
    'usecase.title': 'Deine Unterlagen. Dein Arbeitsalltag.',
    'usecase.subtitle':
      'Arbeite mit den Unterlagen, die du bereits hast. Diese Beispielfragen zeigen einen möglichen Einstieg; prüfe Antworten immer an den Originalstellen.',
    'usecase.business.label': 'Kleine Unternehmen',
    'usecase.business.question': 'Welche Schritte nennt unser Handbuch für eine Rücksendung?',
    'usecase.business.outcome': 'Den Ablauf im aktuellen Handbuch nachlesen',
    'usecase.lawyer.label': 'Anwalt',
    'usecase.lawyer.question': 'Wo steht die Cap-Rate-Klausel im Mietvertrag?',
    'usecase.lawyer.outcome': 'Die Klausel im Originalvertrag prüfen',
    'usecase.researcher.label': 'Forschung & Studium',
    'usecase.researcher.question': 'Fasse die Methodik dieser drei Paper zusammen.',
    'usecase.researcher.outcome': 'Die Methodik in jedem Paper nachlesen',
    'usecase.consultant.label': 'Beratung & Selbstständige',
    'usecase.consultant.question': 'Was hat der Kunde im Q3-Review zugesagt?',
    'usecase.consultant.outcome': 'Zusagen mit dem freigegebenen Protokoll abgleichen',
    'usecase.developer.label': 'Entwickler',
    'usecase.developer.question': 'Wie ist die Auth-Middleware in diesem Repo konfiguriert?',
    'usecase.developer.outcome': 'Die Erklärung an Datei und Aufrufern prüfen',

    'faq.eyebrow': 'FAQ',
    'faq.title': 'Häufige Fragen.',
    'faq.q1.q': 'Ist LokLM wirklich offline?',
    'faq.q1.a':
      'Ja, mit den mitgelieferten Modellen funktioniert LokLM nach dem Modell-Download offline. Downloads und Updates benötigen eine Verbindung. Optional kannst du Ollama nutzen: Für einen externen Server musst du die Zieladresse ausdrücklich freigeben. Je nach gewähltem Anbieter werden Fragen, Dokumentpassagen für Chat oder Embeddings sowie Übersetzungstexte dorthin gesendet.',
    'faq.q2.q': 'Wie groß sind die Modelle und woher kommen sie?',
    'faq.q2.a':
      'Bei der Installation wählst du eine Edition: Lite (Qwen3.5-4B, ~3,6 GB, für integrierte Grafik / 12 GB RAM), Standard (Qwen3.5-4B, ~4 GB, empfohlen) oder Pro (Qwen3.5-9B, ~7 GB). Diese Angaben sind Downloadgrößen, keine VRAM-Anforderungen. Die Edition enthält auch ein Embedding-Modell (BGE-M3 bei Lite, Qwen3-Embedding bei Standard und Pro) und den BGE Reranker v2-M3. Auf kleinen GPUs bleibt der Reranker im Automatikmodus deaktiviert.',
    'faq.q3.q': 'Kann ich ein eigenes Modell mitbringen (GGUF)?',
    'faq.q3.a':
      'Ja. LokLM führt GGUF-Modelle lokal über llama.cpp aus — eigene GGUF-Dateien lassen sich in den Modellordner legen und in den Einstellungen auswählen. Alternativ kannst du Ollama für Chat, Embeddings und optionales Reranking auswählen. Ein Server auf einem anderen Rechner benötigt deine ausdrückliche Freigabe.',
    'faq.q4.q': 'Braucht es eine GPU?',
    'faq.q4.a':
      'Für die mitgelieferten KI-Modelle ist eine unterstützte integrierte oder dedizierte GPU mit passendem Treiber erforderlich; reine CPU-Inferenz ist deaktiviert. Das Sprachmodell kann teilweise auf der GPU und teilweise auf der CPU laufen. Auf 4-GB-GPUs werden Chat- und Embedding-Modelle bei Bedarf gewechselt. Ob ein Modell passt und wie schnell es läuft, hängt von Modell, Kontextlänge und freiem Speicher ab. CUDA ist für unterstützte NVIDIA-GPUs optional.',
    'faq.q5.q': 'Wo werden meine Dokumente gespeichert?',
    'faq.q5.a':
      'Vault, Arbeitsbereichs-Datenbanken und erzeugte Texte liegen verschlüsselt im LokLM-Datenordner. Der Vektorindex ist standardmäßig verschlüsselt gespeichert; während der Nutzung gibt es ein lokales Klartext-Arbeitsverzeichnis, das beim Sperren wieder verschlüsselt wird. Für nicht vertrauliche Bestände kannst du einen dauerhaft unverschlüsselten Vektorindex wählen. Importierte Originaldateien bleiben an ihrem bisherigen Ort und werden nicht verändert oder nachträglich verschlüsselt.',
    'faq.q6.q': 'Ist LokLM so klug wie ChatGPT oder Claude?',
    'faq.q6.a':
      'Nein. Cloud-Modelle laufen auf um Größenordnungen mehr Hardware. LokLM ist für etwas anderes optimiert: Privatsphäre, Quellenverweise auf deine eigenen Dokumente, und vollständig offline. Für offene Wissensfragen ohne Kontext sind Cloud-Modelle weiter besser — LokLM ist stark, wenn die Antwort in deinen eigenen Unterlagen steht.',
    'faq.q7.q': 'Wie sichere ich meine Daten?',
    'faq.q7.a':
      'Sperre den Vault oder beende LokLM vor dem Kopieren des Datenordners. Sichere importierte Originaldateien separat. Falls du unverschlüsselte Vektorindizes gewählt hast, enthält auch das Backup diese unverschlüsselten Daten.',
    'faq.q8.q': 'Was passiert, wenn ich das Passwort verliere?',
    'faq.q8.a':
      'Du kannst den Vault mit deiner 18-Wort-Wiederherstellungsphrase wiederherstellen. Ohne beides ist der Vault nicht zu öffnen — das ist Absicht.',

    'blog.title': 'Blog',
    'blog.lead':
      'Beiträge zu lokaler KI, Datenschutz, DSGVO und EU AI Act, Architektur und Retrieval — fundiert, mit Quellen.',
    'blog.allPosts': 'Alle Beiträge',
    'blog.taggedWith': 'Beiträge zum Thema',
    'blog.readMore': 'Weiterlesen',
    'blog.backToBlog': 'Zurück zum Blog',
    'blog.rss': 'RSS-Feed',
    'blog.published': 'Veröffentlicht',
    'blog.updated': 'Aktualisiert',
    'blog.readingTime': '{min} Min. Lesezeit',
    'blog.translation': 'Übersetzung',
    'blog.newer': 'Neuerer Beitrag',
    'blog.older': 'Älterer Beitrag',
    'blog.tagsLabel': 'Themen',
    'blog.empty': 'Noch keine Beiträge in dieser Ansicht.',

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
    'imprint.operator': 'Denys Tudosa',
    'imprint.contactTitle': 'Kontakt',
    'imprint.contact': 'denys.tudosa@ncm.at',
    'imprint.responsibleTitle': 'Inhaltlich verantwortlich',
    'imprint.responsible': 'Denys Tudosa',
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
      'Die Desktop-App macht keine Telemetrie-Aufrufe und braucht keinen Cloud-Account. Die mitgelieferten Modelle verarbeiten Inhalte lokal. Ein optional freigegebener externer Ollama-Server erhält die Inhalte für die dort ausgewählten Funktionen, etwa Chat, Embeddings oder Übersetzung.',

    // --- SEO cluster: pillars ---
    'pillar.privacy.title': 'Lokale KI & Datenschutz',
    'pillar.privacy.lead':
      'Mit den mitgelieferten Modellen bleiben Dokumentinhalte auf deinem Gerät; der Vault ist verschlüsselt und es gibt keine Telemetrie. Ein optionaler externer Ollama-Server erhält Inhalte erst nach deiner Freigabe. Hier liest du, was lokale KI für DSGVO, EU AI Act und deine Daten konkret bedeutet.',
    'pillar.architecture.title': 'Architektur',
    'pillar.architecture.lead':
      'Mit den mitgelieferten Modellen werden deine Dokumente lokal zerlegt, hybrid durchsucht (Stichwort + Bedeutung) und als Kontext für Antworten mit Quellenverweisen genutzt: llama.cpp, lokale Embeddings, verschlüsselter Vault. Optional freigegebene Ollama-Anbieter können einzelne KI-Funktionen übernehmen.',
    'pillar.benchmarks.title': 'Benchmarks',
    'pillar.benchmarks.lead':
      'Zahlen statt Versprechen: reproduzierbare Messungen, wie gut Retrieval und Embeddings auf deutschen Fachtexten wirklich treffen — mit Methode und Rohdaten zum Nachrechnen. Ehrlich, auch wo es noch hakt.',
    // --- SEO cluster: personas ---
    'persona.lawyer.title': 'Verträge und Akten mit lokaler KI durchsuchen',
    'persona.lawyer.lead':
      'Verträge und Schriftsätze mit den mitgelieferten Modellen offline durchsuchen. Quellenverweise öffnen Fundstellen wie „§4.2 in Mietvertrag.pdf“ zum Gegenprüfen; sie garantieren keine korrekte Antwort.',
    'persona.research.title': 'Lokale KI für Forschung und Studium',
    'persona.research.lead':
      'Importiere deine PDFs und stelle Methodik- und Inhaltsfragen über den ganzen Stapel — mit Quellenverweisen zum Prüfen. Mit den mitgelieferten Modellen bleibt dein unveröffentlichter Entwurf auf dem Gerät.',
    'persona.consulting.title': 'Lokale KI für Beratung und Projektunterlagen',
    'persona.consulting.lead':
      'Mandantenunterlagen, Angebote und Protokolle mit den mitgelieferten Modellen lokal befragen. Quellenverweise helfen dir, Antworten direkt im Dokument zu prüfen.',
    'persona.development.title': 'Code und Dokumentation mit lokaler KI befragen',
    'persona.development.lead':
      'Lass die mitgelieferten Modelle deinen eigenen Code und deine Doku lokal durchsuchen. Quellenverweise führen zu Datei und Stelle, damit du Aussagen im Code prüfen kannst.',
    // --- SEO cluster: persona FAQs ---
    'persona.lawyer.faq.q1': 'Verlassen vertrauliche Mandantsunterlagen das Gerät?',
    'persona.lawyer.faq.a1':
      'Mit den mitgelieferten Modellen bleiben Inhalte auf dem Gerät. Wenn du einen externen Ollama-Server ausdrücklich freigibst, werden Inhalte für die dort ausgewählten KI-Funktionen an diese Adresse gesendet.',
    'persona.lawyer.faq.q2': 'Kann ich jede Antwort bis zur Fundstelle nachprüfen?',
    'persona.lawyer.faq.a2':
      'Quellenverweise öffnen die zitierte Originalstelle, bei PDFs mit Seitenangabe. Prüfe die Aussage selbst: Ein vorhandener Verweis garantiert nicht, dass die Quelle sie stützt.',
    'persona.lawyer.faq.q3': 'Wie große Aktenbestände kann ich durchsuchen?',
    'persona.lawyer.faq.a3':
      'LokLM ist auf große Bestände ausgelegt; tausende Seiten werden lokal indexiert und durchsuchbar.',
    'persona.research.faq.q1': 'Gelangt mein unveröffentlichter Entwurf an externe Anbieter?',
    'persona.research.faq.a1':
      'Mit den mitgelieferten Modellen bleiben Quellen und Fragen lokal. Optional freigegebene externe Ollama-Anbieter erhalten die Inhalte für die dort ausgewählten Funktionen, auch für Embeddings.',
    'persona.research.faq.q2': 'Bekomme ich zitierfähige Stellen mit Seitenzahl?',
    'persona.research.faq.a2':
      'Quellenverweise können die konkrete PDF-Stelle samt Seite öffnen. Prüfe Originaltext und Aussage, bevor du die Stelle zitierst.',
    'persona.research.faq.q3': 'Kann ich viele PDFs auf einmal einlesen?',
    'persona.research.faq.a3':
      'Ja. Du legst einen Stapel PDFs in einen Arbeitsbereich und befragst sie gemeinsam.',
    'persona.consulting.faq.q1': 'Bleiben Mandantenunterlagen vertraulich?',
    'persona.consulting.faq.a1':
      'Der lokale Vault ist verschlüsselt, ohne Telemetrie oder Cloud-Account. Mit den mitgelieferten Modellen bleiben Inhalte lokal; ein ausdrücklich freigegebener externer Ollama-Anbieter erhält die dort verarbeiteten Inhalte.',
    'persona.consulting.faq.q2': 'Funktioniert das auch ohne Internet, etwa beim Kunden vor Ort?',
    'persona.consulting.faq.a2': 'Ja, mit den mitgelieferten Modellen nach dem Modell-Download.',
    'persona.consulting.faq.q3': 'Kann ich verschiedene Mandate getrennt halten?',
    'persona.consulting.faq.a3': 'Ja. Du organisierst Dokumente in getrennten Arbeitsbereichen.',
    'persona.development.faq.q1': 'Verlässt mein Quellcode das Gerät?',
    'persona.development.faq.a1':
      'Mit den mitgelieferten Modellen wird Code lokal indexiert und befragt. Ein ausdrücklich freigegebener externer Ollama-Anbieter erhält die Inhalte für die dort ausgewählten Funktionen.',
    'persona.development.faq.q2': 'Bekomme ich Verweise auf die konkrete Datei und Stelle?',
    'persona.development.faq.a2':
      'Quellenverweise können die Fundstelle im Code öffnen. Prüfe dort, ob die Erklärung zutrifft.',
    'persona.development.faq.q3': 'Welche Formate kann ich einlesen?',
    'persona.development.faq.a3': 'Quellcode, Markdown, Text und PDF.',
    // --- SEO cluster: shared link labels ---
    'persona.business.title': 'Lokale KI für Unternehmensdokumente',
    'persona.business.lead':
      'Handbücher, Prozessbeschreibungen und Projektunterlagen auf dem eigenen Rechner befragen. LokLM ist ein persönlicher Desktop-Arbeitsbereich für Mitarbeitende – kein gemeinsam verwaltetes Team-Wiki.',
    'persona.business.faq.q1': 'Können mehrere Personen denselben Arbeitsbereich bearbeiten?',
    'persona.business.faq.a1':
      'LokLM ist eine lokale Desktop-Anwendung. Gemeinsame Echtzeitbearbeitung, zentrale Rollenverwaltung und ein synchronisierter Team-Vault werden hier nicht angeboten. Nutze getrennte Installationen und die freigegebenen Originaldateien deiner Organisation.',
    'persona.business.faq.q2': 'Wie starte ich mit einem internen Handbuch?',
    'persona.business.faq.a2':
      'Importiere zunächst eine freigegebene, aktuelle Fassung in einen eigenen Arbeitsbereich. Warte auf die Indexierung, stelle eine konkrete Frage und öffne die genannte Quelle. Prüfe besonders Versionsdatum und Geltungsbereich.',
    'persona.business.faq.q3': 'Ersetzt eine KI-Antwort unsere verbindliche Prozessbeschreibung?',
    'persona.business.faq.a3':
      'Nein. Maßgeblich bleibt das freigegebene Originaldokument. Das Modell kann Quellen falsch zuordnen oder Widersprüche übersehen; kontrolliere den Ablauf vor der Anwendung.',
    'cluster.relatedPillars': 'Mehr erfahren',
    'cluster.relatedPersonas': 'Anwendungsfälle',
    'cluster.readArchitecture': 'Vollständige Architektur lesen',
  },
  en: {
    'nav.features': 'Features',
    'nav.menu': 'Menu',
    'nav.label': 'Main navigation',
    'nav.language': 'Language',
    'nav.download': 'Download',
    'nav.blog': 'Blog',
    'nav.github': 'GitHub',

    'hero.eyebrow': 'Local AI knowledge assistant',
    'hero.title': 'Query your own documents — \nfully offline.',
    'hero.subtitle':
      'LokLM stores workspace data locally and answers questions with clickable citations. The vault and workspace databases are encrypted; bundled models need no external AI APIs.',
    'hero.cta.download': 'Download now',
    'hero.cta.learn': 'See features',
    'hero.badge.offline': 'Works offline',
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
      'A desktop app for querying your own documents — with citations you can check and local processing with the bundled models.',
    'features.offline.title': 'Fully offline',
    'features.offline.body':
      'The bundled models process content locally. No cloud account or telemetry; an external Ollama server requires your explicit consent.',
    'features.sources.title': 'Clickable citations',
    'features.sources.body':
      'Clickable citations open the original passage in your documents and help you check answers yourself.',
    'features.formats.title': 'PDF, Word, code & more',
    'features.formats.body':
      'Import PDF (including scanned, via OCR), Word (DOCX), Markdown, text, HTML, and source code — organised into workspaces.',
    'features.crypto.title': 'Encrypted vault',
    'features.crypto.body':
      'Argon2id key derivation and AES-256-GCM for the vault. Your password or the 18-word recovery phrase unlocks the master key; each workspace database has its own key.',
    'features.local.title': 'Your data stays with you',
    'features.local.body':
      'The vault and workspace databases are encrypted on your device. Original files stay unchanged. With the bundled models, their contents are not sent to an AI server.',
    'features.opensource.title': 'Source-available',
    'features.opensource.body':
      'MIT licence. Audit, fork, contribute — the full source is on GitHub.',
    'features.translate.title': 'Local translation',
    'features.translate.body':
      'Translate documents and passages with the selected language model. With the bundled model, the text stays local.',
    'features.transcribe.title': 'Audio transcription',
    'features.transcribe.body':
      'Transcribe audio locally with Whisper, including speaker separation — save the transcript into a workspace and query it like any document.',
    'features.code.title': 'Search your codebase',
    'features.code.body':
      'Index whole repositories with code-specialised embeddings; answers cite the file and line (e.g. auth.ts:88), with folder sync.',
    'features.study.title': 'Study, summarise, write',
    'features.study.body':
      'Generate quizzes and summaries from your documents and use the writing assistant — locally with the bundled models.',

    'download.title': 'Download',
    'download.subtitle': 'Latest release. Verify the SHA-256 checksum before installing.',
    'download.version': 'Version',
    'download.released': 'Released',
    'download.size': 'Size',
    'download.checksum': 'SHA-256',
    'download.button.windows': 'Download for Windows',
    'download.button.macos': 'Download for macOS',
    'download.button.linux': 'Download for Linux',
    'download.button.linux.run': 'Linux (.run)',
    'download.button.linux.deb': 'Ubuntu / Debian (.deb)',
    'download.detected': 'Detected for your system',
    'download.comingSoon': 'Coming soon',
    'download.otherPlatforms': 'Other platforms',
    'download.notice':
      'During setup you download one model edition — about 4–8 GB depending on your choice (Lite / Standard / Pro). A stable connection is recommended.',
    'download.requirements.title': 'System requirements',
    'download.requirements.windows': 'Windows 10/11, macOS, or Linux (64-bit)',
    'download.requirements.ram': '12 GB RAM (16 GB for Pro), supported GPU',
    'download.requirements.disk': '~10 GB free disk space',

    'footer.tagline': 'LokLM — query your knowledge locally.',
    'footer.repo': 'Repository',
    'footer.license': 'Licence',
    'footer.imprint': 'Imprint',
    'footer.authors': 'Built by Denys Tudosa.',

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
      'PDF, Markdown, text, or code by drag and drop. The bundled embedding model indexes locally. Vector storage is encrypted by default; original files stay unchanged.',
    'how.step1.alt': 'Screenshot: vault import view with dropped documents',
    'how.step2.label': 'Step 2',
    'how.step2.title': 'Ask in natural language',
    'how.step2.body':
      'Ask about your documents. With the bundled language model, your question and document context stay on your machine.',
    'how.step2.alt': 'Screenshot: chat input with a sample query',
    'how.step3.label': 'Step 3',
    'how.step3.title': 'Verify the source — click straight through',
    'how.step3.body':
      'Click a citation to open the original passage and check whether it supports the claim.',
    'how.step3.alt': 'Screenshot: opened source passage in the document panel',

    'deepdive.citations.eyebrow': 'Citations',
    'deepdive.citations.title': 'Answers that name their source.',
    'deepdive.citations.body':
      'Clickable references help you compare claims with the original passages. They do not guarantee that an answer is supported: the model can make mistakes or overlook conflicting sources.',
    'deepdive.citations.cta': 'See the architecture',
    'deepdive.citations.alt': 'Screenshot: answer with source chip and preview popover',
    'deepdive.vault.eyebrow': 'Vault',
    'deepdive.vault.title': 'Encrypted on your device.',
    'deepdive.vault.body':
      'Argon2id key derivation, AES-256-GCM, and a separate key per workspace. Your password or the 18-word recovery phrase unlocks the local vault.',
    'deepdive.vault.cta': 'See the architecture',
    'deepdive.vault.alt': 'Screenshot: vault overview with encryption indicator',
    'deepdive.offline.eyebrow': 'Offline',
    'deepdive.offline.title': 'No network, no problem.',
    'deepdive.offline.body':
      'With the bundled models, inference, the index and encryption stay local. After downloading the models, you can use these functions without network access.',
    'deepdive.offline.cta': 'See the diagram',
    'deepdive.offline.alt': 'Screenshot: status bar with offline indicator',
    'deepdive.study.eyebrow': 'Study tools',
    'deepdive.study.title': 'Learn from your own material.',
    'deepdive.study.body':
      'Generate quizzes from your documents, summarise long texts, and get help while writing — on your device with the bundled models.',
    'deepdive.study.cta': 'See the features',
    'deepdive.study.alt': 'Screenshot: a quiz generated from a document',
    'deepdive.translate.eyebrow': 'Translation',
    'deepdive.translate.title': 'Translate without the cloud.',
    'deepdive.translate.body':
      'Translate selected text or whole documents with the selected language model. The bundled model keeps text local; a consented external Ollama server receives the text when selected.',
    'deepdive.translate.cta': 'See the features',
    'deepdive.translate.alt': 'Screenshot: translation view with source and target text',

    'features.moreEyebrow': 'More features',

    'security.eyebrow': 'Security',
    'security.title': 'Where your data lives — and where it does not.',
    'security.subtitle':
      'The data flow with the bundled models: document contents stay on your device. Optional external Ollama servers that you explicitly approve are not shown in this local workflow.',
    'security.label.documents': 'Your documents',
    'security.label.index': 'Local index',
    'security.label.model': 'Local model',
    'security.label.answer': 'Answer + citation',
    'security.label.vault': 'Encrypted vault on disk',
    'security.label.cloud': 'Cloud / internet',
    'security.label.boundary': 'Local processing without document uploads',
    'security.callout.argon': 'Argon2id password hashing',
    'security.callout.aes': 'AES-256-GCM encryption',
    'security.callout.phrase': '18-word recovery phrase',
    'security.callout.telemetry': 'No telemetry, no account',

    'usecase.eyebrow': 'Built for',
    'usecase.title': 'Your documents. Your everyday work.',
    'usecase.subtitle':
      'Work with the documents you already have. These example questions suggest a starting point; always check answers against the original passages.',
    'usecase.business.label': 'Small businesses',
    'usecase.business.question': 'What steps does our handbook give for handling a return?',
    'usecase.business.outcome': 'Check the process in the current handbook',
    'usecase.lawyer.label': 'Lawyer',
    'usecase.lawyer.question': 'Where is the cap rate clause in the lease?',
    'usecase.lawyer.outcome': 'Check the clause in the original contract',
    'usecase.researcher.label': 'Research & study',
    'usecase.researcher.question': 'Summarise the methodology across these three papers.',
    'usecase.researcher.outcome': 'Read the methods in each original paper',
    'usecase.consultant.label': 'Consulting & independent work',
    'usecase.consultant.question': 'What did the client commit to in the Q3 review?',
    'usecase.consultant.outcome': 'Compare commitments with the approved notes',
    'usecase.developer.label': 'Developer',
    'usecase.developer.question': 'How is the auth middleware configured in this codebase?',
    'usecase.developer.outcome': 'Check the explanation against files and callers',

    'faq.eyebrow': 'FAQ',
    'faq.title': 'Common questions.',
    'faq.q1.q': 'Is LokLM really offline?',
    'faq.q1.a':
      'Yes, with the bundled models LokLM works offline after the model download. Downloads and updates need a connection. You can optionally use Ollama: an external server requires your explicit approval of its destination address. Depending on the selected provider, questions, document passages for chat or embeddings, and translation text are sent there.',
    'faq.q2.q': 'How big are the models, and where do they come from?',
    'faq.q2.a':
      'At setup you pick an edition: Lite (Qwen3.5-4B, ~3.6 GB, for integrated graphics / 12 GB RAM), Standard (Qwen3.5-4B, ~4 GB, recommended), or Pro (Qwen3.5-9B, ~7 GB). These are download sizes, not VRAM requirements. The edition also includes an embedding model (BGE-M3 for Lite, Qwen3-Embedding for Standard and Pro) and BGE Reranker v2-M3. On small GPUs, Auto leaves the reranker disabled.',
    'faq.q3.q': 'Can I bring my own model (GGUF)?',
    'faq.q3.a':
      'Yes. LokLM runs GGUF models locally through llama.cpp — drop your own GGUF files into the model directory and pick them in settings. Alternatively, select Ollama for chat, embeddings and optional reranking. A server on another machine requires your explicit consent.',
    'faq.q4.q': 'Does it need a GPU?',
    'faq.q4.a':
      'The bundled AI models require a supported integrated or dedicated GPU with a working driver; CPU-only inference is disabled. The language model can run partly on the GPU and partly on the CPU. On 4 GB GPUs, chat and embedding models are swapped as needed. Whether a model fits and how fast it runs depend on the model, context length and free memory. CUDA is optional for supported NVIDIA GPUs.',
    'faq.q5.q': 'Where are my documents stored?',
    'faq.q5.a':
      'The vault, workspace databases and generated texts are encrypted in the LokLM data folder. Vector storage is encrypted by default; while in use it has a local plaintext working directory, which is encrypted again when you lock the vault. You can choose permanently unencrypted vectors for non-sensitive collections. Imported original files stay in their existing location and are not modified or encrypted by LokLM.',
    'faq.q6.q': 'Is LokLM as smart as ChatGPT or Claude?',
    'faq.q6.a':
      'No. Cloud models run on orders of magnitude more hardware. LokLM is optimised for something different: privacy, citations into your own documents, and fully offline use. For open knowledge questions without context, cloud models remain better — LokLM is strong when the answer is in your own files.',
    'faq.q7.q': 'How do I back up my data?',
    'faq.q7.a':
      'Lock the vault or quit LokLM before copying its data folder. Back up imported original files separately. If you selected unencrypted vector indexes, the backup includes those unencrypted files too.',
    'faq.q8.q': 'What happens if I lose my password?',
    'faq.q8.a':
      'You can recover the vault with your 18-word recovery phrase. Without either, the vault cannot be opened — by design.',

    'blog.title': 'Blog',
    'blog.lead':
      'Posts on local AI, privacy, GDPR and the EU AI Act, architecture and retrieval — grounded, with sources.',
    'blog.allPosts': 'All posts',
    'blog.taggedWith': 'Posts tagged',
    'blog.readMore': 'Read more',
    'blog.backToBlog': 'Back to the blog',
    'blog.rss': 'RSS feed',
    'blog.published': 'Published',
    'blog.updated': 'Updated',
    'blog.readingTime': '{min} min read',
    'blog.translation': 'Translation',
    'blog.newer': 'Newer post',
    'blog.older': 'Older post',
    'blog.tagsLabel': 'Topics',
    'blog.empty': 'No posts in this view yet.',

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
    'imprint.operator': 'Denys Tudosa',
    'imprint.contactTitle': 'Contact',
    'imprint.contact': 'denys.tudosa@ncm.at',
    'imprint.responsibleTitle': 'Responsible for content',
    'imprint.responsible': 'Denys Tudosa',
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
      'The desktop app makes no telemetry calls and needs no cloud account. Bundled models process content locally. An optional external Ollama server you explicitly approve receives content for the functions selected there, such as chat, embeddings or translation.',

    // --- SEO cluster: pillars ---
    'pillar.privacy.title': 'Local AI & Privacy',
    'pillar.privacy.lead':
      'With the bundled models, document contents stay on your device; the vault is encrypted and there is no telemetry. An optional external Ollama server receives content only after your consent. Here is what local AI actually means for GDPR, the EU AI Act, and your data.',
    'pillar.architecture.title': 'Architecture',
    'pillar.architecture.lead':
      'With the bundled models, documents are split locally, searched with a hybrid of keywords and meaning, and used as context for answers with source citations: llama.cpp, local embeddings and an encrypted vault. Optional Ollama providers you explicitly approve can handle individual AI functions.',
    'pillar.benchmarks.title': 'Benchmarks',
    'pillar.benchmarks.lead':
      'Numbers, not promises: reproducible measurements of how well retrieval and embeddings actually perform on German technical text — with the method and raw data to check for yourself. Honest, including where it still falls short.',
    // --- SEO cluster: personas ---
    'persona.lawyer.title': 'Search contracts and case files with local AI',
    'persona.lawyer.lead':
      'Search contracts and briefs offline with the bundled models. Citations open passages such as “§4.2 in Lease.pdf” for you to check; they do not guarantee a correct answer.',
    'persona.research.title': 'Local AI for research and study',
    'persona.research.lead':
      'Import your PDFs and ask methodology and content questions across the whole stack — with source references to check. With the bundled models, your unpublished draft stays on your device.',
    'persona.consulting.title': 'Local AI for consulting and project documents',
    'persona.consulting.lead':
      'Query client documents, proposals and notes locally with the bundled models. Citations help you check answers directly against the documents.',
    'persona.development.title': 'Ask local AI about your code and documentation',
    'persona.development.lead':
      'Use the bundled models to search your code and docs locally. Citations point to files and locations so you can check claims against the code.',
    // --- SEO cluster: persona FAQs ---
    'persona.lawyer.faq.q1': 'Do confidential client documents leave the device?',
    'persona.lawyer.faq.a1':
      'With the bundled models, content stays on your device. If you explicitly approve an external Ollama server, content for the AI functions selected there is sent to that address.',
    'persona.lawyer.faq.q2': 'Can I verify every answer down to the source?',
    'persona.lawyer.faq.a2':
      'Citations open the referenced original passage, including the page for PDFs. Check the claim yourself: a citation does not guarantee that its source supports the answer.',
    'persona.lawyer.faq.q3': 'How large a case file can I search?',
    'persona.lawyer.faq.a3':
      'LokLM is built for large corpora; thousands of pages are indexed and searchable locally.',
    'persona.research.faq.q1': 'Does my unpublished draft reach external providers?',
    'persona.research.faq.a1':
      'With the bundled models, sources and questions stay local. Optional external Ollama providers you explicitly approve receive content for the selected functions, including embeddings.',
    'persona.research.faq.q2': 'Do I get citable passages with page numbers?',
    'persona.research.faq.a2':
      'Citations can open the specific PDF passage and page. Check the original text and the answer before citing it.',
    'persona.research.faq.q3': 'Can I import many PDFs at once?',
    'persona.research.faq.a3':
      'Yes. Drop a batch of PDFs into a workspace and query them together.',
    'persona.consulting.faq.q1': 'Do client documents stay confidential?',
    'persona.consulting.faq.a1':
      'The local vault is encrypted, with no telemetry or cloud account. Bundled models keep content local; an external Ollama provider you explicitly approve receives the content it processes.',
    'persona.consulting.faq.q2': 'Does it work without internet, e.g. on-site at a client?',
    'persona.consulting.faq.a2': 'Yes, with the bundled models after the model download.',
    'persona.consulting.faq.q3': 'Can I keep different engagements separate?',
    'persona.consulting.faq.a3': 'Yes. You organize documents into separate workspaces.',
    'persona.development.faq.q1': 'Does my source code leave the device?',
    'persona.development.faq.a1':
      'With the bundled models, code is indexed and queried locally. An external Ollama provider you explicitly approve receives content for the functions selected there.',
    'persona.development.faq.q2': 'Do I get references to the exact file and location?',
    'persona.development.faq.a2':
      'Citations can open the referenced code location. Check there whether the explanation is correct.',
    'persona.development.faq.q3': 'Which formats can I import?',
    'persona.development.faq.a3': 'Source code, Markdown, text and PDF.',
    // --- SEO cluster: shared link labels ---
    'download.verify': 'Show checksum',
    'download.hardware': 'Check your hardware before downloading',
    'download.hardware.note':
      'The local AI models need a supported GPU. A GPU with 4 GB cannot fit every model and context length. Check the requirements first and allow time for the model download.',
    'persona.business.title': 'Local AI for business documents',
    'persona.business.lead':
      'Ask about handbooks, procedures and project documents on your own computer. LokLM is a personal desktop workspace for staff, rather than a centrally managed team wiki.',
    'persona.business.faq.q1': 'Can several people edit the same workspace?',
    'persona.business.faq.a1':
      'LokLM is a local desktop application. It does not offer shared live editing, centralized roles or a synchronized team vault. Use separate installations and the original documents approved by your organization.',
    'persona.business.faq.q2': 'How do I start with an internal handbook?',
    'persona.business.faq.a2':
      'Import an approved, current version into its own workspace. Wait for indexing, ask a specific question and open the cited source. Check the version date and the scope of the procedure.',
    'persona.business.faq.q3': 'Does an AI answer replace our approved procedure?',
    'persona.business.faq.a3':
      'No. The approved original document remains authoritative. The model can misattribute sources or miss contradictions; check the process before acting on it.',
    'cluster.relatedPillars': 'Learn more',
    'cluster.relatedPersonas': 'Use cases',
    'cluster.readArchitecture': 'Read the full architecture',
  },
} as const

export type UIKey = keyof (typeof ui)['de']

export function t(lang: Lang, key: UIKey): string {
  return ui[lang][key] ?? ui[defaultLang][key]
}
