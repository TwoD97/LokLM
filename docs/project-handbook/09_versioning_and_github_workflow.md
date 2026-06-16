# Versionierung und GitHub-Workflow

Die Versionierung von LokLM läuft vollständig über das öffentliche GitHub-Repository
**`TwoD97/LokLM`**. Git/GitHub ist zugleich Versionsverwaltung, Kollaborationsplattform
(Pull-Requests, Reviews), CI-Plattform (GitHub Actions) und Release-Quelle. Dieses
Kapitel beschreibt das Branch-Konzept, die Commit-/PR-/Merge-Logik, die Tag-Strategie,
die saubere Trennung von Code/Daten/Doku sowie den Umgang mit großen und sensiblen
Dateien.

## 9.1 Warum Versionierung für dieses Projekt zentral war

LokLM ist ein Zwei-Personen-Projekt mit **getrennten Domänen** (Denys: Chunking/Auth/
RAG/Installer; Dominik: UI/Tests/Doku/Eval). Ohne diszipliniertes Branching hätten sich
die beiden Arbeitsstränge ständig blockiert. Drei Gründe machten Versionierung
unverzichtbar:

1. **Parallelarbeit ohne Kollisionen** — Feature-Branches pro AP erlauben es beiden,
   gleichzeitig an unterschiedlichen Teilen zu arbeiten und erst beim PR zu integrieren.
2. **Nachvollziehbarkeit für die Abgabe** — Commit-Historie, PR-Verlauf und Tags
   bilden eine prüfbare Chronik der neun Wochen (ergänzt durch die Projektstatus- und
   Laborberichte, siehe `08_project_management_kanban_outline.md`).
3. **Auslieferung** — die Release-Pipeline (GitHub Actions) hängt direkt an Tags/Pushes;
   Versionierung ist also nicht nur Buchführung, sondern produktiver Auslieferungspfad.

## 9.2 Branch-Konzept

Das Repository nutzt mehrere Branch-Klassen mit klar getrennten Rollen (Tabelle 9.1):

**Tabelle 9.1:** Branch-Klassen und ihre Rollen.

| Branch-Klasse             | Beispiel                                                              | Rolle                                                                        |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Integrationsstand**     | `main`                                                                | abgenommener Stand; Quelle aller Releases; durch Branch-Protection geschützt |
| **Vorintegration**        | `development`                                                         | älterer Sammel-/Vorintegrations-Branch (existiert remote)                    |
| **Feature pro AP**        | `dom/ap6-search-filter`, `dom/ap-t2-integrationstests`                | je AP ein Branch, von `main` abgezweigt                                      |
| **Content (SEO/Website)** | `content/private-definition`, `content/taxonomy-of-local-ai`          | Website-/SEO-Inhalte getrennt vom App-Code                                   |
| **Doku**                  | `dom/doku`                                                            | Projekt-Handbuch / Dokumentationsarbeit, isoliert vom Code                   |
| **Release/Hotfix**        | `release/v0.2-rag`, `hotfix/0.4.0-mac`, `release/0.4.1-sidecar-fixes` | Release-Stabilisierung, plattform-spezifische Hotfixes                       |
| **Fix/CI**                | `fix/mac-dmg-license`, `fix/windows-cuda-ninja`                       | gezielte Build-/CI-Korrekturen                                               |
| **Dependabot**            | `dependabot/npm_and_yarn/vite-6.4.2`                                  | automatische Abhängigkeits-Updates                                           |

**Namenskonvention.** Dominiks Branches tragen durchgängig das Präfix `dom/` plus die
AP-ID (`dom/ap9-settings-ui`, `dom/ap-e1-eval-set`, `dom/ap-e2-matrix-eval`). Das macht
einen Branch eindeutig einem Arbeitspaket **und** einem Bearbeiter zuordenbar.

> ⚠️ zu verifizieren: Die genaue Rolle von `development` im täglichen Fluss ist aus
> dem Repo nur teilweise ableitbar — der Branch enthält einen Merge von `origin/main`
> und zusätzliche Quiz-/UX-Commits, die (noch) nicht auf `main` sind. Die Aussage „Vor-
> integrationsstand" ist eine plausible Einordnung und durch das Team zu bestätigen.

