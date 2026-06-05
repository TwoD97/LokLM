# Pflichtenheft

# Lokaler KI-Wissensassistent mit Quellenverifikation

**Projekt: LokLM**

|                     |                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Angebot an**      | Landesberufsschule 4 Salzburg                                                                                                                                            |
| **Auftraggeber**    | Christoph Wirrer                                                                                                                                                         |
| **Auftragnehmer**   | Projektgruppe LokLM                                                                                                                                                      |
| **Projektleiter**   | Denys Tudosa                                                                                                                                                             |
| **Projektmitglied** | Dominik \[Nachname\]                                                                                                                                                     |
| **Version**         | 1.1.2 (Nachtrag) — Original 1.0 signiert am 15.05.2026; v1.1 SMART-Ziele am 18.05.2026; v1.1.1 Sprint-3-Nachtrag am 20.05.2026; v1.1.2 Sprint-4/5-Nachtrag am 28.05.2026 |
| **Dateiname**       | Pflichtenheft_LokLM.md                                                                                                                                                   |
| **Ort, Datum**      | Salzburg, 15.05.2026 (Nachtrag v1.1.1: 20.05.2026; Nachtrag v1.1.2: 28.05.2026)                                                                                          |
| **Bezug**           | Lastenheft_LokLM.md, Version 1.0, 08.05.2026                                                                                                                             |

---

## Nachtrag v1.1.2 — 2026-05-28

Im Zuge der Sprint-4/5-Releases v0.2.7 bis v0.3.0 sind weitere Abweichungen gegenüber dem Stand des Nachtrags v1.1.1 (20.05.2026) entstanden. Geltungsbereich §1.4 ("Abweichungen bedürfen der Zustimmung des Projektleiters und werden im wöchentlichen Fortschrittsbericht erfasst") ist eingehalten — Denys (Projektleiter) hat die Änderungen am 2026-05-28 freigegeben. Der signierte Stand v1.0 sowie die Nachträge v1.1 / v1.1.1 bleiben unverändert nachvollziehbar.

| ID       | Abweichung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Stelle                                       | Begründung                                                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1.1.2-a | **Modell-Tiers umbenannt und LLM-Familie gewechselt**: Profile `lite / full / xl` → `lite / standard / pro`; Haupt-LLM von Qwen3-8B auf die **Qwen3.5-Familie** (lite = Qwen3.5-2B, standard = Qwen3.5-4B, pro = Qwen3.5-9B). Das Pro-Tier nutzt ausdrücklich die **NON-MTP**-Variante von Qwen3.5-9B.                                                                                                                                                                                                                                       | §2.5, §3.8, §5.1.4, §6.1, §8.4, Anhang B     | Qwen3.5 erschien Feb 2026; die Eval-Säule wählte Qwen3.5-9B (non-MTP) als besten Kandidaten. v0.2.7 hatte versehentlich die MTP-Variante gebundlet — ein SSM-/Hybrid-Modell, das node-llama-cpp 3.18.1 nicht laden kann (fehlender Tensor `blk.N.ssm_conv1d.weight`); der v0.2.8-Hotfix stellte auf die ladbare non-MTP-Datei um (SHA256-gepinnt). |
| N1.1.2-b | **Cross-Encoder-Reranker ergänzt**: `bge-reranker-v2-m3` (Q4*K_M) ist in den Tiers \_standard* und _pro_ Teil des Modell-Bundles. Die Retrieval-Pipeline ist jetzt zweistufig: RRF-Fusion (§3.3.4) → Reranking der Top-K-Kandidaten vor dem Promptaufbau.                                                                                                                                                                                                                                                                                    | §3.3, §3.3.4, §5.2, §1.6                     | Reranking hebt die Citation Accuracy (Z-3) gegenüber reiner RRF. Das _lite_-Tier verzichtet aus RAM-/Größen-Gründen auf den Reranker und fällt auf reine RRF-Fusion zurück.                                                                                                                                                                        |
| N1.1.2-c | **Installer komplett neu — Tauri-Wizard + Download-Stub**: Ersetzt sowohl den monolithischen NSIS-Slim-Installer als auch den in-app First-Launch-Downloader aus v1.1.1. Ein winziger Download-Stub (~8 MB) startet einen nativen Tauri-Wizard (~2,8 MB), der die Hardware erkennt, ein Tier + optional CUDA empfiehlt und zur Installationszeit Payload-Archiv (`payload-*.tar.zst`, ~165 MB Win), optionales CUDA-Archiv (~199 MB) und das Tier-Modell-Bundle (lite ~1,7 GB / standard ~3,6 GB / pro ~6,6 GB) lädt.                        | §2.1, §2.3, §2.5, §5.3, §5.4, AP-1.4, AP-1.5 | Der frühere Electron-Wizard war ~300 MB / ~3 s Startzeit; der Tauri-Wizard ~2,8 MB / ~200 ms. Die Trennung von App-Payload, CUDA-Archiv und Modell-Bundle vermeidet unnötige Downloads (z. B. CUDA nur bei NVIDIA) und verlegt die Tier-Wahl von First-Launch auf die Installationszeit. NZ-10 bleibt unberührt (kein Laufzeit-Auto-Update).       |
| N1.1.2-d | **Modelle aus eigenen HF-Buckets + Distribution-CDN**: GGUFs werden aus `huggingface.co/buckets/LokLM/…` (eigene, gespiegelte Buckets von unsloth/lm-kit/gpustack) statt direkt aus Upstream-HF-Repos geladen. Payload-/CDN-Auslieferung über `cdn.loklm.ai`.                                                                                                                                                                                                                                                                                | §5.4                                         | Eigene Buckets schützen Installs vor Upstream-Umbenennungen, Re-Quantisierungen und Takedowns (Reproduzierbarkeit). Ausnahme: das Pro-LLM zeigt noch (per SHA256 gepinnt) auf das Upstream-unsloth-Repo, bis es in einen LokLM-Bucket gespiegelt ist (TODO im Manifest).                                                                           |
| N1.1.2-e | **macOS: Build-Pipeline vorhanden, Release noch ausstehend**: Tauri-mac-Target (`mac.rs`), DMG-Build (`build-installer-dmg.mjs`: `cargo tauri build` + `create-dmg`) und per-arch-Payloads (mac-arm64 / mac-x64) existieren. Die mac-Payloads sind in `payload-manifest.json` jedoch noch Platzhalter (0 Byte, Null-SHA) — **noch nicht publiziert**.                                                                                                                                                                                        | NZ-8, §2.1, §6.7, AP-1.5                     | NZ-8 / §6.7 verschieben sich von „macOS out-of-scope" zu „Build-Pipeline existiert (AP-1.5 teilweise erfüllt); macOS bleibt für die v1-Abgabe **kein zugesicherter** Liefergegenstand, bis Payloads publiziert und auf Zielhardware getestet sind". Ehrliche Abgrenzung: Pipeline ≠ ausgeliefertes Produkt.                                        |
| N1.1.2-f | **UI English-first**: Default-UI-Sprache von Deutsch auf **Englisch** umgestellt; die gesamte App (nicht nur die Einstellungen) ist vollständig EN/DE-übersetzt.                                                                                                                                                                                                                                                                                                                                                                             | §3.8, §6.6                                   | Breitere Zielgruppe (v0.2.9). Z-5 bleibt unberührt — das **Anwenderhandbuch** ist weiterhin deutschsprachig; die UI-Sprache ist jederzeit umstellbar.                                                                                                                                                                                              |
| N1.1.2-g | **Faktische Korrekturen / kleinere Ergänzungen ohne Scope-Wirkung**: (1) Node-Engine/CI auf **Node 24** (statt ≥ 20.10 LTS). (2) **Provider-Abstraktion**: node-llama-cpp ist der gebündelte Default; zusätzlich optionaler **Ollama**-Provider für LLM/Embedder/Reranker mit automatischem Fallback auf „bundled" bei Netzwerk-/Timeout-/Server-Fehlern. (3) Logging-Service unter `src/main/services/logging/`. (4) About-Tab in den Einstellungen + `THIRD_PARTY_NOTICES.md`. (5) Modell-Inferenz in Worker-Thread (`services/workers/`). | §2.4, §5.2, §5.3, §3.8                       | Wartbarkeit/Stabilität. Keine Auswirkung auf das Lokalitätsprinzip (Z-1): der optionale Ollama-Provider kontaktiert ausschließlich eine **lokale** Instanz auf demselben Gerät, kein externer Dienst.                                                                                                                                              |

Freigegeben durch: Denys Tudosa (Projektleiter), 2026-05-28.

---

## Nachtrag v1.1.1 — 2026-05-20

Im Zuge der Sprint-3-Releases v0.2.2 + v0.2.3 sind sechs Abweichungen vom signierten Stand v1.0 entstanden. Geltungsbereich §1.4 ("Abweichungen bedürfen der Zustimmung des Projektleiters und werden im wöchentlichen Fortschrittsbericht erfasst") ist eingehalten — Denys (Projektleiter) hat den Pivot am 2026-05-19 freigegeben.

