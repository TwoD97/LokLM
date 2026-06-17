# Laborbericht — LokLM

|                          |                                                             |
| ------------------------ | ----------------------------------------------------------- |
| **Datum**                | 29.05.2026                                                  |
| **Bearbeiter**           | Dominik Furlan                                              |
| **Rolle**                | UI/UX · Tests · Dokumentation                               |
| **Projekt**              | LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation |
| **Sprint / Meilenstein** | Sprint 4 (25.05.–29.05.) · Meilenstein **M3** / **Gate G2** |
| **Software-Stand**       | v0.2.9 → **v0.3.1** (main)                                  |

---

## 1. Tagesziele

1. Gemeldeten Fehler „Einstellungen nicht bedienbar" untersuchen und beheben.
2. Lauffähige App-Version beim Anwender herstellen.
3. Repository (lokale Branches) aufräumen.
4. Meilenstein **M3 / Gate G2** abschließen (Auth-End-to-End-Test §8.2 muss grün laufen).

---

## 2. Durchgeführte Arbeiten

### 2.1 Fehlerdiagnose — „Settings gehen nicht" (LockedError)

- **Symptom:** In der laufenden App brach das Öffnen der Einstellungen mit
  `Uncaught (in promise) Error: ... 'settings:get': LockedError: locked` ab.
- **Vorgehen:** Systematische Fehlersuche (Root-Cause zuerst, kein Blind-Fix).
  Der Datenfluss wurde über drei Schichten verfolgt: Renderer (`useSettings`/`useT`)
  → IPC (`settings:get`) → Main/Auth (`AuthService`).
- **Gegenprüfung:** Die anfängliche Hypothese wurde durch eine unabhängige
  Mehrfach-Verifikation **widerlegt** — der Schutzcode existiert bereits im Quelltext
  (Guard `if (!getAuth().isUnlocked()) return DEFAULT_SETTINGS`, Commit `9ea3245`, 27.05.).
- **Eigentliche Ursache:** Die **installierte App war v0.2.9 (Build 25.05.)** und damit
  _älter_ als der Fix vom 27.05. Nachweis: Das installierte `app.asar` enthielt den
  Guard nicht (0 Treffer), wohl aber den Handler.
- **Ergebnis:** **Kein Code-Fehler** — der Quelltext war bereits korrekt. Der laufende
  Build war veraltet.

### 2.2 Bereitstellung einer lauffähigen Version

- **Installer-Build versucht** (`pnpm package:win`): Payload-Archiv, CUDA-Archiv (190 MB)
  und Manifest wurden erfolgreich erzeugt; der **Wizard-Schritt schlug fehl**, weil die
  **Rust-Toolchain (`cargo`) auf dem Rechner nicht installiert** ist (der Installer-Wizard
  ist eine Tauri-/Rust-Anwendung).
- **Alternative ohne Rust — In-Place-Update:**
  1. **Backup** der Installation angelegt (1,1 GB, ohne die 3,4 GB Modelle).
  2. Frischen **v0.3.0-Build per `robocopy` (Merge-Modus)** über die Installation gelegt;
     installationsspezifische Daten (Modelle, `loklm-tier.json`, CUDA-Bibliotheken) blieben
     erhalten — `node-llama-cpp` war beidseitig 3.18.1, daher kompatibel.
  3. **Verifiziert:** EXE-Version 0.3.0, Guard im `app.asar` vorhanden, 3 Modelle + CUDA intakt,
     asar-Integrität konsistent.
- **Ergebnis:** Installierte App auf **v0.3.0** angehoben; LockedError vom Anwender als behoben
  bestätigt.

### 2.3 Repository-Hygiene (lokale Branches)

- Alle 8 lokalen Branches analysiert (gemergt / ungemergt, Remote-Sicherung, Netto-Diff).
- **6 vollständig gemergte Branches** sicher (`git branch -d`) gelöscht.
- **Verbleibend (2):** `main` sowie `content/taxonomy-of-local-ai` (1 noch nicht gemergter Commit).
- Ein vom Build verändertes Build-Artefakt (`payload-manifest.json`) auf den committeten Stand
  zurückgesetzt, damit `main` sauber bleibt.