**Branch-Schutz `main` (Hard Rule).** Auf `main` wird nicht direkt entwickelt; jede
Änderung läuft über einen Branch und einen PR. Merges sind durch Review-Freigabe
(Branch-Protection) gehalten — mehrere Abschluss-Dokus vermerken explizit, dass ein PR
„mergebar, alle Checks grün" ist und „nur durch die Review-Freigabe gehalten" wird
(z. B. AP-T.2 / PR #19).

## 9.3 Commit-Konvention

Commits folgen einem **kommagetrennten Präfix-Schema**, das Typ, Bereich/AP und
Kurzbeschreibung trennt:

```
<typ> , <bereich/AP> , <kurzbeschreibung>
```

Beispiele aus der Historie:

- `tests , AP-T.1 , Vitest Unit-Tests + >=70% Branch-Coverage (...)`
- `feat , AP-E.2 , matrix embedder/reranker/chunker axes from packs`
- `docs , AP-E.2 , note span r@10/nDCG live in result.json not summary table`
- `release , v0.4.2 , windows + linux + macos assets`

Daneben existieren Conventional-Commit-artige Nachrichten bei den vom Partner
eingespielten Features (`feat(translation): provision MADLAD model …`). Der gemeinsame
Nenner ist, dass **Typ** (`feat`/`fix`/`tests`/`docs`/`refactor`/`release`/`ci`) und
**AP-/Bereichs-Bezug** im Subject stehen, sodass `git log` allein bereits eine grobe
AP-Chronik liefert.

> Hinweis: Commit-Nachrichten enthalten projektgemäß **keine** Co-Authorship- oder
> Werkzeug-Vermerke; das ist eine bewusste Team-Regel.

## 9.4 Pull-Request- und Merge-Logik

**Branch-pro-AP → PR → `main`.** Der Standardfluss ist: AP-Branch entwickeln, PR gegen
`main` öffnen, CI grün, Review, Merge. Stand 14.06.2026 existieren **26 Pull-Requests**.
Die folgende Tabelle ist aus den GitHub-PR-Daten (echte Merge-Zeitstempel) abgeleitet (Tabelle 9.2):

**Tabelle 9.2:** Pull-Requests #1–#26 mit Bereich, Status und Merge-Datum.

| PR  | Titel (gekürzt)                          | Bereich                 | Status      | Merge-Datum |
| --- | ---------------------------------------- | ----------------------- | ----------- | ----------- |
| #1  | Deployment landingpage                   | Website                 | gemergt     | 18.05.      |
| #2  | SEO Phase 1 — Cluster-Infrastruktur      | Website/SEO             | gemergt     | 28.05.      |
| #3  | Cornerstone #1 „privat" (DE/EN)          | Content                 | gemergt     | 28.05.      |
| #4  | Cornerstone #2 EU AI Act                 | Content                 | gemergt     | 28.05.      |
| #5  | Cornerstone #3 DSGVO/Datenexport         | Content                 | gemergt     | 28.05.      |
| #6  | Auth-E2E §8.2 (M3/G2)                    | Test (Dominik)          | gemergt     | 28.05.      |
| #7  | Cornerstone #4 Quellenverweise           | Content                 | gemergt     | 28.05.      |
| #8  | Cornerstone #5 Taxonomie (Erstentwurf)   | Content                 | gemergt     | 02.06.      |
| #9  | Cornerstone #5 Taxonomie (Finalisierung) | Content                 | gemergt     | 08.06.      |
| #10 | Linux `.deb`-Artefakt + glibc-Baseline   | Installer (Denys)       | gemergt     | 08.06.      |
| #11 | Eval-Automatisierung (Handover-Infra)    | Eval (Dominik)          | gemergt     | 08.06.      |
| #12 | AP-6 Suche/Filter (Library)              | Feature (Dominik)       | gemergt     | 10.06.      |
| #13 | AP-9 Settings-UI (Theme/Sprache/Felder)  | Feature (Dominik)       | gemergt     | 10.06.      |
| #14 | M-Szenarien AP-T.3b                      | Test (Dominik)          | gemergt     | 08.06.      |
| #15 | Bump astro 5 → 6 (Website)               | Dependabot              | **offen**   | —           |
| #16 | Bump vite 5 → 6                          | Dependabot              | geschlossen | 16.06.      |
| #17 | Bump vitest 2 → 3                        | Dependabot              | geschlossen | 16.06.      |
| #18 | AP-9: Account — neue Recovery-Codes      | Feature (Dominik)       | **gemergt** | 16.06.      |
| #19 | AP-T.2 Integrationstests (§8.2 E2E)      | Test (Dominik)          | **gemergt** | 16.06.      |
| #20 | Translation-Eval                         | RAG/Translation (Denys) | gemergt     | 13.06.      |
| #21 | v0.4.1 Translator-Sidecar Cross-Platform | Release (Denys)         | gemergt     | 13.06.      |
| #22 | Sidecar-Build grün auf allen Plattformen | CI (Denys)              | gemergt     | 13.06.      |
| #23 | Windows-GPU-Sidecar (Ninja/CUDA)         | CI (Denys)              | gemergt     | 13.06.      |
| #24 | AP-T.1 Unit-Tests ≥70 % Branch           | Test (Dominik)          | **gemergt** | 16.06.      |
| #25 | AP-E.1 Eval-Dev-Set (80 Fälle)           | Eval (Dominik)          | **gemergt** | 16.06.      |
| #26 | Translation: MADLAD via Installer-Wizard | Translation (Denys)     | gemergt     | 14.06.      |

**Belegte Lesart der PRs (Stand 2026-06-16):** #19 (AP-T.2), #24 (AP-T.1), #25 (AP-E.1) sowie #18 (AP-9 Account-Recovery) sind am 2026-06-16 gemergt; das Hold-out AP-E.1b folgt als #28 (im Review). Von den Dependabot-Upgrades #15–#17 sind #16 (vite) und #17 (vitest) inzwischen geschlossen, #15 (astro, Website) ist noch offen.

> Hinweis zur Prompt-Vorgabe: Die in der Aufgabenstellung genannten „gemergten PRs
> #9/#11/#12/#13/#14" bestätigen sich (alle gemergt 08.–10.06.); die „in Review"
> befindlichen #19/#24/#25 bestätigen sich ebenfalls. Zusätzlich offen ist #18.

## 9.5 Tag-Strategie (semantische Versionierung)

Releases werden über Git-Tags markiert. Die Tag-Historie (mit echten Erstellungsdaten; Tabelle 9.3):

**Tabelle 9.3:** Git-Tag-Historie (semantische Versionierung).

| Tag                 | Datum  | Inhalt (Kurz)                                                    |
| ------------------- | ------ | ---------------------------------------------------------------- |
| `0.01`              | 14.05. | früher Initial-/Test-Tag (abweichendes Schema)                   |
| `v0.1.1` / `v0.1.2` | 17.05. | Landingpage + Branding; Auth-Rework                              |
| `v0.2.0`–`v0.2.3`   | 19.05. | bundled Models, UX/Chunking/RAG, NSIS + Runtime-Download         |
| `v0.2.4`            | 22.05. | Electron-Installer-Pivot + Features (Quiz/DOCX/Folder-Sync)      |
| `v0.2.5` / `v0.2.6` | 22.05. | Folge-Releases                                                   |
| `v0.2.7`–`v0.2.9`   | 25.05. | tier-bewusster Installer (lite/standard/pro); English-first i18n |
| `v0.3.0`            | 27.05. | Download-Stub + Multi-OS-Wizard + CUDA                           |
| `v0.3.1`            | 29.05. | OCR + RAG-Robustheit + Windows-Code-Signing                      |
| `v0.4.0`            | 10.06. | Audio-Transkription + Quiz-Rework                                |
| `v0.4.1`            | 13.06. | Translator-Sidecar + Multi-OS-Härtung                            |

**Schema.** Ab `v0.1.1` durchgängig `vMAJOR.MINOR.PATCH`. Der Anfangstag `0.01` weicht
ab (frühe Init-Phase). Minor-Bumps markieren funktionale Sprünge (z. B. v0.3.0
Installer-Pivot, v0.4.0 Audio), Patch-Bumps Fixes/Härtung.

**Hinweis zu v0.4.2.** Die Prompt-Vorgabe nennt „Tags v0.1.1–v0.4.2". v0.4.2 existiert
im Repo als **Release-Commit (`783ca4b`**, „release , v0.4.2 , windows + linux + macos
assets", 14.06.), **aber (noch) kein Git-Tag — der höchste gesetzte Tag ist v0.4.1**
(`git tag -l` listet nur bis `v0.4.1`, kein `v0.4.2`). Die obige Tag-Tabelle endet daher
korrekt bei v0.4.1. Stand 15.06.2026 reicht die Release-Commit-Kette auf `main` jedoch
bereits bis v0.4.6 (`package.json` = 0.4.6: Commits v0.4.3 `1f2f40b`, v0.4.4 `4d8d66c`,
v0.4.5 `619d0d8`, v0.4.6 `af59c25`, alle 15.06.); ein zugehöriger Git-Tag wurde für v0.4.2
bis v0.4.6 (noch) nicht gesetzt — der höchste gesetzte Tag bleibt `v0.4.1`.

## 9.6 Trennung Code / Daten / Doku

Eine zentrale `.gitignore`-Entscheidung sorgt dafür, dass nur **Code und Provenienz**
versioniert werden, nicht aber große, regenerierbare oder sensible Inhalte (Tabelle 9.4):

**Tabelle 9.4:** Trennung von versioniertem und ausgeschlossenem Inhalt (`.gitignore`).

| Klasse                       | Beispiel-Pfad                                                            | Im Git?  | Begründung (aus `.gitignore`)                                                        |
| ---------------------------- | ------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------ |
| **App-Code**                 | `src/main/...`, `installer-ui/...`                                       | ja       | Kern des Produkts                                                                    |
| **Test-Code + Eval-Daten**   | `tests/evals/data/datasets/*.json`, `tests/evals/data/sample-docs/*.txt` | ja       | reproduzierbare Test-/Eval-Grundlage (63 getrackte Dateien unter `tests/evals/data`) |
| **GGUF-Modelle**             | `/models/`                                                               | **nein** | „Top-level GGUF cache only" — mehrere GB, zur Laufzeit/per Installer geladen         |
| **OCR-Trainingsdaten**       | `/tessdata/`                                                             | **nein** | ~28 MB, via Skript nachladbar                                                        |
| **Eval-Reports**             | `tests/evals/report/`                                                    | **nein** | „regenerated per run, can be large"                                                  |
| **Roh-Korpora (lizenziert)** | `tests/evals/.../wikipedia-survival/*.txt`, FLORES-200                   | **nein** | CC-BY-SA-4.0, re-fetchbar; nur Dataset+Manifest committed (Provenienz)               |
| **Build-Artefakte**          | `release`, `dist`, `out`, `resources/installer-splash.*`                 | **nein** | generiert                                                                            |
| **Dokumentation (intern)**   | `docs/work/`, `docs/abgabe/`, `Pflichtenheft_LokLM.md`                   | **nein** | interne Steuer-/Abgabe-Doku, siehe unten                                             |
| **ADRs**                     | `docs/adr/000X-*.md`                                                     | **ja**   | technische Entscheidungsbelege, vom Code referenziert                                |
| **Geheimnisse**              | `.env`, `.env.*`, `test-notes/`                                          | **nein** | „Zugangsdaten / Recovery-Phrasen — NIE committen"                                    |

**Leitprinzip:** Versioniert wird, was **klein, reproduzierbar-relevant und nicht
sensibel** ist (Code, Test-Fixtures, Dataset-Manifeste, ADRs). Ausgeschlossen wird, was
**groß und regenerierbar** (Modelle, Reports, Build-Output) oder **sensibel/intern**
(`.env`, `test-notes/`, `docs/work/`, `docs/abgabe/`) ist. Bei lizenzierten Korpora
(CC-BY-SA-4.0) bleibt bewusst nur das **Manifest + die abgeleiteten Chunks** versioniert
(Provenienz-Nachweis), der Rohtext wird per Skript nachgeladen.

## 9.7 Umgang mit sensiblen und großen Dateien

- **Sensible Daten** werden grundsätzlich nicht committed: API-/CDN-Keys liegen in
  `.env`/CI-Secrets (`<API_KEY>`, `<TOKEN>`), lokale Test-Notizen mit Recovery-Phrasen
  in `test-notes/` (gitignored). Interne Domains (`notes.<PRIVATE_DOMAIN>`,
  `tasks.<PRIVATE_DOMAIN>`) tauchen nur in den gitignored Abschluss-Dokus auf.
- **Große Binärdateien** (GGUF-Modelle, ~mehrere GB) werden **nicht** in Git gehalten,
  sondern zur Laufzeit/über den Installer geladen. Der Installer selbst durchlief
  deshalb einen Pivot von ~500 MB eingebetteter Payload auf einen ~8 MB Download-Stub
  (siehe `11_work_package_details.md`, AP Installer-Pivot).
- **Release-Assets** liegen nicht im Repo, sondern werden von der Pipeline gebaut, in den
  MinIO-Bucket (`s3.ltwodl.com/loklm-installers/v<V>/`) geladen und öffentlich über
  Bunny-CDN ausgeliefert; MinIO dient zugleich als Backup-Spiegel (Fallback bei
  Bunny-CDN-Ausfall).
- **Build-Artefakt-Drift** wurde aktiv vermieden: Der Laborbericht 29.05. vermerkt, dass
  ein vom lokalen Build verändertes `payload-manifest.json` gezielt auf den committeten
  Stand zurückgesetzt wurde, damit `main` sauber bleibt.

## 9.8 CI/CD-Anbindung

Vier GitHub-Actions-Workflows hängen an der Versionierung
(`.github/workflows/`; Tabelle 9.5):

**Tabelle 9.5:** GitHub-Actions-Workflows und ihre Auslöser.

| Workflow                       | Auslöser                                                                          | Funktion                                                                |
| ------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `deploy-website.yml`           | Push auf `main` (Website)                                                         | baut + deployt die Landingpage                                          |
| `checks.yml`                   | PR                                                                                | Website-Build + (seit AP-T.2) erster vitest-Job (integration + tx)      |
| `release-installer.yml`        | Release                                                                           | baut Multi-OS-Installer, Upload nach MinIO, Auslieferung über Bunny-CDN |
| `build-translator-sidecar.yml` | manuell (`workflow_dispatch`) oder Push auf `main` unter `sidecars/translator/**` | baut den GPU-Translator-Sidecar (Win/Linux/macOS)                       |

**Wichtige Einschränkung (ehrlich gekennzeichnet):** Lange Zeit baute die CI **nur die
Website** — der erste echte Test-Job (`checks.yml`, integration + tx) entstand erst mit
AP-T.2 (PR #19) und ist damit noch **nicht in `main`** gemergt. Die modell-gebundene
RetrievalService-E2E **skippt in CI** (BGE-M3-GGUF liegt nicht im Runner) und ist nur
lokal abgesichert. Die Playwright-E2E-Suite für die Electron-App **läuft nicht in CI**
(kann Electron mit `--remote-debugging-port=0` nicht starten) — siehe Test-Kapitel.

## 9.9 Zusammenfassung

Git/GitHub trägt in LokLM vier Rollen gleichzeitig: **Versionsverwaltung** (Branches,
Tags), **Kollaboration** (PRs, Reviews, Branch-Protection auf `main`), **CI/CD**
(vier Workflows) und **Nachweis** (Commit-/PR-/Tag-Historie als Abgabe-Chronik). Die
strikte `.gitignore`-Politik trennt versionierten Code/Test-/ADR-Inhalt sauber von
großen Modellen, regenerierbaren Artefakten und sensiblen/internen Dokumenten — was das
öffentliche Repo schlank und unbedenklich hält und zugleich die volle Provenienz für
Daten und Releases bewahrt.