| ID       | Abweichung                                                                                                                                                                                                                                   | Stelle                                          | Begründung                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1.1.1-a | **Linux-AppImage wird ausgeliefert** (NZ-8 nur noch macOS)                                                                                                                                                                                   | §1.3 NZ-8, §2.1, §2.5, §5.3, §9 AP-Liste        | electron-builder produziert AppImage out-of-the-box; Aufwand minimal, Nutzen für Linux-Studierende substantiell.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N1.1.1-b | **Modell-Bundling im Installer entfällt** — GGUFs werden beim First-Launch von HuggingFace geladen, nicht in den Installer gepackt                                                                                                           | §2.1, §2.3 Diagramm, §5.3, §5.4, §10 R6         | makensis 32-bit konnte \~6 GB Payload nicht packen (`ce49257`); Bunny-Single-File-Upload für 6 GB unzuverlässig. Slim-Installer \~375 MB (Win) / \~500 MB (Linux). Erstdownload \~6 GB beim First-Launch (resumable, SHA256-verifiziert, abbrechbar). NZ-10 bleibt unberührt — das Sprachmodell aktualisiert sich nicht selbst, der einmalige Initial-Pull beim First-Launch ist kein Auto-Update.                                                                                                                                                                                                                                             |
| N1.1.1-c | **Hosting auf eigener Domain (Hetzner-VM + Bunny CDN), nicht GitHub Pages**                                                                                                                                                                  | §2.1, §2.3 Diagramm, §2.5, §5.4, AP-D.1, AP-D.4 | Bunny-CDN-Pull-Zone für Installer-Downloads; Astro-Website rsynct auf dieselbe Hetzner-VM. GitHub Pages bleibt als Fallback dokumentiert.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| N1.1.1-d | **NSIS-Installer ist (noch) unsigniert** statt "signiert" wie in §2.1 v1.0 angekündigt                                                                                                                                                       | §2.1                                            | EV-Cert (\~$300/Jahr) ist out-of-scope für Schul-Abgabe. SmartScreen-Hinweis wird in AP-D.2 dokumentiert. Folge-Arbeit ist AP-1.5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| N1.1.1-e | **AP-1.4 + AP-1.5 ergänzt** (Release-Pipeline + Hardening)                                                                                                                                                                                   | §9.2 AP-Liste                                   | Release-Infrastruktur (NSIS + AppImage + Bunny CDN + MinIO Mirror + Bump-Script) war bisher implizit unter AP-D.1; durch die Pipeline-Tiefe als eigene APs sauberer. **AP-1.5** trackt offene Folge-Items (macOS-DMG, Code-Signing, electron-updater). **Hinweis:** Im Vikunja sind die zwei Tasks (#62 / #63) noch mit den ursprünglich gewählten Titeln "AP-1.1 / AP-1.2 Release-Pipeline" angelegt — die Vikunja-MCP-Schnittstelle exponiert keine Update-Task-Funktion, deshalb bleiben Task-Titel und interne Cross-Refs in der Task-Description vorerst auf den alten Codes. Die paired Outline-Docs sind auf AP-1.4 / AP-1.5 gerenamed. |
| N1.1.1-f | **Faktische Korrekturen ohne Scope-Wirkung**: Embedder ist BGE-M3 (nicht snowflake-arctic-embed-l-v2.0), Modell-Verzeichnis ist `userData/models/` (nicht `process.resourcesPath/models/`), Webroot-Pfad ist `website/` (nicht `homepage/`). | §2.5, §3.3.3, §5.3, §12 Verzeichnisstruktur     | Embedder-Wechsel wurde mit Spec 1 entschieden (BGE-M3 ist multilingual + reranker-kompatibel); im Pflichtenheft nie nachgezogen.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

Freigegeben durch: Denys Tudosa (Projektleiter), 2026-05-20.

---

## Inhaltsverzeichnis

1.  [Einführung](#1-einf%C3%BChrung)
    1. [Zweck und Zielsetzung](#11-zweck-und-zielsetzung)
    2. [Ziele (SMART)](#12-ziele-smart)
    3. [Nicht-Ziele / Abgrenzungskriterien](#13-nicht-ziele--abgrenzungskriterien)
    4. [Geltungsbereich](#14-geltungsbereich)
    5. [Beziehung zum Lastenheft](#15-beziehung-zum-lastenheft)
    6. [Begriffe und Abkürzungen](#16-begriffe-und-abk%C3%BCrzungen)
    7. [Referenzdokumente](#17-referenzdokumente)

2.  [Produktübersicht](#2-produkt%C3%BCbersicht)
3.  [Funktionale Anforderungen](#3-funktionale-anforderungen)
4.  [Datenmodell](#4-datenmodell)
5.  [Schnittstellen](#5-schnittstellen)
6.  [Nichtfunktionale Anforderungen](#6-nichtfunktionale-anforderungen)
7.  [Qualitätsanforderungen](#7-qualit%C3%A4tsanforderungen)
8.  [Testkonzept](#8-testkonzept)
9.  [Phasen- und Terminplan](#9-phasen--und-terminplan)
10. [Risiken](#10-risiken)
11. [Abnahmekriterien](#11-abnahmekriterien)
12. [Anhänge](#12-anh%C3%A4nge)

---

## 1. Einführung

### 1.1 Zweck und Zielsetzung

Dieses Pflichtenheft beschreibt die technische Umsetzung des im Lastenheft definierten Projekts _LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation_. Es richtet sich an die Projektgruppe, den Projektbetreuer und den Auftraggeber und legt verbindlich fest, **wie** die im Lastenheft formulierten Anforderungen technisch realisiert werden.

### 1.2 Ziele (SMART)

Die folgenden Ziele beschreiben den Nutzen aus Sicht der Anwenderinnen und Anwender (Schüler, Lehrlinge, Projektgruppen, Lehrkräfte, Wissensarbeiter). Jedes Ziel ist **s**pezifisch, **m**essbar, **a**ttraktiv, **r**ealistisch und **t**erminiert. Die technische Umsetzung der Ziele wird in den Abschnitten 3–6 spezifiziert.

| ID                                    | Ziel (aus Benutzersicht)                                                                                                                                                                                                                   | Messung                                                                                                                                                                                                                                                            | Termin     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **Z-1 — Datenhoheit**                 | Der Benutzer weiß und kann nachweisen, dass seine Dokumente, Fragen und Antworten das Gerät während der Standardnutzung nicht verlassen — auch Anmeldung und Passwort-Wiederherstellung laufen ohne Drittdienst.                           | Wireshark-Mitschnitt über 30 min Standardnutzung (inkl. Registrierung, Login, Import, Chat, Passwort-Reset): 0 ausgehende Verbindungen außerhalb der Loopback-Schnittstelle.                                                                                       | 12.06.2026 |
| **Z-2 — Eigene Unterlagen befragen**  | Ein Benutzer kann PDF-, Markdown-, Text- und Quellcode-Dateien in benannten Arbeitsbereichen sammeln, in Deutsch und Englisch durchsuchen und kurze Zeit später Fragen dazu stellen — auch wenn er die exakten Wörter nicht mehr erinnert. | Testkorpus 50 Dateien (≤ 5 MB/Datei): 100 % importiert, durchsuchbar p95 ≤ 60 s; Suchtestset 30 Anfragen Recall@5 ≥ 0,7; bilinguales Testset (je 15 DE/EN Fragen) ≥ 80 % korrekte Quellenzuordnung pro Sprache.                                                    | 29.05.2026 |
| **Z-3 — Nachvollziehbare Antworten**  | Bei jeder KI-Antwort kann der Benutzer per Klick zur Originaltextstelle springen und die Aussage selbst überprüfen.                                                                                                                        | Testset 50 Fragen: ≥ 85 % der Antworten enthalten mindestens einen klickbaren, inhaltlich korrekten Quellenverweis (Citation Accuracy).                                                                                                                            | 12.06.2026 |
| **Z-4 — Ehrlichkeit statt Erfindung** | Wenn die eigenen Dokumente keine Antwort enthalten, sagt LokLM das ehrlich — statt eine plausible, aber falsche Antwort zu erfinden.                                                                                                       | 20 „Out-of-Corpus"-Testfragen: ≥ 95 % korrekte Verweigerung, 0 erfundene Quellenangaben (Refusal Rate, Faithfulness).                                                                                                                                              | 12.06.2026 |
| **Z-5 — Lieferbar zum Schulende**     | Ein Erstbenutzer kann LokLM von einer öffentlichen Projektseite kostenlos herunterladen, installieren und ohne IT-Unterstützung den ersten beantworteten Chat führen — gestützt auf ein deutschsprachiges Anwenderhandbuch.                | Projektseite online, Windows-Installer-Download funktioniert; Usability-Test mit 3 Erstnutzern: alle erreichen den ersten beantworteten Chat in ≤ 30 min ab Doppelklick auf den Installer; Handbuch deckt alle 11 Mindestbestandteile aus Lastenheft Abschn. 9 ab. | 26.06.2026 |

Die Zuordnung der Ziele zu funktionalen Anforderungen, Arbeitspaketen und Tests erfolgt in Abschnitt 3 (Funktionale Anforderungen) und Abschnitt 8 (Testkonzept). Die Erreichung wird in Abschnitt 11 (Abnahmekriterien) abgenommen.

### 1.3 Nicht-Ziele / Abgrenzungskriterien

Die folgenden Eigenschaften sind in Version 1 **bewusst nicht enthalten**. Sie sind weder ein Mangel noch ein Defizit der Anwendung, sondern eine Konsequenz aus dem Lokalitäts- und Datenschutzprinzip oder dem zeitlichen Rahmen des Schulprojekts.

| ID        | Nicht-Ziel (aus Benutzersicht)                                                                                                                                                                                                                                                                                                   | Begründung                                                                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NZ-1**  | LokLM synchronisiert Dokumente und Chats _nicht_ zwischen mehreren Geräten desselben Benutzers.                                                                                                                                                                                                                                  | Cloud-Sync widerspricht dem Lokalitätsprinzip; Daten sollen das Gerät nicht verlassen.                                                                         |
| **NZ-2**  | LokLM beantwortet _keine_ Fragen aus allgemeinem Internetwissen — sondern ausschließlich aus den importierten Dokumenten.                                                                                                                                                                                                        | Quellenverifikation ist nur möglich, wenn alle Quellen lokal vorliegen.                                                                                        |
| **NZ-3**  | Mehrere Personen können sich _nicht_ auf derselben Installation eigene Konten teilen; jeder Nutzer bekommt seine eigene Installation.                                                                                                                                                                                            | Einzelgeräte-Anwendung ohne komplexe Rechteverwaltung; Multi-User würde Authentifizierung, Quoten und Mandantentrennung erfordern.                             |
| **NZ-4**  | Es gibt _keine_ iOS-, Android- oder Browser-Erweiterungs-Version.                                                                                                                                                                                                                                                                | Plattform-Scope laut Lastenheft ist Windows-Desktop; mobile Inferenz und mobile Speicherrahmen sind ein eigenes Projekt.                                       |
| **NZ-5**  | Eingescannte PDFs ohne digitalen Text (nur Bilder) können _nicht_ verarbeitet werden.                                                                                                                                                                                                                                            | OCR (Texterkennung) ist eigenes Teilprojekt und außerhalb des Mindestumfangs.                                                                                  |
| **NZ-6**  | Audio- und Videodateien (Vorlesungsmitschnitte, MP3, MP4) werden _nicht_ in durchsuchbaren Text umgewandelt.                                                                                                                                                                                                                     | Sprach-zu-Text ist eigenes Teilprojekt mit eigenem Modellbedarf.                                                                                               |
| **NZ-7**  | Eine Zwei-Faktor-Authentifizierung (Authenticator-App, SMS, Hardware-Token) gibt es _nicht_.                                                                                                                                                                                                                                     | Bei einer Einzelgeräte-Anwendung ohne externes Trust-Domain bringt 2FA keinen Sicherheitsgewinn.                                                               |
| **NZ-8**  | macOS-Installer wird in Version 1 _nicht_ ausgeliefert. Windows-NSIS und Linux-AppImage werden ausgeliefert (siehe AP-1.4). _(Nachtrag v1.1.1 — Linux-AppImage ergänzt; v1.1.2 — macOS-Build-Pipeline existiert inzwischen, Release-Payloads aber noch nicht publiziert → kein zugesicherter v1-Liefergegenstand, s. N1.1.2-e.)_ | Zielplattform laut Lastenheft ist Windows 10/11 (64-bit); Linux-AppImage als zusätzlicher Service. macOS-Cross-Build erfordert macOS-Toolchain (siehe AP-1.5). |
| **NZ-9**  | Echtzeit-Zusammenarbeit (zwei Personen im selben Workspace oder Chat) ist _nicht_ vorgesehen.                                                                                                                                                                                                                                    | Einzelnutzer-Fokus; gemeinsame Bearbeitung erfordert Server und Konfliktlösung.                                                                                |
| **NZ-10** | Das Sprachmodell aktualisiert sich _nicht_ automatisch über das Internet; Updates erfolgen über einen neuen Installer. _(Hinweis Nachtrag v1.1.1: die einmalige Modell-Beschaffung beim First-Launch ist davon nicht betroffen — sie ist ein einmaliger Initial-Pull, kein Auto-Update.)_                                        | Offline-Prinzip — Laufzeit ohne Netzverbindung.                                                                                                                |
| **NZ-11** | Es gibt _keine_ kostenpflichtigen Funktionen, _keine_ Abo-Modelle und _keine_ Online-Lizenzaktivierung.                                                                                                                                                                                                                          | MIT-lizenziertes Schulprojekt ohne kommerzielle Auslieferung.                                                                                                  |
| **NZ-12** | LokLM stellt _keine_ Verbindung zu externen oder gemeinsam genutzten Datenbanken her.                                                                                                                                                                                                                                            | Konflikt mit lokaler Datenhaltung; sämtliche Daten leben in der lokalen DB.                                                                                    |

Die in Abschnitt 3.10 beschriebenen optionalen Erweiterungen (Lokales Feintuning, code-bewusste Aufteilung, automatische Zusammenfassungen) sind **keine Zusicherung**, sondern werden nur umgesetzt, wenn der Mindestumfang stabil läuft (siehe Go/No-Go-Gate G3 in Abschnitt 9.4).

### 1.4 Geltungsbereich

Das Pflichtenheft gilt für die gesamte Projektlaufzeit (04.05.2026 – 26.06.2026). Änderungen werden im Änderungsverzeichnis des Projekthandbuchs dokumentiert. Abweichungen von diesem Pflichtenheft bedürfen der Zustimmung des Projektleiters und werden im wöchentlichen Fortschrittsbericht erfasst.

### 1.5 Beziehung zum Lastenheft

Jede funktionale Anforderung in Abschnitt 3 verweist auf die korrespondierende Anforderung im Lastenheft (Muss / Soll / Kann). Dadurch ist eine vollständige Rückverfolgbarkeit gewährleistet. Anforderungen, die im Lastenheft als **Muss** klassifiziert sind, sind im Mindestumfang dieses Pflichtenhefts enthalten. **Soll**-Anforderungen sind ebenfalls vollständig spezifiziert und im Funktionsumfang enthalten. **Kann**-Anforderungen sind als optionale Erweiterungen beschrieben und werden nur umgesetzt, wenn der Mindestumfang stabil läuft (siehe Abschnitt 9.4 Go/No-Go-Gate G3).

### 1.6 Begriffe und Abkürzungen

| Begriff       | Bedeutung                                                                               |
| ------------- | --------------------------------------------------------------------------------------- |
| **RAG**       | Retrieval-Augmented Generation — Antwortgenerierung auf Basis abgerufener Quelltexte    |
| **Chunk**     | Abschnitt eines Dokuments fester Größe, Einheit der Indexierung und Quellenangabe       |
| **Workspace** | Benannte Sammlung von Dokumenten (synonym: Arbeitsbereich)                              |
| **Citation**  | Strukturierter Quellenverweis im Format `[doc:<id>, chunk:<id>]`                        |
| **Embedding** | Numerischer Vektor, der die semantische Bedeutung eines Textabschnitts repräsentiert    |
| **HNSW**      | Hierarchical Navigable Small World — Indexstruktur für Vektorsuche                      |
| **RRF**       | Reciprocal Rank Fusion — Kombinationsverfahren für Rangfolgen aus mehreren Suchpfaden   |
| **tsvector**  | PostgreSQL-Datentyp für Volltextsuche-Indexierung                                       |
| **GGUF**      | Dateiformat für quantisierte Sprachmodelle (llama.cpp-Ökosystem)                        |
| **IPC**       | Inter-Process Communication — Kommunikation zwischen Electron-Hauptprozess und Renderer |
| **PHB**       | Projekthandbuch                                                                         |
| **AP**        | Arbeitspaket                                                                            |
| **PSP**       | Projektstrukturplan                                                                     |
| **3. NF**     | Dritte Normalform                                                                       |
| **PK / FK**   | Primary Key / Foreign Key                                                               |
| **DSGVO**     | Datenschutz-Grundverordnung                                                             |

### 1.7 Referenzdokumente

| Kürzel        | Dokument                          |
| ------------- | --------------------------------- |
| \[LH\]        | Lastenheft_LokLM.md, Version 1.0  |
| \[PHB\]       | Projekthandbuch_LokLM (in Arbeit) |
| \[ADR-0001\]  | docs/adr/0001-architecture.md     |
| \[SPEC-AUTH\] | docs/specs/auth-recovery.md       |
| \[README\]    | README.md im Projekt-Root         |

---

## 2. Produktübersicht

### 2.1 Produktperspektive

LokLM ist eine eigenständige Desktop-Anwendung _(Nachtrag v1.1.1: Windows + Linux; macOS bleibt out-of-scope, siehe AP-1.5)_. Es bestehen keine Server-Komponenten und keine Laufzeit-Verbindungen zu externen Diensten; lediglich der einmalige First-Launch-Download der Sprach- und Embedding-Modelle aus dem Internet ist erforderlich _(Nachtrag v1.1.1: vor v0.2.2 waren die Modelle gebundled, ab v0.2.2 zieht der ModelDownloader sie nach_ `*userData/models/*`_)_. Die Anwendung wird als NSIS-Installer (Windows) und AppImage (Linux) ausgeliefert und über eine Verteilungs-Webseite auf eigener Domain (Hetzner-VM, gefronted vom Bunny CDN) zur Verfügung gestellt _(Nachtrag v1.1.1: ursprünglich GitHub Pages geplant; auf eigene Domain umgezogen, da die Release-Pipeline ohnehin Hetzner-SSH nutzt)_. Code-Signing für den NSIS-Installer ist als Folge-AP-1.5 vorgesehen.

### 2.2 Hauptfunktionen

LokLM unterstützt den Benutzer im folgenden Ablauf:

1. **Anmeldung** an die Anwendung mit Benutzername und Passwort
2. **Anlegen eines Arbeitsbereichs** für eine bestimmte Dokumentensammlung
3. **Importieren von Dokumenten** (PDF, Markdown, Text, Quellcode, optional DOCX)
4. **Hintergrund-Indexierung** mit Live-Fortschrittsanzeige
5. **Stellen einer Frage** in der Chat-Oberfläche
6. **Erhalten einer Antwort** mit klickbaren Quellenverweisen
7. **Klick auf Quellenverweis** öffnet die Originalpassage mit umliegendem Kontext
8. **Verwerfung der Antwort**, wenn keine passenden Quellen vorhanden sind

### 2.3 Architekturübersicht

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Electron-Anwendung                           │
│                                                                      │
│  ┌────────────────────┐    contextBridge    ┌────────────────────┐  │
│  │  Renderer-Prozess  │◄───────────────────►│  Hauptprozess       │  │
│  │  (React + TS)      │   window.api (IPC)  │  (Node.js + TS)     │  │
│  │                    │                      │                     │  │
│  │  ▸ Login UI        │                      │  ▸ AuthService      │  │
│  │  ▸ Library         │                      │  ▸ DocumentService  │  │
│  │  ▸ Chat            │                      │  ▸ RetrievalService │  │
│  │  ▸ SourceViewer    │                      │  ▸ EmbeddingService │  │
│  │  ▸ Settings        │                      │  ▸ LlamaService     │  │
│  └────────────────────┘                      │  ▸ ChunkerService   │  │
│                                              │  ▸ ParserService    │  │
│                                              └─────────┬───────────┘  │
│                                                        │              │
│                          ┌─────────────────────────────┼──────────┐   │
│                          ▼                             ▼          ▼   │
│              ┌──────────────────┐    ┌──────────────────┐  ┌────────┐ │
│              │ pglite (WASM)    │    │ node-llama-cpp   │  │ FS     │ │
│              │ Postgres-Engine  │    │ Qwen3-8B GGUF    │  │ Models │ │
│              │ + pgvector       │    │ + BGE-M3 GGUF    │  │ pgdata │ │
│              └──────────────────┘    └──────────────────┘  └────────┘ │
│              (Modelle in userData/models/ — gezogen vom                │
│               First-Launch-Downloader, Nachtrag v1.1.1)                  │
│                                                                      │
│  Arbeitsverzeichnis: %APPDATA%/LokLM/                                │
└─────────────────────────────────────────────────────────────────────┘

                       Externe Welt
                            │
                            │ einmalig: Installer-Download
                            │ einmalig: First-Launch Modell-Pull
                            │ (Nachtrag v1.1.1)
                            ▼
                   Hetzner-VM + Bunny CDN (Verteilung)
                   HuggingFace (Modell-Quelle, First-Launch)
```

_Abbildung: Komponenten und Datenflüsse von LokLM. Die gestrichelte Linie trennt die Laufzeit-Anwendung von externen Quellen, die nur einmalig zur Installation kontaktiert werden._

### 2.4 Hardware- und Softwareumgebung

**Mindestanforderungen Endgerät:**

| Komponente          | Mindestanforderung                      | Empfohlen                        |
| ------------------- | --------------------------------------- | -------------------------------- |
| Betriebssystem      | Windows 10 / 11 (64-bit)                | Windows 11                       |
| Prozessor           | x86_64, 4 Kerne                         | 8+ Kerne                         |
| Arbeitsspeicher     | 8 GB                                    | 16 GB+                           |
| Festplattenspeicher | 8 GB freier Platz (Profil "Lite": 3 GB) | 35 GB (Profil "Pro")             |
| Grafik              | Integrierte GPU mit Vulkan/DirectX 12   | NVIDIA GPU mit ≥6 GB VRAM (CUDA) |
| Internet            | nur für Installation                    | nur für Installation             |

**Entwicklungsumgebung:**

| Werkzeug                  | Version                                              |
| ------------------------- | ---------------------------------------------------- |
| Node.js                   | ≥ 20.10 LTS                                          |
| pnpm                      | 10.11.0 (siehe `package.json` `packageManager`-Feld) |
| TypeScript                | 5.6.3                                                |
| Electron                  | 33.0.2                                               |
| Git                       | ≥ 2.40                                               |
| Visual Studio Build Tools | 2022 (für native Module beim `pnpm install`)         |

### 2.5 Eingesetzte Technologien

| Schicht            | Technologie                                                                                                                                                                                                  | Zweck                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anwendungsschale   | Electron 33                                                                                                                                                                                                  | Plattformübergreifender Desktop-Container; hier gezielt für Windows                                                                                                         |
| Frontend-Framework | React 18 + React-Router 6                                                                                                                                                                                    | Komponenten-basierte UI mit Routen                                                                                                                                          |
| Sprache            | TypeScript 5 (strict mode)                                                                                                                                                                                   | Statische Typsicherheit, Domain-Modell als Typen                                                                                                                            |
| Build-System       | electron-vite 2                                                                                                                                                                                              | Schnelles HMR im Entwicklungsbetrieb, optimierte Production-Builds                                                                                                          |
| Datenbank          | pglite 0.4 (WASM Postgres)                                                                                                                                                                                   | In-Process-Postgres ohne separate Installation                                                                                                                              |
| Volltextsuche      | PostgreSQL `tsvector` (deutsch + englisch)                                                                                                                                                                   | Bilinguale Stichwortsuche mit Stemming                                                                                                                                      |
| Vektorsuche        | `pgvector` Extension + HNSW-Index                                                                                                                                                                            | Semantische Suche über Embeddings                                                                                                                                           |
| Embeddings         | BGE-M3 (1024-dim, GGUF Q4*K_M, multilingual) *(Nachtrag v1.1.1: war v1.0 als snowflake-arctic-embed-l-v2.0 spezifiziert; BGE-M3 wurde mit Spec 1 gewählt wegen DE+EN-Coverage und Reranker-Kompatibilität)\_ | Lokale Embedding-Berechnung                                                                                                                                                 |
| Sprachmodell       | Qwen3-8B-Instruct (Q4*K_M, GGUF) *(Nachtrag v1.1.2: ab v0.2.8 Qwen3.5-Familie — lite=2B, standard=4B, pro=9B NON-MTP; s. N1.1.2-a)\_                                                                         | Antwortgenerierung mit aktiviertem `/no_think`-Modus                                                                                                                        |
| LLM-Laufzeit       | node-llama-cpp v3                                                                                                                                                                                            | Vulkan/CUDA/Metal/CPU-adaptive Modell-Inferenz                                                                                                                              |
| PDF-Parsing        | pdf-parse v2 (PDFParse OOP API)                                                                                                                                                                              | Seitengenaue Textextraktion                                                                                                                                                 |
| DOCX-Parsing       | mammoth (Soll-Anforderung)                                                                                                                                                                                   | Word-Dokumente zu Text                                                                                                                                                      |
| Markdown-Renderer  | react-markdown + remark-gfm                                                                                                                                                                                  | Streaming-Antworten mit Tabellen, Code-Blöcken                                                                                                                              |
| Passwort-Hash      | argon2 (Node-Binding)                                                                                                                                                                                        | argon2id für Authentifizierung                                                                                                                                              |
| Code-Doku          | TypeDoc                                                                                                                                                                                                      | Generierung der Schnittstellen-Dokumentation                                                                                                                                |
| Test-Framework     | Vitest                                                                                                                                                                                                       | Unit- und Modul-Tests                                                                                                                                                       |
| Verteilung         | electron-builder + NSIS (Windows) + AppImage (Linux)                                                                                                                                                         | Slim-Installer \~375 MB / \~500 MB _(Nachtrag v1.1.1: AppImage ergänzt, Slim-Pivot statt drei Profil-Tiers — First-Launch-Downloader holt GGUFs in_ `*userData/models/*`_)_ |
| Versionskontrolle  | Git + GitHub                                                                                                                                                                                                 | Tagesaktuelle Commits, Pull-Request-Workflow, Code-Review                                                                                                                   |
| Verteilungs-Site   | Eigene Domain auf Hetzner-VM, statisch via Astro _(Nachtrag v1.1.1: war v1.0 als GitHub Pages spezifiziert; Migration zu Hetzner für gemeinsamen Deploy-Pfad mit der Release-Pipeline, siehe AP-1.4)_        | Download-Seite + Anwender-Dokumentation                                                                                                                                     |

---

## 3. Funktionale Anforderungen

Jede Anforderung in diesem Abschnitt verweist auf einen Eintrag im Lastenheft und auf das verantwortliche Arbeitspaket (PSP-Code, siehe PHB K9 / K10). Format der Verweise: **\[LH-Bereich, Priorität\]** und **\[AP-x.y\]**.

### 3.1 Authentifizierung \[LH-Anmeldung, Muss\] \[AP-2.1\]

#### 3.1.1 Registrierung

- Erstmaliger Anwendungsstart leitet auf einen Registrierungsbildschirm.
- Pflichtfelder: Anzeigename (3–32 Zeichen, beliebig), Passwort (mindestens 10 Zeichen, mindestens ein Zeichen aus drei der vier Klassen Großbuchstaben / Kleinbuchstaben / Ziffern / Sonderzeichen).
- Passwort wird mit **argon2id** (m=65536, t=3, p=4) gehasht. Der Hash wird in Tabelle `users` gespeichert (siehe 4.2).
- Der Salt wird je Benutzer zufällig (16 Byte aus `crypto.randomBytes`) erzeugt und implizit in den argon2-Hash-String integriert.
- Nach erfolgreicher Registrierung werden **5 Wiederherstellungscodes** generiert, einmalig im Klartext angezeigt und nur als argon2id-Hash in `recovery_codes` persistiert. Der Benutzer wird verpflichtet, die Codes zu kopieren oder zu speichern, bevor er fortfährt (Bestätigungs-Checkbox).
- Es kann nur **ein** Benutzer pro Installation existieren (Einzel-Geräte-Anwendung). Eine Mehrbenutzer-Funktion ist nicht Bestandteil von Version 1.

#### 3.1.2 Anmeldung und Abmeldung

- Anmelde-Bildschirm verlangt Anzeigename und Passwort.
- Verifikation per `argon2.verify`. Bei Fehlschlag: generische Fehlermeldung "Anmeldung fehlgeschlagen" (kein Hinweis darauf, welches Feld falsch war).
- Fehlversuchszähler im Hauptprozess; nach **5 aufeinanderfolgenden Fehlversuchen** für die nächsten **5 Minuten** Anmeldung gesperrt (im Memory; bei Anwendungsneustart zurückgesetzt — bewusst, kein Persistenz-Schutz nötig, da Daten verschlüsselt sind).
- Erfolgreiche Anmeldung leitet zur Bibliothek (Library-Route) weiter.
- "Abmelden" verwirft den im Speicher gehaltenen Schlüssel und leitet zurück auf den Anmeldebildschirm.

#### 3.1.3 Passwort-Wiederherstellung \[LH-Passwort-Wiederherstellung, Muss\] \[AP-2.2\]

- Vom Anmeldebildschirm aus erreichbar über "Passwort vergessen?".
- Eingabe: einer der 5 Wiederherstellungscodes.
- Verifikation: argon2id-Vergleich gegen alle nicht-verbrauchten Einträge in `recovery_codes`.
- Bei Treffer wird der Code als **verbraucht** markiert (Spalte `used_at` gesetzt). Verbrauchte Codes können nicht wiederverwendet werden.
- Benutzer kann ein neues Passwort vergeben (gleiche Stärke-Anforderungen wie bei Registrierung).
- Nach Passwort-Reset werden **alle bisherigen Wiederherstellungscodes invalidiert** und 5 neue erzeugt; der Benutzer muss die neuen Codes erneut bestätigen.
- Wenn alle 5 Codes verbraucht sind und der Benutzer das Passwort vergisst, ist eine Wiederherstellung nicht mehr möglich. Dies ist eine bewusste Designentscheidung (Zero-Knowledge-Prinzip): es existiert kein Hintertür-Zugang.

#### 3.1.4 Sitzungs- und Sperrverhalten

- Ein Benutzer-Schlüssel wird beim Login aus dem Passwort und einem benutzerspezifischen Salt (separat zum argon2-Salt) per **PBKDF2 mit 600.000 Iterationen** abgeleitet. Dieser Schlüssel verschlüsselt den pglite-Snapshot (siehe 4.7) und liegt während der Sitzung im Speicher des Hauptprozesses.
- Inaktivitäts-Sperrung: Nach **15 Minuten** ohne IPC-Aktivität wird die Sitzung gesperrt. Der Schlüssel wird aus dem Speicher entfernt; ein Sperrbildschirm erscheint und verlangt erneute Passwort-Eingabe (Wiederherstellungscode-Eingabe an dieser Stelle nicht möglich).
- Manuelle Sperrung über Menü oder Tastenkürzel `Ctrl+L`.
- Beim Anwendungs-Beenden: Schlüssel wird sicher gelöscht (`crypto.timingSafeEqual` plus Buffer-Override), pglite-Cluster wird verschlüsselt persistiert.

### 3.2 Dokumentenimport \[LH-Dokumentenimport, Muss\] \[AP-3.x\]

#### 3.2.1 PDF-Import \[AP-3.1\]

- Eingabe: Lokaler Dateipfad zu `*.pdf`.
- Parser: `pdf-parse` v2, OOP-API (`new PDFParse({data: buffer}).getText()`).
- Pro Seite wird Text extrahiert; Seiten-Nummer wird in `chunks.page_from` / `page_to` mitgeführt.
- Unterstützung **textbasierter** PDFs. Gescannte / OCR-pflichtige PDFs liefern leeren Text und werden mit Statusmeldung "Dokument enthält keinen extrahierbaren Text" abgelehnt (siehe 3.9).

#### 3.2.2 Markdown- und Textimport \[AP-3.2\]

- Akzeptierte Endungen: `.md`, `.markdown`, `.txt`.
- Textbasiertes Lesen mit Encoding-Erkennung (UTF-8 ist Default; bei BOM-Erkennung Fallback auf UTF-8).
- Markdown-Strukturen (Überschriften, Listen) werden bei der Aufteilung respektiert (siehe 3.3.1).

#### 3.2.3 Quellcode-Import \[AP-3.3\]

- Akzeptierte Endungen: `.js`, `.ts`, `.tsx`, `.jsx`, `.py`, `.java`, `.c`, `.cpp`, `.cs`, `.go`, `.rs`, `.rb`, `.php`, `.sql`, `.html`, `.css`, `.yaml`, `.yml`, `.json`, `.xml`.
- Behandlung wie Klartext für Version 1; _code-bewusste Aufteilung_ ist Kann-Anforderung (Abschnitt 3.10.2).

#### 3.2.4 DOCX-Import \[LH-DOCX-Import, Soll\] \[AP-3.4\]

- Bibliothek: `mammoth` (Word XML → Plain-Text-Extraktion).
- Tabellen werden als Pipe-getrennte Zeilen serialisiert; eingebettete Bilder werden ignoriert; Fußnoten werden an den Dokumentenende angehängt mit Markierung `[Fußnote n: ...]`.
- Bekannte Limitierung: komplexe Layouts mit verschachtelten Tabellen können den Lesefluss verändern. Dokumentation in Anwenderhandbuch.

#### 3.2.5 Import-Workflow

```
Benutzer wählt Datei(en)  ──▶  IPC: documents:add(workspaceId, paths[])
                                        │
                                        ▼
                              Datei kopiert nach %APPDATA%/LokLM/files/<doc_id>.<ext>
                                        │
                                        ▼
                              Eintrag in `documents` mit status='pending'
                                        │
                                        ▼
                              DocumentService startet asynchrone Indexierung:
                                ▸ parser.ts wählt Reader anhand MIME / Endung
                                ▸ chunker.ts teilt in Chunks
                                ▸ chunks werden in DB persistiert (Trigger füllt tsvector)
                                ▸ EmbeddingService erzeugt 1024-dim Vektor pro Chunk
                                ▸ status='ready', chunk_count und token_count via Trigger aktualisiert
                                        │
                                        ▼
                              webContents.send('indexing:progress', {docId, percent, stage})
```

### 3.3 Indexierung \[LH-Indexierung, Muss\] \[AP-4.x\]

#### 3.3.1 Chunking \[AP-4.1\]

- Verfahren: rekursiver Zeichen-Splitter (Trennzeichen-Hierarchie: Doppel-Newline → Newline → Satzende-Zeichen `.!?` → Leerzeichen → harter Schnitt).
- Standard-Chunkgröße: **2000 Zeichen**, Standard-Überlappung: **200 Zeichen**.
- Beide Werte sind in den Einstellungen pro Workspace konfigurierbar (Bereich 500–8000 für Größe, 0–500 für Überlappung).
- Pro Chunk werden mitgeführt: `ordinal` (Reihenfolge im Dokument), `page_from` / `page_to` (bei PDFs), `token_count` (näherungsweise = Zeichenanzahl / 4 in Version 1; ein echter Tokenizer wird nachgezogen, wenn das Embedding-Modell geladen ist).

#### 3.3.2 Stichwort-Index \[LH-Suche, Muss\] \[AP-4.2\]

- Spalte `chunks.text_search` vom Typ `tsvector`.
- Befüllt durch BEFORE-INSERT-Trigger `chunks_tsv_biu`, der den Wert wie folgt setzt:

  ```sql
  setweight(to_tsvector('german',  text), 'A')
  || setweight(to_tsvector('english', text), 'B')
  ```

- GIN-Index `idx_chunks_fts` über `text_search`.
- Suche zur Laufzeit:

  ```sql
  SELECT id, document_id, ordinal,
         ts_rank_cd(text_search,
                    plainto_tsquery('german',  $1)
                 || plainto_tsquery('english', $1)) AS score
    FROM chunks
   WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $2)
     AND text_search @@ (plainto_tsquery('german',  $1)
                      || plainto_tsquery('english', $1))
   ORDER BY score DESC
   LIMIT $3;
  ```

#### 3.3.3 Semantischer Index \[LH-Semantische Suche, Soll\] \[AP-4.3\]

- Embedding-Modell: `bge-m3-Q4_K_M.gguf` (1024-dimensionale Vektoren, multilingual DE+EN) _(Nachtrag v1.1.1: Wechsel von snowflake-arctic-embed mit Spec 1)_.
- Ladestrategie: beim Anwendungsstart parallel zum Sprachmodell, Statusmeldungen `embedder:loading`, `embedder:ready`.
- Beim Indexieren wird pro Chunk ein Embedding erzeugt und in `chunks.embedding` (`vector(1024)`) gespeichert.
- HNSW-Index wird einmalig nach erstem Embedding-Backfill erzeugt:

  ```sql
  CREATE INDEX idx_chunks_embedding_hnsw ON chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
  ```

- Suche zur Laufzeit:

  ```sql
  SELECT id, document_id, ordinal,
         1 - (embedding <=> $1::vector) AS score
    FROM chunks
   WHERE document_id IN (SELECT id FROM documents WHERE workspace_id = $2)
   ORDER BY embedding <=> $1::vector
   LIMIT $3;
  ```

- Backfill-Service `EmbeddingBackfillService` indexiert bestehende Chunks im Hintergrund nach. Fortschritt wird per `embedder:progress` gemeldet.

#### 3.3.4 RRF-Fusion \[AP-4.4\]

- Reciprocal Rank Fusion kombiniert die Trefferlisten aus 3.3.2 (Stichwort) und 3.3.3 (semantisch):

  ```
  score(c) = Σ  1 / (k + rank_i(c))     mit  k = 60
            i ∈ {keyword, semantic}
  ```

- Es werden je Pfad die top-K Treffer ermittelt (Default `K = 30`), fusioniert, und die top-N Treffer (Default `N = 10`) für die Antwortgenerierung weitergegeben.
- Wenn das Embedding-Modell nicht geladen ist, fällt die Suche auf den reinen Stichwortpfad zurück.

### 3.4 Arbeitsbereiche \[LH-Arbeitsbereiche, Muss\] \[AP-5.x\]

- Anlegen über die Library-Route mit beliebigem Namen (1–80 Zeichen).
- Umbenennen über Kontextmenü.
- Löschen kaskadiert: Dokumente, Chunks, Konversationen und Nachrichten des Workspace werden über `ON DELETE CASCADE` entfernt; zugehörige Dateien aus `%APPDATA%/LokLM/files/` werden gelöscht.
- Workspace-Wechsel ist sofort wirksam; alle Suchen, Chats und Importe arbeiten gegen den aktiven Workspace.
- Die zuletzt aktive Workspace-ID wird in `settings`-Tabelle (`active_workspace_id`) persistiert.

### 3.5 Suche und Filter \[LH-Suche und Filter, Muss\] \[AP-6\]

- Suchfeld in der Library zeigt Treffer als Liste mit Dokumentname, Seitenzahl und Auszug (Highlighting der Treffer-Begriffe via `ts_headline`).
- Filter: nach Dokumenttyp (PDF / MD / TXT / Code / DOCX), nach Datum, nach Größe.
- Sortierung \[LH-Sortierung, Soll\]: nach Relevanz (Default), nach Dateiname, nach Importdatum.

### 3.6 Chat \[LH-Chat, Muss\] \[AP-7.x\]

#### 3.6.1 Frage stellen \[AP-7.1\]

- Chat-Eingabefeld in der Chat-Route.
- Frage wird mit der aktuellen Workspace-ID an `chat:ask(conversationId, message)` gesendet.
- Bei nicht existierender `conversationId` wird automatisch eine neue Konversation angelegt.

#### 3.6.2 Retrieval und Promptzusammenstellung \[AP-7.2\]

- Frage wird durch `RetrievalService.search(workspaceId, query, K=10)` an die Suche gegeben (RRF-Fusion, siehe 3.3.4).
- Prompt-Aufbau:

  ```
  System:
    Du bist LokLM, ein lokaler Wissensassistent. Antworte ausschließlich
    auf Basis der bereitgestellten Quellen. Verwende für jede Aussage
    eine Quellenangabe im Format [doc:<id>, chunk:<id>]. Wenn die
    Quellen die Frage nicht beantworten, antworte exakt:
    "Diese Information findet sich nicht in den bereitgestellten Dokumenten."
    /no_think

  Quellen:
    [doc:1, chunk:5] <Chunk-Text>
    [doc:1, chunk:6] <Chunk-Text>
    ...

  Frage: <Benutzer-Frage>
  Antwort:
  ```

- Sicherheitsnetz: jeglicher `<think>...</think>`-Block wird aus dem Stream entfernt, bevor er an den Renderer geht (Qwen3-Reasoning-Schutz).

#### 3.6.3 Antwortgenerierung und Streaming \[AP-7.3\]

- `LlamaService.streamCompletion(prompt)` liefert ein Async-Iterable von Tokens.
- Tokens werden über `chat:stream-token`-IPC mit `{conversationId, messageId, token}` an den Renderer gesendet.
- Renderer rendert Tokens inkrementell mit `react-markdown`.
- Bei `chat:stream-end` werden Citation-Marker im Endtext mit Regex `\[doc:(\d+),\s*chunk:(\d+)\]` extrahiert und in die Spalte `messages.citations_json` als JSON-Array `[{document_id, chunk_id, score}]` gespeichert.

#### 3.6.4 Verweigerungslogik \[LH-Fehlerfall, Muss; LH-Zuverlässigkeit, NF\] \[AP-7.4\]

- Wenn die Retrieval-Stufe weniger als **3 Treffer mit RRF-Score ≥ 0,01** liefert, wird die Frage **nicht** an das Sprachmodell weitergegeben. Stattdessen wird die fest verdrahtete Verweigerungs-Antwort gestreamt:

  > _"Diese Information findet sich nicht in den bereitgestellten Dokumenten."_

- Auch bei ausreichend Treffern kann das Modell selbst die Verweigerung produzieren (siehe System-Prompt). Beide Pfade führen zu derselben Antwort und werden in der Eval-Metrik _Refusal Rate_ getrennt gezählt.
- Wenn das Sprachmodell noch nicht geladen ist, läuft eine **deterministische Fallback-Synthese**: die top-3-Chunks werden mit ihren `[doc:X, chunk:Y]`-Markern formatiert ausgegeben, ohne natürliche Sprachgenerierung. So bleibt die Anwendung auch beim ersten Start sofort nutzbar.

#### 3.6.5 Chatverlauf \[LH-Chatverlauf, Soll\] \[AP-7.5\]

- Konversationen werden je Workspace in `conversations` gespeichert.
- Liste der Konversationen in der Sidebar; Klick öffnet die Konversation und stellt alle Nachrichten wieder her.
- Konversationen können umbenannt und gelöscht werden.
- Beim Anlegen einer Konversation wird der Titel aus den ersten 60 Zeichen der ersten Nutzer-Frage abgeleitet, ist aber jederzeit editierbar.

### 3.7 Quellenanzeige \[LH-Quellenverweise und Quellenanzeige, Muss\] \[AP-8\]

- In der Antwort dargestellte Citation-Marker `[doc:X, chunk:Y]` werden vom Renderer in klickbare Chips umgewandelt (Komponente `CitationChip` in `src/renderer/src/components/`).
- Klick auf einen Chip navigiert zur Route `/source/:documentId/:chunkId`.
- Die SourceViewer-Komponente ruft `chunks:get(chunkId, before=1, after=1)` auf, was über die PL/pgSQL-Funktion `get_chunk_with_context` (siehe 4.4) den Ziel-Chunk plus jeweils einen Nachbar-Chunk vor und nach in einer einzigen Datenbank-Abfrage liefert.
- Der Ziel-Chunk wird optisch hervorgehoben (Spalte `is_target` aus dem Funktions-Resultat).
- Bei PDF-Quellen kann zusätzlich die Original-PDF an der entsprechenden Seite mit `react-pdf` angezeigt werden.

### 3.8 Einstellungen \[LH-Einstellungen, Soll\] \[AP-9\]

| Einstellung                      | Bereich                              | Default                      | Wirkung                                        |
| -------------------------------- | ------------------------------------ | ---------------------------- | ---------------------------------------------- |
| Chunkgröße                       | 500 – 8000 Zeichen                   | 2000                         | Pro Workspace; greift bei nächster Indexierung |
| Chunk-Überlappung                | 0 – 500 Zeichen                      | 200                          | Pro Workspace                                  |
| Treffer-Anzahl K                 | 3 – 30                               | 10                           | Wieviele Chunks ans Modell gehen               |
| Modell-Profil                    | lite / standard / pro _(N1.1.2-a)_   | abhängig von verfügbarem RAM | Wechsel löst Modell-Reload aus                 |
| Aktion bei Konversations-Wechsel | "Modell entladen" / "geladen halten" | "geladen halten"             | RAM-Verhalten                                  |
| Theme                            | Hell / Dunkel / System               | System                       | UI-Erscheinung                                 |
| Sprache der UI                   | Deutsch / Englisch                   | Englisch _(N1.1.2-f)_        | i18n                                           |
| Inaktivitäts-Sperre              | 5 / 15 / 60 Min / nie                | 15 Min                       | siehe 3.1.4                                    |

Alle Werte werden in der Tabelle `settings` als `key/value` persistiert.

### 3.9 Fehler- und Sonderfälle

| Situation                                          | Verhalten                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF ohne extrahierbaren Text                       | Dokument-Status `failed`, Fehlermeldung "Dokument enthält keinen extrahierbaren Text (möglicherweise gescannt)". Wird in der Library mit Warn-Symbol angezeigt; kein Indexieren, kein Chunk. |
| Datei zu groß (>50 MB)                             | Hinweismeldung "Datei überschreitet die Größenbegrenzung". Import wird abgebrochen.                                                                                                          |
| Modell-Datei fehlt                                 | Anwendung startet, Modell-Pille zeigt "nicht geladen", Chat-Eingabe nutzt deterministische Fallback-Synthese (siehe 3.6.4). Hinweis in Settings, wo Modell-Datei abgelegt werden muss.       |
| Kein Treffer im Retrieval                          | Verweigerungs-Antwort (siehe 3.6.4).                                                                                                                                                         |
| pglite-Initialisierung schlägt fehl                | Modaler Hinweis mit Pfad zu `%APPDATA%/LokLM/pgdata/`, Vorschlag zur Wiederherstellung aus Backup-Snapshot. Kein automatisches Löschen.                                                      |
| Falsches Passwort beim Entschlüsseln des Snapshots | Entschlüsselung schlägt fehl, generische Anmelde-Fehlermeldung.                                                                                                                              |
| Wiederherstellungscode falsch                      | Allgemeine Fehlermeldung; Fehlversuche zählen wie bei Anmeldung.                                                                                                                             |
| Beschädigte DB-Datei                               | Beim Start wird ein Vor-Snapshot (siehe 4.7) versucht; bei Fehlschlag Hinweis an den Benutzer.                                                                                               |

### 3.10 Optionale Erweiterungen (Kann)

#### 3.10.1 Lokales Feintuning \[LH-Lokales Feintuning, Kann\] \[AP-10.1\]

- Synthetische Trainingsdaten werden mit einem Python-Skript erzeugt: pro Beispiel `(context, question, expected_answer, expected_citations)`.
- Trainings-Pipeline: QLoRA mit `transformers` + `peft`, Basismodell Qwen3-8B.
- Adapter wird zu GGUF konvertiert (`llama.cpp tools/convert_lora_to_gguf.py`) und als zusätzliches Modell-Profil `full-finetuned` geladen.
- Eval-Vergleich gegen Baseline (siehe 8.5).
- **Wird nur durchgeführt, wenn alle Muss- und Soll-Anforderungen vor Ende von Woche 6 abgeschlossen sind und die Pufferwoche nicht für Stabilisierung benötigt wird.**

#### 3.10.2 Code-bewusste Aufteilung \[LH-Code-bewusste Aufteilung, Kann\] \[AP-10.2\]

- Zusätzlicher Splitter in `chunker.ts`, der bei Quellcode-Endungen entlang von Top-Level-Definitionen (Funktion, Klasse, Methode) trennt.
- Sprachen-Heuristik per Regex; Tree-sitter wird nicht eingesetzt (Bundle-Größe).

#### 3.10.3 Dokument-Zusammenfassungen \[LH-Zusammenfassungen, Kann\] \[AP-10.3\]

- Beim Import wird auf Wunsch eine 5-Satz-Zusammenfassung erzeugt, in `documents.summary` gespeichert und in der Library angezeigt.

---

## 4. Datenmodell

### 4.1 Schema-Übersicht

```
┌─────────────┐       ┌──────────────┐       ┌──────────┐
│ users       │       │ workspaces   │       │ settings │
│  id PK      │       │  id PK       │       │  key PK  │
│  display    │       │  name        │       │  value   │
│  pwd_hash   │       │  user_id FK  │       └──────────┘
│  created_at │◄──┐   │  created_at  │
└─────────────┘   │   └──────┬───────┘
                  │          │
                  │          │ 1..n
                  │          ▼
                  │   ┌──────────────────┐       ┌──────────────────┐
                  │   │ documents        │  1..n │ chunks           │
                  │   │  id PK           │──────▶│  id PK           │
                  │   │  workspace_id FK │       │  document_id FK  │
                  │   │  title           │       │  ordinal         │
                  │   │  source_path     │       │  text            │
                  │   │  mime_type       │       │  token_count     │
                  │   │  byte_size       │       │  page_from / to  │
                  │   │  status          │       │  embedding(1024) │
                  │   │  chunk_count     │       │  text_search     │
                  │   │  token_count     │       └──────────────────┘
                  │   │  added_at        │
                  │   └──────────────────┘
                  │
                  │   ┌──────────────────┐       ┌──────────────────┐
                  │   │ conversations    │  1..n │ messages         │
                  │   │  id PK           │──────▶│  id PK           │
                  │   │  workspace_id FK │       │  conv_id FK      │
                  │   │  title           │       │  role            │
                  │   │  created_at      │       │  content         │
                  │   └──────────────────┘       │  citations_json  │
                  │                              │  created_at      │
                  │                              └──────────────────┘
                  │
                  │   ┌─────────────────────┐
                  └───│ recovery_codes      │
                      │  id PK              │
                      │  user_id FK         │
                      │  code_hash          │
                      │  created_at         │
                      │  used_at NULL       │
                      └─────────────────────┘
```

**Tabellenanzahl: 8** (`users`, `recovery_codes`, `workspaces`, `documents`, `chunks`, `conversations`, `messages`, `settings`) — erfüllt die Mindestforderung von ≥5 Tabellen aus dem Lastenheft 8 (Technischer Rahmen).

### 4.2 Tabellen-Definitionen

```sql
-- Benutzer (Einzel-Geräte-Anwendung; Tabelle existiert für 3.NF und FK-Anbindung)
CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  display_name TEXT   NOT NULL CHECK (length(display_name) BETWEEN 3 AND 32),
  password_hash TEXT  NOT NULL,
  created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Wiederherstellungscodes (5 Stück pro Benutzer, hashed, einmal verwendbar)
CREATE TABLE recovery_codes (
  id         SERIAL PRIMARY KEY,
  user_id    INT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT   NOT NULL,
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT,
  used_at    BIGINT NULL
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id) WHERE used_at IS NULL;

-- Arbeitsbereiche
CREATE TABLE workspaces (
  id         SERIAL PRIMARY KEY,
  user_id    INT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT   NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);
CREATE INDEX idx_workspaces_user ON workspaces(user_id);

-- Dokumente
CREATE TABLE documents (
  id            SERIAL PRIMARY KEY,
  workspace_id  INT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         TEXT   NOT NULL,
  source_path   TEXT   NOT NULL,
  mime_type     TEXT,
  byte_size     BIGINT,
  status        TEXT   NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','indexing','ready','failed')),
  chunk_count   INT    NOT NULL DEFAULT 0,
  token_count   BIGINT NOT NULL DEFAULT 0,
  summary       TEXT   NULL,                          -- nur Kann-Anforderung 3.10.3
  added_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);
CREATE INDEX idx_documents_workspace ON documents(workspace_id);
CREATE INDEX idx_documents_status    ON documents(status);

-- Chunks
CREATE TABLE chunks (
  id           SERIAL PRIMARY KEY,
  document_id  INT  NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal      INT  NOT NULL,
  text         TEXT NOT NULL,
  token_count  INT,
  page_from    INT,
  page_to      INT,
  embedding    vector(1024),
  text_search  tsvector,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX idx_chunks_document  ON chunks(document_id);
CREATE INDEX idx_chunks_fts       ON chunks USING GIN (text_search);
-- HNSW-Index wird nach erstem Embedding-Backfill angelegt (siehe 3.3.3).

-- Konversationen
CREATE TABLE conversations (
  id           SERIAL PRIMARY KEY,
  workspace_id INT    NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        TEXT,
  created_at   BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Nachrichten
CREATE TABLE messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT   NOT NULL CHECK (role IN ('user','assistant','system')),
  content         TEXT   NOT NULL,
  citations_json  TEXT,
  created_at      BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);
CREATE INDEX idx_messages_conv ON messages(conversation_id);

-- Einstellungen
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Normalisierung:** alle Tabellen sind in der **3. Normalform**. Die zwei denormalisierten Spalten `documents.chunk_count` und `documents.token_count` sind bewusst gewählt (Anzeige-Performance, Vermeidung von `COUNT(*)` bei jeder Library-Aktualisierung) und werden durch den Trigger `chunks_count_aid` (siehe 4.3) konsistent gehalten. Diese Designentscheidung ist in ADR-0001 dokumentiert.

**Referentielle Integrität:** alle FK-Beziehungen sind mit `ON DELETE CASCADE` versehen. Beim Löschen eines Benutzers werden alle Workspaces, Dokumente, Chunks, Konversationen und Nachrichten transitiv gelöscht.

### 4.3 Trigger (Note 3 — Pflichtartefakt)

#### Trigger 1: `chunks_tsv_biu` (BEFORE INSERT/UPDATE)

Befüllt automatisch die Spalte `text_search` mit der bilingualen tsvector-Repräsentation des Chunks.

```sql
CREATE OR REPLACE FUNCTION chunks_set_tsv() RETURNS TRIGGER AS $$
BEGIN
  NEW.text_search :=
    setweight(to_tsvector('german',  NEW.text), 'A') ||
    setweight(to_tsvector('english', NEW.text), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_tsv_biu
  BEFORE INSERT OR UPDATE OF text ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_set_tsv();
```

**Zweck:** Anwendungscode darf das Suchindex-Feld nicht direkt schreiben; jede Chunk-Mutation pflegt den Index automatisch — Konsistenz garantiert auf Datenbankebene, nicht im Anwendungscode.

#### Trigger 2: `chunks_count_aid` (AFTER INSERT/DELETE)

Hält die denormalisierten Zähler `documents.chunk_count` und `documents.token_count` aktuell.

```sql
CREATE OR REPLACE FUNCTION chunks_update_doc_counters() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE documents
       SET chunk_count = chunk_count + 1,
           token_count = token_count + COALESCE(NEW.token_count, 0)
     WHERE id = NEW.document_id;
    RETURN NEW;
  ELSE
    UPDATE documents
       SET chunk_count = GREATEST(chunk_count - 1, 0),
           token_count = GREATEST(token_count - COALESCE(OLD.token_count, 0), 0)
     WHERE id = OLD.document_id;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chunks_count_aid
  AFTER INSERT OR DELETE ON chunks
  FOR EACH ROW EXECUTE FUNCTION chunks_update_doc_counters();
```

### 4.4 Funktion (Note 2 — Pflichtartefakt)

#### Funktion: `get_chunk_with_context(chunk_id, before, after)`

Liefert den Ziel-Chunk plus seine Nachbar-Chunks (gleiche Ordinal-Reihenfolge, gleiches Dokument) in einer einzigen Datenbank-Abfrage. Verwendet von der Quellen-Anzeige (siehe 3.7).

```sql
CREATE OR REPLACE FUNCTION get_chunk_with_context(
  p_chunk_id INT,
  p_before   INT DEFAULT 1,
  p_after    INT DEFAULT 1
)
RETURNS TABLE (
  id          INT,
  document_id INT,
  ordinal     INT,
  text        TEXT,
  token_count INT,
  page_from   INT,
  page_to     INT,
  is_target   BOOLEAN
)
LANGUAGE sql AS $$
  WITH target AS (
    SELECT document_id, ordinal FROM chunks WHERE chunks.id = p_chunk_id
  )
  SELECT c.id, c.document_id, c.ordinal, c.text,
         c.token_count, c.page_from, c.page_to,
         (c.id = p_chunk_id) AS is_target
    FROM chunks c
    JOIN target t ON c.document_id = t.document_id
   WHERE c.ordinal BETWEEN t.ordinal - p_before AND t.ordinal + p_after
   ORDER BY c.ordinal;
$$;
```

**Begründung:** ohne diese Funktion wären drei separate Abfragen nötig (Ziel-Chunk, Vorgänger, Nachfolger). Die Funktion garantiert atomare Sicht und reduziert die Roundtrips zu pglite (WASM-Aufruf-Overhead).

### 4.5 Prozedur (Note 1 — Pflichtartefakt)

#### Prozedur: `reindex_document(doc_id)`

Löst eine vollständige Neuindexierung eines Dokuments aus: setzt Status, löscht bestehende Chunks (Trigger setzen Zähler zurück), markiert für erneute Verarbeitung. Aufgerufen von der UI über den IPC-Kanal `documents:reindex`.

```sql
CREATE OR REPLACE PROCEDURE reindex_document(p_doc_id INT)
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_doc_id) THEN
    RAISE EXCEPTION 'Document % not found', p_doc_id;
  END IF;

  UPDATE documents SET status = 'indexing' WHERE id = p_doc_id;
  DELETE FROM chunks   WHERE document_id = p_doc_id;
  UPDATE documents
     SET chunk_count = 0,
         token_count = 0,
         status      = 'pending'
   WHERE id = p_doc_id;
END;
$$;
```

### 4.6 Indizes (Übersicht)

| Index                       | Tabelle / Spalten                               | Zweck                             |
| --------------------------- | ----------------------------------------------- | --------------------------------- |
| `idx_workspaces_user`       | `workspaces(user_id)`                           | Workspace-Liste pro Benutzer      |
| `idx_documents_workspace`   | `documents(workspace_id)`                       | Dokument-Liste pro Workspace      |
| `idx_documents_status`      | `documents(status)`                             | Indexierungs-Queue-Abfragen       |
| `idx_chunks_document`       | `chunks(document_id)`                           | Chunks eines Dokuments            |
| `idx_chunks_fts`            | `chunks USING GIN (text_search)`                | Stichwortsuche                    |
| `idx_chunks_embedding_hnsw` | `chunks USING HNSW (embedding)`                 | Semantische Suche (lazy angelegt) |
| `idx_messages_conv`         | `messages(conversation_id)`                     | Nachrichten einer Konversation    |
| `idx_recovery_user`         | `recovery_codes(user_id) WHERE used_at IS NULL` | Aktive Wiederherstellungscodes    |

### 4.7 Datenpersistenz und Verschlüsselung

- pglite-Cluster liegt unter `%APPDATA%/LokLM/pgdata/` (Verzeichnis, kein einzelner File).
- Beim Anwendungs-Beenden oder bei Inaktivitäts-Sperre wird ein Snapshot des Clusters erzeugt (`pg_basebackup`-äquivalent über pglite-API), als TAR komprimiert und mit **AES-256-GCM** verschlüsselt; der Schlüssel wird beim Login per **PBKDF2 (SHA-256, 600.000 Iterationen)** aus dem Passwort und einem benutzerspezifischen Salt aus der Tabelle `settings` (`key='snapshot_salt'`) abgeleitet.
- Beim Anwendungs-Start: Snapshot wird mit dem beim Login abgeleiteten Schlüssel entschlüsselt und in `pgdata/` entpackt. Bei Entschlüsselungs-Fehlschlag: generische Anmelde-Fehlermeldung (kein Aufschluss darüber, ob das Passwort oder der Snapshot fehlerhaft ist).
- Detaillierte Implementierungsentscheidungen siehe `docs/specs/auth-recovery.md` und ADR-0002 (wird in Woche 1 geschrieben).
- Importierte Dateien in `%APPDATA%/LokLM/files/` werden im Klartext gespeichert (Verschlüsselung der Originaldateien ist Kann-Anforderung für künftige Versionen, nicht in Version 1 enthalten).

---

## 5. Schnittstellen

### 5.1 IPC-Schnittstelle (`window.api`)

Vollständige typisierte Definition in `src/preload/index.ts` und `src/renderer/src/types/api.ts`. Alle Aufrufe sind asynchron (`Promise`-basiert).

#### 5.1.1 Authentifizierung

| Kanal           | Eingabe                         | Ausgabe                                              |
| --------------- | ------------------------------- | ---------------------------------------------------- |
| `auth:status`   | —                               | `{ registered: boolean, locked: boolean }`           |
| `auth:register` | `{ displayName, password }`     | `{ recoveryCodes: string[] }` _(Klartext, einmalig)_ |
| `auth:login`    | `{ password }`                  | `{ ok: boolean }`                                    |
| `auth:logout`   | —                               | `void`                                               |
| `auth:lock`     | —                               | `void`                                               |
| `auth:reset`    | `{ recoveryCode, newPassword }` | `{ ok: boolean, recoveryCodes: string[] }`           |

#### 5.1.2 Arbeitsbereiche und Dokumente

| Kanal               | Eingabe                              | Ausgabe                                              |
| ------------------- | ------------------------------------ | ---------------------------------------------------- |
| `workspaces:list`   | —                                    | `Workspace[]`                                        |
| `workspaces:create` | `{ name }`                           | `Workspace`                                          |
| `workspaces:rename` | `{ id, name }`                       | `Workspace`                                          |
| `workspaces:delete` | `{ id }`                             | `void`                                               |
| `documents:list`    | `{ workspaceId }`                    | `Document[]`                                         |
| `documents:add`     | `{ workspaceId, paths: string[] }`   | `Document[]` _(initial mit_ `*status: 'pending'*`_)_ |
| `documents:delete`  | `{ id }`                             | `void`                                               |
| `documents:reindex` | `{ id }`                             | `void` _(stößt PROCEDURE an, siehe 4.5)_             |
| `chunks:get`        | `{ chunkId, before?: 1, after?: 1 }` | `ChunkWithContext[]` _(via FUNCTION 4.4)_            |

#### 5.1.3 Suche und Chat

| Kanal                | Eingabe                          | Ausgabe                                    |
| -------------------- | -------------------------------- | ------------------------------------------ |
| `search:query`       | `{ workspaceId, query, k?: 10 }` | `SearchHit[]`                              |
| `chat:conversations` | `{ workspaceId }`                | `Conversation[]`                           |
| `chat:open`          | `{ conversationId }`             | `Message[]`                                |
| `chat:create`        | `{ workspaceId, title? }`        | `Conversation`                             |
| `chat:ask`           | `{ conversationId, message }`    | `{ messageId }` _(Stream folgt asynchron)_ |
| `chat:stop`          | `{ messageId }`                  | `void`                                     |
| `chat:rename`        | `{ conversationId, title }`      | `void`                                     |
| `chat:delete`        | `{ conversationId }`             | `void`                                     |

#### 5.1.4 Einstellungen und Modell-Status

| Kanal          | Eingabe                                 | Ausgabe                                             |
| -------------- | --------------------------------------- | --------------------------------------------------- |
| `settings:get` | —                                       | `Settings`                                          |
| `settings:set` | `Partial<Settings>`                     | `Settings`                                          |
| `model:status` | —                                       | `{ generator: ModelStatus, embedder: ModelStatus }` |
| `model:reload` | `{ profile: 'lite' \| 'full' \| 'xl' }` | `void`                                              |

#### 5.1.5 Streaming-Kanäle (`webContents.send` von Hauptprozess → Renderer)

| Kanal                 | Payload                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `indexing:progress`   | `{ documentId, percent, stage: 'parsing' \| 'chunking' \| 'embedding' \| 'persisting' }` |
| `chat:stream-token`   | `{ conversationId, messageId, token }`                                                   |
| `chat:stream-end`     | `{ conversationId, messageId, citations: Citation[] }`                                   |
| `chat:stream-error`   | `{ conversationId, messageId, error: string }`                                           |
| `model:status-change` | `{ generator?: ModelStatus, embedder?: ModelStatus }`                                    |
| `embedder:progress`   | `{ percent, processed, total }` _(während Embedding-Backfill)_                           |

### 5.2 Modell-Schnittstelle (`node-llama-cpp`)

- Initialisierung mit Modell-Profil aus Settings.
- Adaptive Backend-Wahl: Vulkan → CUDA → Metal → CPU (in dieser Reihenfolge), abhängig vom Hardware-Detection-Ergebnis.
- Kontext-Größe: 4096 Tokens (Default für Q4_K_M-Quantisierung), konfigurierbar bis 8192 wenn ausreichend VRAM verfügbar ist.
- Streaming: `LlamaChatSession.promptWithMeta` mit `onTextChunk`-Callback, der direkt in den IPC-Stream schreibt.
- Stop-Tokens: Modell-Default plus zusätzlich `</answer>` (für eine zukünftige strukturierte Ausgabe nicht in Version 1 verwendet, aber reserviert).

### 5.3 Dateisystem-Schnittstellen

| Pfad (relativ zu `%APPDATA%/LokLM/`) | Inhalt                                                                                                                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pgdata/`                            | pglite-Cluster (verschlüsselt im Snapshot, entpackt nur während Sitzung)                                                                                                                                                                                            |
| `pgdata.snapshot.enc`                | Verschlüsselter Snapshot zur Wiederaufnahme                                                                                                                                                                                                                         |
| `files/`                             | Kopierte Original-Dokumente, dateinamenverwaltet via `documents.id.<ext>`                                                                                                                                                                                           |
| `models/`                            | GGUF-Dateien — beim First-Launch vom `ModelDownloader` nach `userData/models/` geladen; in Dev-Builds vom Build-Server `models/`-Pfad gelesen _(Nachtrag v1.1.1: bis v0.2.1 war der Pfad_ `*process.resourcesPath/models/*`_, Inhalt aus dem Installer extrahiert)_ |
| `logs/`                              | Rotierende Anwendungs-Logs (max. 5 × 5 MB)                                                                                                                                                                                                                          |

### 5.4 Externe Abhängigkeiten

LokLM kontaktiert zur Laufzeit **keine** externen Dienste. Die folgenden externen Quellen werden ausschließlich beim Build oder zur Installations-Zeit verwendet:

| Quelle                         | Zweck                                             | Wann                                                                                                                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HuggingFace Hub                | Modell-GGUF-Download                              | Einmalig beim First-Launch der Anwendung _(Nachtrag v1.1.1: vor v0.2.2 war's der Build-Step_ `*pnpm models:medium*`_; ab v0.2.2 holt der_ `*ModelDownloader*` _die GGUFs SHA256-verifiziert nach_ `*userData/models/*`_)_ + Build-Server für `pnpm dev` |
| Hetzner-VM (Bunny CDN-Edge)    | Auslieferung der Verteilungs-Webseite + Installer | nur Endbenutzer-Browser, nicht die Anwendung _(Nachtrag v1.1.1: war v1.0 als GitHub Pages spezifiziert)_                                                                                                                                                |
| MinIO Mirror (`s3.ltwodl.com`) | Manueller Backup-Spiegel der Installer            | Fallback bei Bunny-CDN-Ausfall, manuell vom Projekt verlinkt _(Nachtrag v1.1.1)_                                                                                                                                                                        |

---

## 6. Nichtfunktionale Anforderungen

### 6.1 Performance

| Metrik                                                       | Zielwert                                                         | Messverfahren                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------ |
| Anwendungsstart bis Anmelde-Bildschirm                       | < 3 s                                                            | Stoppuhr ab Doppelklick                          |
| Anmeldung bis Library sichtbar (50 Dokumente, 10.000 Chunks) | < 2 s                                                            | Performance-API im Renderer                      |
| Suche (Stichwort, 10.000 Chunks)                             | < 200 ms                                                         | Server-Timing pro IPC-Aufruf, in `logs/perf.log` |
| Suche (semantisch, 10.000 Chunks)                            | < 800 ms                                                         | dito                                             |
| RRF-Fusion (Suche kombiniert)                                | < 1.000 ms                                                       | dito                                             |
| Chat: Token-Latenz (Time-to-First-Token)                     | < 2,5 s mit GPU, < 6 s mit CPU                                   | bei 8B-Modell, 1.500-Token-Kontext               |
| Chat: Streaming-Rate                                         | ≥ 15 Tokens/s mit GPU, ≥ 4 Tokens/s mit CPU                      | bei 8B-Modell                                    |
| Indexierung Durchsatz                                        | ≥ 50 Chunks/s (ohne Embedding) bzw. ≥ 5 Chunks/s (mit Embedding) | Stoppuhr über 100-Seiten-PDF                     |
| Speicher-Footprint Anwendung ohne Modell                     | < 600 MB RSS                                                     | Task-Manager                                     |
| Speicher-Footprint mit 8B-Modell geladen                     | < 8 GB RAM auf Empfehlungs-Hardware                              | Task-Manager                                     |

Alle Werte gelten auf Empfehlungs-Hardware (siehe 2.4). Auf Mindest-Hardware werden die Werte verschlechtert tolerant zugelassen, mit dokumentierter Hardware-Test-Matrix (siehe 8.4).

### 6.2 Sicherheit

| Anforderung                               | Umsetzung                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Anwendung startet nur nach Anmeldung      | argon2id-verifizierte Anmelde-Maske vor dem ersten App-Bildschirm; pglite-Cluster wird erst entschlüsselt nach erfolgreicher Anmeldung |
| Passwort niemals im Klartext gespeichert  | argon2id (m=65536, t=3, p=4); Klartext nur kurzzeitig im Speicher des Hauptprozesses während Login                                     |
| Wiederherstellungscodes einmal verwendbar | Spalte `used_at` markiert verbrauchte Codes; argon2id-Vergleich                                                                        |
| Snapshot-Verschlüsselung                  | AES-256-GCM, Schlüssel via PBKDF2 (600 k Iterationen, SHA-256) aus Passwort + benutzerspezifischem Salt                                |
| Schutz vor Brute-Force-Anmeldung          | 5 Fehlversuche → 5 Minuten Sperre (im Speicher); kein Hinweis darauf, ob Anmeldename oder Passwort falsch war                          |
| Schutz vor Renderer-Compromise            | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; ausschließlich typisierte Aufrufe via contextBridge               |
| Schutz vor pfadbasiertem Lesezugriff      | Renderer hat keinen Dateisystem-Zugriff; Importe gehen über IPC mit Pfad-Validierung im Hauptprozess                                   |
| Inaktivitäts-Sperre                       | 15 Min konfigurierbar; Schlüssel wird sicher aus Speicher entfernt                                                                     |

### 6.3 Datenschutz

- **Vollständige Lokalität:** Anwendung kontaktiert zur Laufzeit keine externen Dienste. Keine Telemetrie, keine Crash-Reports an externe Server.
- **Keine externen KI-APIs:** Antwortgenerierung erfolgt ausschließlich mit dem lokal gehosteten Sprachmodell.
- **DSGVO-Konformität by Design:** Da keine personenbezogenen Daten das Gerät verlassen, fällt der Datenfluss nicht unter die Übermittlungs-Vorschriften der DSGVO.
- **Logs:** Anwendungs-Logs liegen lokal in `%APPDATA%/LokLM/logs/`; sie enthalten keine Inhalte (Frage, Antwort, Dokumente), nur Metadaten (Zeitstempel, Dauer, Status).

### 6.4 Zuverlässigkeit

- Antwortgenerierung verweigert bei zu wenig Quellen (siehe 3.6.4); kein "kreatives Halluzinieren".
- Datenbank-Operationen laufen in expliziten Transaktionen; Cascade-Deletes garantieren Konsistenz.
- Anwendungs-Absturz: pglite-WAL bleibt konsistent; Snapshot vor Absturz bleibt unbeschädigt; nächster Start lädt Snapshot.
- Kritische Operationen (Indexierung, Embedding-Backfill) sind idempotent und können nach Absturz fortgesetzt werden.

### 6.5 Wartbarkeit

- TypeScript im **strict mode**; kein `any` außer an dokumentierten Type-Boundary-Stellen mit `// eslint-disable`-Kommentar und Begründung.
- Modulare Service-Architektur (siehe 7.2) mit klaren Schnittstellen; jeder Service in eigener Datei < 500 Zeilen.
- Code-Dokumentation generiert aus TSDoc-Kommentaren via TypeDoc; Output unter `docs/api/`.
- ADRs für alle Architekturentscheidungen, in `docs/adr/` versioniert.

### 6.6 Bedienbarkeit

- UI in deutsch und englisch (Sprachwahl in den Einstellungen).
- Tastatur-Bedienbarkeit: alle Aktionen über Tastatur erreichbar; Fokus-Indikatoren sichtbar.
- Hell/Dunkel-Modus mit Systemvorgabe-Erkennung.
- Konsistente Schriftgrößen, Farb-Kontraste WCAG-AA.
- Lade-Zustände immer sichtbar (Modell-Pille, Indexierungs-Fortschritt, Streaming-Indikator).

### 6.7 Portabilität

- Zielplattform: **Windows 10 / 11 (64-bit)**.
- macOS- und Linux-Builds sind technisch möglich (Electron + pglite + node-llama-cpp sind plattformübergreifend), werden in Version 1 aber nicht offiziell ausgeliefert.
- Native Module (`node-llama-cpp`) werden zur Build-Zeit für die Zielplattform kompiliert.

### 6.8 Datenintegrität

- Bearbeiten / Löschen von Dokumenten und Workspaces erfordert Bestätigung (Modal mit Vorschau der Konsequenzen: "X Dokumente, Y Chunks, Z Konversationen werden gelöscht").
- Soft-Undo nach Löschen: Trash-Konzept ist **nicht** in Version 1 enthalten (Kann-Anforderung); ein Lösch-Vorgang ist sofort kaskadierend und endgültig.
- Bei Indexierungs-Fehler: Dokument bleibt mit `status='failed'` sichtbar; manueller Reindex möglich.

---

## 7. Qualitätsanforderungen

### 7.1 Quellcode-Standards

- **Sprache:** TypeScript 5 (strict mode), ECMAScript 2022.
- **Linter:** ESLint mit `@typescript-eslint/recommended-strict`, `eslint-plugin-react`, `eslint-plugin-react-hooks`. Kein Code-Merge ohne Lint-Pass.
- **Formatter:** Prettier (Default-Config plus `singleQuote: true`, `trailingComma: 'es5'`).
- **Naming:** PascalCase für Komponenten und Klassen, camelCase für Funktionen und Variablen, SCREAMING_SNAKE für Konstanten, kebab-case für Dateinamen außer Komponenten.
- **Imports:** absolute Imports über Vite-Aliase (`@main/`, `@renderer/`, `@preload/`), keine Pfad-Hierarchien à la `../../../`.

### 7.2 Architekturmuster (Designpattern-Soll-Anforderung)

LokLM verwendet folgende Muster, die in der technischen Dokumentation namentlich genannt werden:

| Muster                      | Einsatzort                                                                              | Begründung                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Service Layer**           | `src/main/services/` (alle Geschäftslogik in Service-Klassen mit klaren Schnittstellen) | Trennung Geschäftslogik vom Transport (IPC); ein Service pro Domäne                   |
| **Repository / DAO**        | `src/main/db/database.ts`                                                               | Einziger Punkt für SQL; Anwendungs-Code ruft typisierte Methoden, nicht SQL-Strings   |
| **Observer (Event-Stream)** | IPC-Streaming-Kanäle (`indexing:progress`, `chat:stream-token`)                         | Entkopplung Backend-Fortschritt vom Renderer-Rendering                                |
| **Strategy**                | `parser.ts` wählt Reader anhand MIME / Endung                                           | Erweiterbarkeit für neue Dokumentformate                                              |
| **Singleton**               | `LlamaService`, `EmbeddingService`, `Database`                                          | Genau eine Modell- bzw. Datenbank-Instanz pro Prozess                                 |
| **Bridge / Facade**         | `contextBridge` in `preload/index.ts` als typisierte Fassade über `ipcRenderer.invoke`  | Klare API-Grenze Renderer↔Hauptprozess; keine direkte ipcRenderer-Nutzung im Renderer |

### 7.3 Code-Dokumentation

- Jede öffentliche Funktion und Klasse hat einen TSDoc-Kommentar mit Zweck, Parametern und Rückgabewert.
- TypeDoc generiert nach `docs/api/`. Generierung ist Teil von `pnpm build:docs`.
- ADRs (Architecture Decision Records) für jede strukturelle Entscheidung in `docs/adr/`, Format wie ADR-0001.

### 7.4 Versionsverwaltung

- **Repository:** GitHub, Sichtbarkeit "Internal" mit expliziten Leserechten für den Projektbetreuer.
- **Branch-Strategie:** `main` ist immer deploybar; alle Änderungen über Feature-Branches `feature/<kurzname>`, `fix/<kurzname>`, `docs/<kurzname>`.
- **Pull-Request-Workflow:** Jeder PR durchläuft (a) automatisierte Checks (Lint, Typecheck, Vitest) und (b) Code-Review durch den jeweils nicht-autorenden Teampartner.
- **Commit-Frequenz:** mindestens täglich an Arbeitstagen.
- **Commit-Konvention:** Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- **Tags:** `v0.x.y` für interne Meilensteine, `v1.0.0` zur Abgabe.

---

## 8. Testkonzept

### 8.1 Unit-Tests (Vitest)

**Testumfang:** mindestens 70 % Branch-Abdeckung in den Modulen `chunker.ts`, `parser.ts`, `RetrievalService` (RRF-Logik), Citation-Marker-Parser, Auth-Hashing-Wrapper.

**Konfiguration:** `vitest.config.ts` mit Coverage über `@vitest/coverage-v8`. Tests liegen neben den Modulen unter `*.test.ts`.

**Beispiel-Testfälle:**

| Modul              | Testfall                                      | Erwartung                                                 |
| ------------------ | --------------------------------------------- | --------------------------------------------------------- |
| `chunker.ts`       | Eingabe = leerer String                       | leeres Chunk-Array                                        |
| `chunker.ts`       | Eingabe = 1500 Zeichen ohne Trennzeichen      | ein Chunk                                                 |
| `chunker.ts`       | Eingabe = 5000 Zeichen mit doppelten Newlines | ≥ 3 Chunks, korrekte Reihenfolge, Überlappung eingehalten |
| `parser.ts`        | Strategie-Auswahl PDF                         | gibt PDF-Reader zurück                                    |
| `parser.ts`        | Unbekannte Endung                             | wirft `UnsupportedFileType`                               |
| `RetrievalService` | RRF-Fusion zweier Listen                      | Ranks korrekt addiert mit `k=60`                          |
| `Citation-Parser`  | Eingabe `"foo [doc:1, chunk:5] bar"`          | extrahiert `[{doc:1, chunk:5}]`                           |

### 8.2 Modul-/Integrations-Tests

- **DocumentService End-to-End:** Importiert eine Beispiel-PDF, prüft `documents`-Eintrag, `chunks`-Anzahl, `text_search` befüllt durch Trigger, `documents.chunk_count` denormalisiert korrekt.
- **RetrievalService End-to-End:** Indexiert 50-Chunk-Korpus, stellt 10 vorbereitete Fragen, prüft top-K ist deterministisch und enthält erwartete Chunk-IDs.
- **Auth End-to-End:** Registrierung → Login → Snapshot-Verschlüsselung → App-Restart → Login mit Snapshot-Entschlüsselung → Recovery-Code-Reset → Login mit neuem Passwort.

### 8.3 Manuelle Test-Szenarien

Test-Szenarien dokumentiert in `tests/manual/`. Pro Szenario: Vorbedingung, Schritte, erwartetes Ergebnis, Screenshot-Pflicht.

Mindestens folgende Szenarien werden in Woche 6 ausgeführt:

| Nr. | Szenario                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------ |
| M1  | Erste Inbetriebnahme: Installer ausführen, Registrieren, Wiederherstellungscodes notieren, Workspace anlegen |
| M2  | PDF importieren, Indexierung beobachten, Frage stellen, Antwort mit Quellen erhalten, Quelle öffnen          |
| M3  | Markdown-Datei importieren, Frage in englischer Sprache stellen (bilingual-Test)                             |
| M4  | Quellcode-Datei importieren, technische Frage zur Codebase stellen                                           |
| M5  | Frage stellen, deren Antwort nicht in den Dokumenten steht → Verweigerungs-Antwort                           |
| M6  | Passwort vergessen → Wiederherstellungscode → neues Passwort → Login funktioniert                            |
| M7  | Inaktivität 15 Min → Sperrbildschirm erscheint                                                               |
| M8  | Workspace löschen → kaskadierendes Löschen aller zugehörigen Daten                                           |
| M9  | Anwendung schließen, neu starten → Snapshot wird korrekt entschlüsselt, Daten erhalten                       |
| M10 | Modell-Datei manipulieren (umbenennen) → Anwendung läuft mit Fallback-Synthese                               |
| M11 | Sehr großes Dokument (100+ Seiten PDF) → Indexierung erfolgreich, Performance dokumentiert                   |

### 8.4 Multi-Hardware-Test-Matrix

Tests werden auf folgenden Konfigurationen durchgeführt und in `docs/hw-matrix.md` dokumentiert (Owner: Dominik):

| ID   | Hardware-Klasse              | RAM    | GPU                       | Erwartetes Profil | Pflichtszenarien   |
| ---- | ---------------------------- | ------ | ------------------------- | ----------------- | ------------------ |
| HW-1 | Entwickler-Workstation Denys | 32 GB+ | NVIDIA, ≥ 8 GB VRAM       | full / xl         | M1–M11             |
| HW-2 | Notebook Dominik             | 16 GB  | integriert                | full              | M1–M9              |
| HW-3 | Schul-PC                     | 8 GB   | integriert                | lite              | M1, M2, M5, M6, M9 |
| HW-4 | Älteres Notebook (≥ 8 GB)    | 8 GB   | integriert (Vulkan-fähig) | lite              | M1, M2, M5         |

Für jede Konfiguration werden gemessen: Time-to-First-Token, Streaming-Rate, Speicher-Footprint, sowie Anwender-Beobachtungen (Lüfter, Temperatur, UI-Reaktivität).

### 8.5 Eval-Set für ML-Antwortqualität

**Ziel:** quantitative Aussage zur Qualität der Antwortgenerierung über drei Metriken.

**Aufbau:**

- **Größe:** 50–80 Testfälle, 30 % Deutsch, 70 % Englisch (ungefähre Verteilung der wahrscheinlichen Endbenutzer-Inhalte).
- **Quellen:** echte PDFs aus dem Schulkontext (z. B. die `school_req`-PDFs selbst, öffentlich zugängliche Lehrunterlagen, Fachbücher).
- **Format pro Testfall:**

  ```json
  {
    "id": "DE-001",
    "lang": "de",
    "workspace_seed": ["lehrplan_4kl.pdf", "klassenarbeit_anleitung.pdf"],
    "question": "Welche Frist gilt für die Abgabe des Lastenhefts?",
    "expected_chunk_ids": [42, 43],
    "expected_answer_substring": "08.05.2026",
    "expected_refusal": false
  }
  ```

- **Verteilung:**
  - 60 % beantwortbare Fragen (Antwort steht klar im Korpus)
  - 25 % unbeantwortbare Fragen (keine Information im Korpus → Refusal erwartet)
  - 15 % teilweise beantwortbare Fragen (Antwort vorhanden, aber lückenhaft)

**Hold-out-Set:** Dominik schreibt 15 Testfälle, die Denys während der Entwicklung nicht sieht. Erst beim finalen Eval werden sie verwendet (Echo-Kammer-Schutz, siehe Risiko R5).

**Metriken:**

| Metrik                | Definition                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Citation Accuracy** | Anteil der zitierten Chunk-IDs, die in der Datenbank existieren UND in den top-K der Retrieval-Stufe für diese Frage waren                                                                                                                   |
| **Faithfulness**      | Anteil der antwortenden Aussagen, die durch die zitierten Chunks gestützt sind (manuelle Bewertung durch Dominik bei einer 20er-Stichprobe; automatische Annäherung mit Substring-Match auf `expected_answer_substring` für die volle Menge) |
| **Refusal Rate**      | bei den 25 % unbeantwortbaren Fragen: Anteil der korrekten Verweigerungen                                                                                                                                                                    |

**Konfigurationen:**

| Konfiguration       | Beschreibung                                  |
| ------------------- | --------------------------------------------- |
| Baseline            | reines Modell ohne System-Prompt-Anweisung    |
| + System-Prompt     | mit dem in 3.6.2 spezifizierten System-Prompt |
| + Fine-tuned (Kann) | wenn Kann-Anforderung 3.10.1 umgesetzt wird   |

Die Resultat-Tabelle wird Bestandteil des Abschlussberichts.

### 8.6 Akzeptanzkriterien

Akzeptanz erfolgt, wenn:

- alle Mindestbestandteile aus Lastenheft Kapitel 9 erfüllt und durch M-Szenarien M1–M11 verifiziert sind;
- alle Soll-Anforderungen umgesetzt sind (oder begründet abgewichen, mit Eintrag im Änderungsverzeichnis);
- Unit-Test-Suite erfolgreich auf `main` läuft (CI-Pass, ≥ 70 % Branch-Coverage in Kernmodulen);
- Hardware-Matrix-Test auf mindestens 3 von 4 Konfigurationen vollständig durchlaufen ist;
- Eval-Tabelle (Baseline + System-Prompt) mit Refusal Rate ≥ 75 % und Citation Accuracy ≥ 85 % bei gewählter Konfiguration vorliegt;
- Lasten- und Pflichtenheft, Projekthandbuch (alle 15 Kapitel), technische Dokumentation, Anwenderhandbuch und generierte Code-Dokumentation in der finalen Fassung übergeben sind;
- Verteilungs-Webseite mit Installer-Download erreichbar ist;
- die Live-Demo bei der Präsentation auf Hardware HW-1 oder HW-2 reibungslos durchläuft.

---

## 9. Phasen- und Terminplan

### 9.1 Wochenplan-Übersicht

| Woche | Datum         | Schwerpunkt                                                                      | Schul-Pflicht-Liefergegenstände                                                                         |
| ----- | ------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1     | 04.05.–08.05. | Projekt-Setup, Lastenheft, Teamregeln                                            | Projektsteckbrief, Lastenheft, Teamregeln (PHB K2)                                                      |
| 2     | 11.05.–15.05. | Pflichtenheft, Auth-Backend Start                                                | Pflichtenheft, Zieleplan (K3+K5), Risikoanalyse (K4), Vor-/Nachplanung (K6), Projektauftrag (K8), Pitch |
| 3     | 18.05.–22.05. | Auth abschließen, DOCX-Import                                                    | PSP (K9), AP-Spezifikation (K10)                                                                        |
| 4     | 25.05.–29.05. | BGE-M3 Embeddings + HNSW, Auth-UI                                                | Meilensteinplan (K11), GANTT (K12)                                                                      |
| 5     | 01.06.–05.06. | RRF-Fusion, Settings-UI, Homepage starten                                        | Kostenplan (K13), Netzplan, Ressourcenplan                                                              |
| 6     | 08.06.–12.06. | Eval-Set, Synthetic Data, Homepage abschließen, Tests                            | Testkonzept, Benutzerhandbuch (erste Fassung)                                                           |
| 7     | 15.06.–19.06. | **Pufferwoche / Integrationstests / Stabilisierung** _(Stretch: QLoRA-Training)_ | Integrationstests, technische Doku final, ADRs final, Projektabschlussbericht                           |
| 8     | 22.06.–26.06. | Präsentation, Abgabe                                                             | Abgabe aller Dokumente (Druck), digitale Abgabe, Präsentation                                           |

### 9.2 Arbeitspakete (Auszug, vollständig in PHB Kapitel 10)

| AP-Code | Bezeichnung                                                                                                                                     | Vorgänger      | Nachfolger     | Owner           | Aufwand (Std) |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------- | --------------- | ------------- |
| AP-1.1  | Projekt-Setup (Repo, Toolchain, Electron-Vite-Skelett, Vitest, TypeDoc, ESLint/Prettier)                                                        | —              | AP-2.1, AP-3.x | Denys           | 8             |
| AP-1.2  | Lastenheft                                                                                                                                      | —              | AP-1.3         | Dominik         | 10            |
| AP-1.3  | Teamregeln, Projektsteckbrief                                                                                                                   | AP-1.2         | AP-2.x         | Dominik         | 3             |
| AP-2.1  | Auth-Backend (argon2id, Snapshot-Verschlüsselung AES-256-GCM, Wiederherstellungscodes, Inaktivitäts-Sperre)                                     | AP-1.1         | AP-2.2, AP-5.1 | Denys           | 28            |
| AP-2.2  | Auth-UI (Login, Register, Recovery-Code-Anzeige, Sperrbildschirm)                                                                               | AP-2.1         | AP-9           | Dominik         | 12            |
| AP-3.1  | PDF-Import (pdf-parse, Seitenmetadaten, Status-Tracking)                                                                                        | AP-1.1         | AP-4.1         | Denys           | 6             |
| AP-3.2  | Markdown-/Textimport (Encoding-Erkennung, Datei-Persistenz)                                                                                     | AP-1.1         | AP-4.1         | Denys           | 3             |
| AP-3.3  | Quellcode-Import (Endungs-Whitelist, Klartext-Behandlung)                                                                                       | AP-3.2         | AP-4.1         | Denys           | 2             |
| AP-3.4  | DOCX-Import (mammoth, Tabellen→Pipe-Zeilen, bekannte Limits dokumentieren)                                                                      | AP-3.1         | AP-4.1         | Dominik         | 10            |
| AP-4.1  | Chunker (rekursiver Zeichen-Splitter, Trennzeichen-Hierarchie, Überlappung)                                                                     | AP-3.x         | AP-4.2         | Denys           | 6             |
| AP-4.2  | Stichwort-Index: tsvector-Spalte, BEFORE-INSERT-Trigger `chunks_tsv_biu`, GIN-Index, bilingual DE/EN                                            | AP-4.1         | AP-4.4         | Denys           | 6             |
| AP-4.3  | BGE-M3 Embeddings: Modell-Integration, `chunks.embedding`, EmbeddingService, Backfill, HNSW-Index                                               | AP-1.1         | AP-4.4         | Denys           | 18            |
| AP-4.4  | RRF-Fusion in RetrievalService (Kombination Stichwort + semantisch, Fallback bei fehlendem Embedder)                                            | AP-4.2, AP-4.3 | AP-7.2         | Denys           | 8             |
| AP-5.1  | Datenbank-Schema (alle 8 Tabellen, Constraints, Indizes, Trigger 2, Function 1, Procedure 1)                                                    | AP-2.1         | AP-5.2, AP-7.x | Denys           | 8             |
| AP-5.2  | Workspaces (CRUD-Service, Library-UI, kaskadierendes Löschen, aktiver Workspace persistiert)                                                    | AP-5.1         | AP-6           | Denys           | 8             |
| AP-6    | Suche- und Filter-UI (Eingabefeld, ts_headline-Highlighting, Sortierung, Filter)                                                                | AP-4.4         | AP-7           | Dominik         | 6             |
| AP-7.1  | Chat-Frontend (Konversations-Sidebar, Chat-Route, Streaming-Renderer mit react-markdown)                                                        | AP-2.2, AP-5.2 | AP-7.2         | Denys           | 10            |
| AP-7.2  | Retrieval-Pipeline + Prompt-Aufbau + Streaming-IPC (chat:stream-token, /no_think-Stripping)                                                     | AP-4.4, AP-7.1 | AP-7.4         | Denys           | 8             |
| AP-7.4  | Verweigerungslogik (Schwellenwert top-3 mit Score≥0,01, fest verdrahtete Antwort, Fallback-Synthese ohne Modell)                                | AP-7.2         | AP-8           | Denys           | 4             |
| AP-7.5  | Chatverlauf-Persistenz (Konversationen, Nachrichten, Citations-JSON)                                                                            | AP-7.2         | —              | Denys           | 5             |
| AP-8    | Quellenanzeige: SourceViewer, CitationChip-Komponente, Click-Routing, ±1-Kontext via FUNCTION 4.4                                               | AP-7.2         | —              | Denys           | 6             |
| AP-9    | Settings-UI (Chunkgröße, K, Modell-Profil, Theme, Inaktivitäts-Sperre, Account-Bereich)                                                         | AP-2.1         | —              | Dominik         | 8             |
| AP-1.4  | Release-Pipeline (NSIS + AppImage, Bunny CDN + MinIO Mirror, releases.ts Bump + Hetzner-Rsync) _(Nachtrag v1.1.1)_                              | AP-7.1         | AP-D.1         | Denys           | 8             |
| AP-1.5  | Release-Pipeline Hardening (macOS DMG, Code-Signing, electron-updater) — Folge-AP, kein G3-Blocker _(Nachtrag v1.1.1)_                          | AP-1.4         | AP-12          | Denys           | 12            |
| AP-D.1  | Verteilungs-Homepage (eigene Domain auf Hetzner-VM, Hero, Screenshots, Download-Verweis, Doku-Link) _(Nachtrag v1.1.1: GitHub Pages → Hetzner)_ | AP-1.1         | AP-12          | Dominik         | 12            |
| AP-D.2  | Anwenderhandbuch (Erstinbetriebnahme, alle Hauptabläufe, Troubleshooting, bekannte Limits)                                                      | AP-7, AP-8     | AP-12          | Dominik         | 14            |
| AP-D.3  | Technische Dokumentation und ADRs (Briefing-basiert von Denys; Architektur, Services, Schema, IPC)                                              | AP-2.1, AP-4.4 | AP-12          | Dominik         | 14            |
| AP-D.4  | TypeDoc-Generierung und Einbindung in die Verteilungs-Homepage (Hetzner-VM) _(Nachtrag v1.1.1)_                                                 | AP-1.1         | AP-12          | Dominik         | 3             |
| AP-T.1  | Vitest Unit-Tests (chunker, parser, RetrievalService-RRF, Citation-Parser, Auth-Wrapper)                                                        | AP-1.1         | AP-T.2         | Dominik         | 10            |
| AP-T.2  | Modul-/Integrations-Tests (DocumentService E2E, RetrievalService E2E, Auth E2E mit Snapshot-Round-Trip)                                         | AP-T.1         | AP-T.3         | Dominik         | 8             |
| AP-T.3  | Manuelle Testszenarien M1–M11 ausgeführt und protokolliert                                                                                      | AP-7.4, AP-8   | AP-T.4         | Dominik         | 8             |
| AP-T.4  | Multi-Hardware-Test-Matrix (HW-1 bis HW-4, Performance-Messung, Beobachtungen)                                                                  | AP-T.3         | AP-12          | Dominik         | 8             |
| AP-E.1  | Eval-Set Synthetic-Data-Authoring (50–80 Fälle DE+EN inkl. 15 Hold-out durch Dominik)                                                           | AP-7.2         | AP-E.2         | Dominik         | 12            |
| AP-E.2  | Eval-Scoring-Harness (Citation Accuracy, Faithfulness, Refusal Rate; Baseline + System-Prompt)                                                  | AP-E.1         | AP-12          | Denys           | 8             |
| AP-10.1 | QLoRA-Training auf Synthetic Data, Konvertierung zu GGUF, Eval-Spalte ergänzen _(Kann; nur nach G3 grün)_                                       | AP-E.2         | —              | Denys (Stretch) | 25            |
| AP-12   | Präsentation, Handout, Druck-/Digital-Abgabe (je 7 Std pro Person)                                                                              | alle           | —              | Beide           | 14            |

Aufwands-Summen für Kostenplan (PHB K13):

| Posten                                                                                     | Stunden |
| ------------------------------------------------------------------------------------------ | ------- |
| Denys (Code + Architektur + Eval-Harness + Präsentation)                                   | **149** |
| Dominik (Auth-UI, DOCX, Settings-UI, Tests, Doku, Synthetic Data, Homepage + Präsentation) | **145** |
| **Summe geplant ohne Stretch**                                                             | **294** |
| Stretch _Kann_ AP-10.1 QLoRA (nur Denys, nur nach G3)                                      | +25     |
| Summe maximal mit Stretch                                                                  | 319     |

Über 8 Wochen entspricht das ca. **18–19 Std/Woche pro Person** ohne Stretch — vereinbar mit der schulischen Projektzeit (4 UE/Woche im Lehrgang) plus moderater Eigenleistung in Abend- und Wochenstunden. Aufwände sind Plan-Schätzungen; im Projektabschlussbericht (PHB K15) werden geplante mit tatsächlichen Stunden verglichen.

### 9.3 Meilensteine

| Nr  | Meilenstein                       | Datum      | Erfüllungs-Kriterium                                                 |
| --- | --------------------------------- | ---------- | -------------------------------------------------------------------- |
| M1  | Projekt-Setup abgeschlossen       | 08.05.2026 | Repo, Toolchain, Lastenheft signiert                                 |
| M2  | Pflichtenheft signiert            | 15.05.2026 | dieses Dokument freigegeben                                          |
| M3  | Auth-Backend integration-getestet | 29.05.2026 | E2E-Test 8.2 läuft grün                                              |
| M4  | Embeddings + RRF integriert       | 12.06.2026 | RetrievalService gibt RRF-fusionierte Treffer; Eval-Baseline messbar |
| M5  | Feature-Freeze                    | 12.06.2026 | alle Muss + Soll umgesetzt; nur noch Bugfix                          |
| M6  | Integrationstests bestanden       | 19.06.2026 | M1–M11 manuell durchgeführt, dokumentiert                            |
| M7  | Abgabe-Dokumente fertig           | 24.06.2026 | gedruckt + digital, vom Projektleiter freigegeben                    |
| M8  | Präsentation                      | 26.06.2026 | live durchgeführt                                                    |

### 9.4 Go/No-Go-Gates

- **G1 (Ende Woche 1, 08.05.):** Lastenheft signiert. **Letzte Möglichkeit zur Scope-Änderung.**
- **G2 (Ende Woche 4, 29.05.):** Auth-Backend integration-getestet. **Wenn nicht grün → BGE-M3-Stretch wird gestrichen, Mindestumfang wird gesichert.**
- **G3 (Ende Woche 6, 12.06.):** Feature-Freeze. **Wenn alle Muss+Soll grün → Pufferwoche kann für QLoRA-Stretch genutzt werden. Wenn nicht → Pufferwoche ist ausschließlich Stabilisierung, QLoRA wird gestrichen.**

---

## 10. Risiken

Vollständige Risikoanalyse im Projekthandbuch K4. Hier die zehn technisch relevantesten:

| ID                                       | Risiko                                                                                                                                      | E × A                 | Maßnahme                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1                                       | Auth-Crypto-Fehler (argon2-Konfig, AES-GCM-Nonce-Wiederverwendung, PBKDF2-Schlüsselableitung) führen zu Datenverlust oder Sicherheitslücken | 3 × 5                 | ADR-0002 vor Implementierung; Pair-Review jeder auth-PR; Round-Trip-Test (Snapshot verschlüsseln + entschlüsseln + Daten unverändert) vor erstem Live-Einsatz; manuelle Security-Review-Skill-Durchlauf vor Merge                                                                                                                                                                         |
| R2                                       | BGE-M3 Performance auf pglite (WASM-Postgres ist 2–5× langsamer als nativ); HNSW-Build dauert > 5 Min auf Real-Korpus                       | 3 × 3                 | Frühe Bench in Woche 4 (KW 22) gegen 1.000 / 5.000 / 10.000 Chunks; Fallback auf reine `tsvector`-Suche immer aktiv; HNSW `m`/`ef_construction` nach unten skalierbar; gemessenes Plateau in technischer Doku festhalten                                                                                                                                                                  |
| R3                                       | Dominik Engpass bei Dokumenten- und Test-Breite                                                                                             | 3 × 4                 | Wöchentliche 30-Min-Briefings (Denys → Dominik); Denys schreibt 5–10-Bullet-Outlines für die schwersten Dokumente; Cut-Order: Homepage-Detail → Hardware-Matrix-Detail → ADR-Tiefe → DOCX zuletzt; Denys übernimmt Ghostwriting für Fortschrittsbericht falls Dominik > 3 Tage ausfällt                                                                                                   |
| R4                                       | DOCX-Parsing-Sonderfälle (Tabellen, verschachtelte Listen, Fußnoten) verschlingen Dominiks Zeit                                             | 2 × 2                 | Verwendung von `mammoth` (etabliert); Akzeptanz "nur Text-Body, Tabellen als Pipe-Zeilen, Bilder ignoriert" in Pflichtenheft 3.2.4 fest verdrahtet; bekannte Limit. im Anwenderhandbuch dokumentiert                                                                                                                                                                                      |
| R5                                       | Eval-Set ist Echo-Kammer (Denys schreibt Code, schreibt Tests, scort Ergebnisse)                                                            | 4 × 3                 | Hold-out-Set: Dominik schreibt 15 Testfälle, Denys sieht sie nicht während Entwicklung; reale PDFs (z. B. `school_req`-Inhalte) werden bevorzugt; manuelle Faithfulness-Bewertung durch Dominik bei 20er-Stichprobe                                                                                                                                                                       |
| R6 _(mitigated v0.2.2, Nachtrag v1.1.1)_ | Installer zu groß für GitHub Releases (3–35 GB durch gebündelte GGUFs)                                                                      | ~~4 × 2~~ → **1 × 2** | **Gemitigt durch Slim-Installer-Pivot (v0.2.2, AP-1.4):** GGUFs werden nicht mehr gebundled; der `ModelDownloader` zieht sie beim First-Launch nach `userData/models/`. Installer ist jetzt \~375 MB (Win) / \~500 MB (Linux). Distribution via eigener Domain (Hetzner-VM + Bunny CDN, MinIO als Backup-Mirror). Sneakernet bleibt als Notfall-Option für Schul-Vorführung dokumentiert. |
| R7                                       | Krankheits-/Ausfall-Risiko bei knappem Zeitplan                                                                                             | 3 × 4                 | Pufferwoche Woche 7 ist genau dafür reserviert. Tägliche Commits + PR-Beschreibungen ersetzen Wissen-Übergabe; Dominik kann Doku auch asynchron in Abendstunden weiterführen                                                                                                                                                                                                              |
| R8                                       | Scope Creep durch QLoRA-Versuchung vor Feature-Freeze                                                                                       | 3 × 3                 | Hard-Rule: AP-10.1 darf erst nach G3 gestartet werden; im Lastenheft als "Optional / nur bei Restzeit" festgeschrieben; im Pflichtenheft 3.10 explizit als Kann markiert                                                                                                                                                                                                                  |
| R9                                       | pglite-Stabilität (jüngeres Projekt als SQLite, Bugs in WAL/Snapshot)                                                                       | 2 × 5                 | Schadenbegrenzung durch verschlüsselte Snapshot-Persistenz (siehe 4.7); Notfall-Plan: SQLite-Backport-Branch existiert technisch (würde Trigger/Function/Procedure verlieren — ist nur Plan B)                                                                                                                                                                                            |
| R10                                      | Examinator bringt unerwartetes PDF-Format (mehrspaltig, Fußnoten, ungewöhnliche Encodings)                                                  | 3 × 2                 | In Woche 7 Test gegen ≥ 10 PDFs unterschiedlicher Herkunft; bekannte Limits im Anwenderhandbuch; "saubere" Demo-PDF als Backup in der Präsentation bereit                                                                                                                                                                                                                                 |

Skala E (Eintrittswahrscheinlichkeit) und A (Auswirkung) jeweils 1 (gering) bis 5 (hoch).

---

## 11. Abnahmekriterien

Das Projekt gilt als erfolgreich abgenommen, wenn die folgenden Punkte zum Termin der Projektpräsentation (26.06.2026) erfüllt sind:

1.  **Alle Muss-Anforderungen** aus Lastenheft Kapitel 5 sind umgesetzt und durch entsprechende M-Szenarien (siehe 8.3) verifiziert.
2.  **Alle Soll-Anforderungen** aus Lastenheft Kapitel 5 sind umgesetzt oder mit dokumentierter Begründung im Änderungsverzeichnis abgewichen.
3.  **Mindestumfang Lastenheft Kap. 9** vollständig gegeben (alle 11 Punkte).
4.  **Datenbankobjekte:** mindestens je ein Trigger, eine Funktion und eine Prozedur sind im produktiven Einsatz und werden im Pflichtenheft (4.3, 4.4, 4.5) sowie in der technischen Dokumentation namentlich genannt.
5.  **Quellcode** ist tagesaktuell auf GitHub, der Projektbetreuer hat Leserechte.
6.  **Generierte Code-Dokumentation** liegt unter `docs/api/` vor und ist auf der Verteilungs-Webseite verlinkt.
7.  **Pflichtenheft** (dieses Dokument), **Lastenheft**, **Projekthandbuch** (alle 15 Kapitel), **technische Dokumentation**, **Anwenderhandbuch** sind als Druckexemplar und digital übergeben.
8.  **Eval-Tabelle** liegt vor mit Werten für mindestens die Baseline- und System-Prompt-Konfiguration; Refusal Rate ≥ 75 % und Citation Accuracy ≥ 85 %.
9.  **Hardware-Matrix-Bericht** dokumentiert mindestens drei der vier Konfigurationen.
10. **Live-Demo** auf der Präsentation läuft fehlerfrei: Login, Workspace anlegen, PDF importieren, Frage stellen, Antwort mit klickbaren Quellen erhalten, Quelle öffnen, Verweigerungs-Antwort bei nicht beantwortbarer Frage demonstrieren.
11. **Verteilungs-Webseite** ist erreichbar mit Anwender-Dokumentation und Installer-Download-Verweis.
12. **Präsentation** wurde gehalten (\~ 18–22 Minuten pro Projektmitglied), Handout liegt vor.

---

## 12. Anhänge

### Anhang A — Verzeichnisstruktur

```
LokLM/
├── src/
│   ├── main/                       Hauptprozess (Node.js)
│   │   ├── index.ts                Window-Lifecycle, Status-Broadcast
│   │   ├── ipc.ts                  IPC-Handler-Registrierung
│   │   ├── db/
│   │   │   ├── database.ts         Repository / DAO
│   │   │   └── schema.sql          Schema, Trigger, Function, Procedure
│   │   └── services/
│   │       ├── AuthService.ts      [neu in Woche 2]
│   │       ├── DocumentService.ts
│   │       ├── ParserService.ts    (parser.ts)
│   │       ├── ChunkerService.ts   (chunker.ts)
│   │       ├── EmbeddingService.ts [neu in Woche 4]
│   │       ├── EmbeddingBackfillService.ts [neu in Woche 4]
│   │       ├── RetrievalService.ts (RRF-Erweiterung in Woche 5)
│   │       └── LlamaService.ts
│   ├── preload/
│   │   └── index.ts                contextBridge-Fassade
│   └── renderer/
│       └── src/
│           ├── App.tsx             Routen-Setup
│           ├── routes/
│           │   ├── Login.tsx       [neu in Woche 4]
│           │   ├── Library.tsx
│           │   ├── Chat.tsx
│           │   ├── Settings.tsx
│           │   └── SourceViewer.tsx
│           ├── components/
│           │   ├── Sidebar.tsx
│           │   ├── CitationChip.tsx
│           │   └── ...
│           └── types/              Domain-Typen
├── models/                         GGUF-Dateien (gitignored)
├── docs/
│   ├── adr/                        Architecture Decision Records
│   ├── specs/                      Feature-Specs
│   └── api/                        TypeDoc-Output (gitignored, generiert)
├── tests/
│   ├── unit/                       Vitest neben Modulen
│   ├── integration/                Modul-Integrationstests
│   ├── manual/                     manuelle Test-Szenarien (Markdown)
│   └── eval/                       Eval-Datensatz (JSON), Scoring-Skripte
├── website/                        Verteilungs-Webseite (Astro) — Nachtrag v1.1.1: war als `homepage/` geplant
├── school_req/                     Schul-Pflichtdokumente (dieses Dok inkl.)
├── scripts/
│   └── download-models.mjs         Modell-Beschaffung
├── package.json
├── electron-builder.yml            Default (medium)
├── electron-builder.lite.yml
├── electron-builder.pro.yml
└── README.md
```

### Anhang B — Tech-Stack-Versionsmatrix

| Paket                  | Version                | Begründung                                |
| ---------------------- | ---------------------- | ----------------------------------------- |
| `electron`             | 33.0.2                 | LTS-nahe Version mit Vulkan-Unterstützung |
| `@electric-sql/pglite` | 0.4.5                  | Stable-Branch mit pgvector-Erweiterung    |
| `node-llama-cpp`       | 3.18.1                 | v3-API mit `LlamaChatSession` Streaming   |
| `react`                | 18.3.1                 | Ökosystem-Standard                        |
| `typescript`           | 5.6.3                  | Strict mode, satisfies-Operator           |
| `vite`                 | 5.4.9                  | Bündler                                   |
| `electron-vite`        | 2.3.0                  | Electron-Vite-Integration                 |
| `pdf-parse`            | 2.4.5                  | OOP-API                                   |
| `react-markdown`       | 10.1.0                 | Streaming-fähiges MD-Rendering            |
| `react-pdf`            | 10.4.1                 | PDF-Vorschau im SourceViewer              |
| `mammoth`              | latest beim Hinzufügen | DOCX-Parsing (Soll)                       |
| `argon2`               | latest beim Hinzufügen | Passwort-Hashing                          |
| `vitest`               | latest beim Hinzufügen | Test-Runner                               |
| `typedoc`              | latest beim Hinzufügen | Code-Doku-Generator                       |

Alle Versionen werden in `package.json` exakt festgenagelt; `pnpm-lock.yaml` erzwingt reproduzierbare Builds.

### Anhang C — Glossar

Siehe Abschnitt 1.6.

### Anhang D — Änderungsverzeichnis

| Version | Datum      | Änderung                                                                                                                                                                                                                                                                                                                                                                                                                                   | Verantwortlich |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 0.1     | 13.05.2026 | Initialer Entwurf                                                                                                                                                                                                                                                                                                                                                                                                                          | Dominik        |
| 0.9     | 14.05.2026 | Technische Detailtiefe von Denys ergänzt                                                                                                                                                                                                                                                                                                                                                                                                   | Denys          |
| 1.0     | 15.05.2026 | Freigabe-Version                                                                                                                                                                                                                                                                                                                                                                                                                           | Projektleiter  |
| 1.1     | 18.05.2026 | Abschnitte 1.2 Ziele (SMART) und 1.3 Nicht-Ziele ergänzt; Subsections in Abschnitt 1 umnummeriert; TOC erweitert                                                                                                                                                                                                                                                                                                                           | Denys          |
| 1.1.1   | 20.05.2026 | Nachtrag nach Sprint-3-Releases v0.2.2 + v0.2.3: Slim-Installer-Pivot (Modell-Bundling raus, First-Launch-Downloader rein), Linux-AppImage ergänzt (NZ-8), Hosting auf Hetzner-VM + Bunny CDN (statt GitHub Pages), AP-1.4 (Release-Pipeline) + AP-1.5 (Hardening) ergänzt, R6-Risiko gemitigt, faktische Korrekturen (Embedder BGE-M3, Modell-Pfad userData/models/, Webroot `website/`). Vom Projektleiter freigegeben.                  | Denys          |
| 1.1.2   | 28.05.2026 | Nachtrag nach Sprint-4/5-Releases v0.2.7–v0.3.0: Modell-Tiers `lite/standard/pro` + Qwen3.5-Familie (Pro = non-MTP 9B), Cross-Encoder-Reranker (bge-reranker-v2-m3), Tauri-Installer-Wizard + Download-Stub (ersetzt NSIS-Slim + in-app Downloader), HF-Buckets-Mirror + `cdn.loklm.ai`, macOS-Build-Pipeline (Release ausstehend), UI English-first + volle App-i18n, Node 24, optionaler Ollama-Provider. Vom Projektleiter freigegeben. | Denys          |