### 2.4 Meilenstein M3 / Gate G2 — Auth-End-to-End-Test (§8.2)

- **Erfüllungs-Kriterium (Pflichtenheft §9.3/§9.4):** Der E2E-Test aus §8.2
  (Registrierung → Login → Snapshot-Verschlüsselung → Restart → Entschlüsselung →
  Recovery-Reset → Login) muss **grün auf HW-1** laufen.
- **Test:** `tests/integration/auth-e2e.test.ts` (vitest, Projekt „integration").
  Jeder „App-Restart" wird als neue `AuthService`-Instanz gegen dasselbe Datenverzeichnis
  modelliert; zwischen den Schritten werden über den `WorkspaceService` echte Daten
  geschrieben und nach jedem Round-Trip verifiziert (Datenpersistenz statt reinem „Login geht").
- **Ergebnis (HW-1, DESKTOP-6S7VUR6):**
  `1 passed (~4,8 s)` — Stand v0.3.1 / Commit `6c05116` (Test eingeführt in `6610cef`).
- **Gate G2 = 🟢 GRÜN.** Folge: BGE-M3-Embeddings-Stretch bleibt im Scope, Mindestumfang
  (tsvector-Suche) gesichert, AP-10.1 (QLoRA) bleibt möglich.

---

## 3. Ergebnisse (Überblick)

| Ziel                           | Ergebnis                                           |
| ------------------------------ | -------------------------------------------------- |
| Settings-Fehler diagnostiziert | ✅ Ursache: veralteter Build (v0.2.9 < Fix 27.05.) |
| Lauffähige App beim Anwender   | ✅ In-Place-Update auf v0.3.0, bestätigt           |
| Branches aufgeräumt            | ✅ 8 → 2 (nur offene Arbeit + main)                |
| Meilenstein M3 / Gate G2       | ✅ §8.2-E2E grün auf HW-1, Gate G2 grün            |

---

## 4. Probleme & Erkenntnisse

- **Rust-Toolchain fehlt** auf dem Arbeitsrechner → lokaler Installer-Build nicht möglich.
  Offizielle Installer entstehen auf dem Rechner des Projektpartners.
- **Symptom ≠ Ursache:** Der Fehler lag nicht im Code, sondern in einem veralteten Build —
  durch systematische Verifikation aufgedeckt, statt vorschnell „zu fixen".
- **CI führt keine Test-Suite aus** (`.github/workflows/checks.yml` baut nur die Website) —
  der §8.2-Test ist damit nur lokal/HW-1 abgesichert.

---

## 5. Offene Punkte / Nächste Schritte

- **Settings-Re-Hydration nach Entsperren** (UI): Cache lädt einmalig zur Sperr-Zeit und wird
  nach dem Login nicht neu eingelesen → eigener Branch `dom/settings-rehydrate-after-unlock`
  angelegt (Verifikation + Fix + Regressionstests, test-first).
- **CI-Frage** an den Partner: Soll die Integrations-/E2E-Suite ins PR-Gate aufgenommen werden?
- **An den Partner gemeldet:** VRAM-Probe meldet ~80 GB statt ~6 GB (RTX 4050); Geschwister-Handler
  `settings:update`/`getAvatar` ohne `isUnlocked`-Guard.
- **Content:** Cornerstone-Artikel #5 (`content/taxonomy-of-local-ai`) fertigstellen → PR.

---

## 6. Artefakte / Nachweise

- **Test-Nachweis (HW-1, 29.05.2026):**
  `pnpm exec vitest run --project integration tests/integration/auth-e2e.test.ts` → `1 passed`.
- **Relevante Commits:** `9ea3245` (Settings-Guard, 27.05.), `6610cef` (Auth-E2E §8.2),
  `6c05116` (v0.3.1, verifizierter Stand).
- **Vikunja:** Task #17 (M3 Auth) — Hinweis: Querverweis im Outline-Doc zeigte fälschlich auf
  /tasks/18 (RRF-Task des Partners), korrekt ist /tasks/17.
