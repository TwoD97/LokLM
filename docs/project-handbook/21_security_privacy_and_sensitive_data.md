# Sicherheit, Datenschutz und sensible Daten

Stand: **2026-06-14**. LokLM ist eine rein lokale, offline arbeitende Single-User-Desktop-App (Electron [1]). Das Bedrohungsmodell ist daher konsequent „Angreifer mit Festplattenzugriff auf den lokalen Tresor" — nicht ein Cloud-/Multi-Tenant-Modell.

Quellen für dieses Kapitel: `docs/adr/0001-argon2id-password-kdf.md`, `docs/adr/0002-envelope-encryption-aes-gcm.md`, `docs/adr/0004-adaptive-model-residency.md`, `.gitignore`, `.env.example`, `tests/evals/model-license-registry.json`, `docs/work/projektstatusbericht-2026-06-14.md`.

---

## 21.1 Sensible Datenklassen

Tabelle 21.1 ordnet die sensiblen Datenklassen ihrer Behandlung zu.

**Tabelle 21.1:** Sensible Datenklassen und ihre Behandlung.

| Klasse | Beispiele | Behandlung |
|---|---|---|
| **Benutzergeheimnisse** | Vault-Passwort, 18-Wort-Recovery-Passphrase | Nie im Klartext persistiert; durchlaufen Argon2id; Schlüssel mlock-geschützt im Speicher (ADR-0001/0002) |
| **Nutzerinhalte** | Importierte Dokumente, Chunks, Chat-Verläufe, Embeddings/Vektoren | Vollständig im verschlüsselten `loklm.vault` (AES-256-GCM) |
| **Verhaltensdaten** | Geplantes Usage-Journal (welches Feature wann genutzt, ADR-0004 PROPOSED) | Vault-verschlüsselt, verlässt die Maschine nie, vollständig löschbar |
| **API-Keys / Tokens (lokal, Eval)** | RunPod-, AWS/S3-, Anthropic-Keys, Ollama-Bearer-Token | Nur in lokaler `.env` (gitignored), **nicht** auf GitHub |
| **Lokale Test-Notizen** | Zugangsdaten, Recovery-Phrasen aus manuellen Tests | `test-notes/` (gitignored), nie committen |
| **Modelle / Datasets** | GGUF-Gewichte, tessdata, regenerierbare Eval-Korpora | `/models/`, `/tessdata/`, große Eval-Reports gitignored |

---

## 21.2 Was nicht versioniert werden darf — gitignore-Konzept

Quelle: `.gitignore`. Die für Sicherheit/Datenschutz relevanten Einträge sind in Tabelle 21.2 aufgeführt.

**Tabelle 21.2:** Sicherheitsrelevante gitignore-Einträge.

| Pfad / Muster | Grund |
|---|---|
| `.env`, `.env.*` (außer `.env.example`) | **Live-Secrets** (RunPod/AWS/S3/Anthropic-Keys). Niemals auf GitHub. |
| `/models/` | GGUF-Gewichte (groß, teils lizenz-sensitiv) — Cache, nicht im Repo |
| `/tessdata/` | Tesseract-Traineddata (~28 MB), per Script nachladbar |
| `docs/work/` | Interne Arbeitsstände (Projektstatusberichte, Abschluss-Dokus, Laborberichte) |
| `docs/abgabe/` | Lokale Team-Abgabe-Dokumente — nicht auf GitHub |
| `test-notes/` | Lokale Test-Notizen mit Zugangsdaten / Recovery-Phrasen |
| `tests/evals/report/` | Eval-Reports (können LLM-Output + per-question.jsonl enthalten) |
| `tests/evals/ANLEITUNG-DOMINIK.md` | Lokale Anleitung, bleibt lokal |
| `tests/e2e/test-results/`, `…/.playwright-report/` | Playwright-Traces/Screenshots (können UI-Inhalte zeigen) |
| `coverage`, `*.lcov` | Coverage-Artefakte |

Lizenz-/Korpus-Daten (FLORES-200, Wikipedia-survival) sind als CC-BY-SA-4.0 markiert und über Scripts re-fetchbar; die Roh-Texte sind gitignored, Provenance (README + Manifest) bleibt im Repo (Quelle: `.gitignore`).

---

## 21.3 API-Keys in der lokalen .env

`.env.example` (committed, **Platzhalter only**) dokumentiert die erwarteten Variablen; die echten Werte liegen ausschließlich in der lokalen `.env` (gitignored). Tabelle 21.3 listet die Variablen mit ihrer Sensitivität.

**Tabelle 21.3:** Erwartete `.env`-Variablen und Sensitivität.

| Variable (in `.env.example`) | Inhalt | Sensitivität |
|---|---|---|
| `OLLAMA_BASE_URL`, `OLLAMA_BEARER_TOKEN` | Remote-Ollama-Proxy (z. B. RunPod) | Token sensitiv |
| `ANTHROPIC_API_KEY` | Anthropic-API (höherwertige synthetische Datasets) | Sensitiv |
| `RUNPOD_API_KEY`, `RUNPOD_POD_ID` | RunPod-Control-Plane (`pod:start/stop/status`) | Sensitiv |
| `OLLAMA_LLM_MODEL` / `_EMBEDDER_` / `_RERANKER_MODEL` | Modell-Pull-Liste | Nicht sensitiv |

> WICHTIG: In der lokalen, gitignoreten `.env` liegen **Live-RunPod-/AWS-/S3-Keys**. Sie sind nicht auf GitHub, eine **Rotation wird empfohlen**, bevor das Repo öffentlich breiter geteilt wird. Im Handbuch werden diese Werte ausschließlich als `<API_KEY>` / `<S3_KEY>` / `<TOKEN>` genannt — **niemals** mit echten Werten.

---

## 21.4 Vault-Verschlüsselung (ADR-0001 / ADR-0002)

### 21.4.1 Schlüsselableitung — Argon2id (ADR-0001)

KDF für Passwort **und** Recovery-Passphrase: **Argon2id** [6] (PHC-Gewinner, RFC 9106), Profil exakt wie Bitwarden (siehe Tabelle 21.4):

**Tabelle 21.4:** Argon2id-Parameter (Bitwarden-Profil).

| Parameter | Wert |
|---|---|
| `type` | `argon2id` |
| `memoryCost` | 65536 (64 MiB) |
| `timeCost` | 3 Passes |
| `parallelism` | 4 Lanes |
| `hashLength` | 32 Byte (= AES-256-Key) |
| Salt | 32 Zufallsbytes pro Geheimnis |

Das 32-Byte-Raw-Output **ist** der KEK — kein separater Verifier-Hash (verhindert einen kostenlosen Offline-Orakel-Check). PBKDF2/bcrypt/scrypt wurden bewusst verworfen (siehe [Decision Log](23_decision_log.md)). Login-Latenz von 300–500 ms ist explizites Ziel (verteuert jeden Brute-Force-Versuch).

### 21.4.2 Envelope-Encryption — AES-256-GCM (ADR-0002)

Einziges On-Disk-Artefakt: `loklm.vault` (Mode `0o600`, atomar via `write tmp → rename`). Ein zufälliger **DEK** (32 Byte, nie im Klartext auf Platte) verschlüsselt den kompletten PGlite-Tar-Dump (AES-256-GCM [7], 12-Byte-Nonce, 16-Byte-Tag). Der DEK wird je Geheimnis unter einem aus Argon2id abgeleiteten **KEK** gewrappt (Passwort-Wrap + Recovery-Wrap). Abbildung 21.1 zeigt den Schlüsselfluss von Passwort und Recovery-Passphrase bis zum entschlüsselten Tresor-Inhalt.

```mermaid
flowchart TD
    PW["Passwort"] -->|Argon2id(salt)| KEKpw["KEK_pw"]
    RP["18-Wort-Recovery-Passphrase"] -->|Argon2id(salt)| KEKrec["KEK_rec"]
    KEKpw -->|AES-256-GCM unwrap| DEK["DEK (32 B, nie im Klartext auf Platte)"]
    KEKrec -->|AES-256-GCM unwrap| DEK
    DEK -->|AES-256-GCM decrypt| BODY["PGlite-Tar-Dump<br/>(Dokumente, Chunks, Chat, Vektoren)"]
    subgraph FILE["loklm.vault (Single-File, 0o600, atomarer Rename)"]
        HDR["Header: salts + wrapped DEKs + Metadata"]
        CIPH["nonce(12) + tag(16) + ciphertext"]
    end
```

**Abbildung 21.1:** Envelope-Encryption — Schlüsselfluss des Vaults.

Folgen (ADR-0002): Passwort-Reset re-wrappt nur den 32-Byte-DEK (konstanter Aufwand, kein Re-Encrypt des ganzen Tresors); falsches Passwort → falscher KEK → GCM-Auth-Tag schlägt fehl → `unwrapKey` gibt `null`. Trade-off: **DEK-Rotation ist nicht möglich** ohne Komplett-Re-Encrypt (akzeptiert für Single-User-Lokal-App), und **Vault-Korruption ist fatal** (einzige zu sichernde Datei).

---

## 21.5 Electron-Härtung

Im Berichtszeitraum als „Electron-Sicherheitshärtung" gemerged (`04b318d`, Quelle: `projektstatusbericht-2026-06-14.md` Phase 17). Tabelle 21.5 fasst die Härtungsmaßnahmen zusammen.

**Tabelle 21.5:** Electron-Härtungsmaßnahmen und ihre Wirkung.

| Maßnahme | Wirkung |
|---|---|
| **Echte CSP** | Content-Security-Policy gegen Inline-/Remote-Code |
| **Renderer-Sandbox + CJS-Preload** | Renderer ohne Node-Integration; schmale Preload-Bridge |
| **Navigations-Guards** | Verhindert Navigation/Window-Open zu fremden Origins |
| **Electron Fuses** | Build-Zeit-Härtung (z. B. `RunAsNode`, Node-Options abschalten) |
| **mlock-geschützter Schlüsselspeicher** | KEK/DEK im RAM gegen Swapping auf Platte gesichert |

> WARN zu verifizieren — die genaue Fuses-/CSP-Konfiguration ist aus dem Projektstatusbericht zusammengefasst; für eine prüfbare Aufstellung sind die Build-Konfig und die Window-Erzeugung in `src/main/` heranzuziehen (außerhalb des Test-/Doku-Owners von Dominik, Domäne Denys).

---

## 21.6 Datenschutzrisiken

- **Offline-Grundsatz:** Nutzerinhalte und (geplantes) Usage-Journal verlassen die Maschine nie; kein Netzwerkpfad berührt diese Daten (ADR-0004). Das ist die zentrale Datenschutz-Eigenschaft des Produkts.
- **Verhaltensdaten (ADR-0004, PROPOSED):** Das adaptive Modell-Residency-Feature würde ein `usage_events`-Log anlegen (welches Feature wann). Es ist jedoch ein **Design-Vorschlag (ADR-0004, Status PROPOSED) — im aktuellen Stand NICHT implementiert** (kein `src/main/.../placement/`-Code vorhanden); zur Laufzeit wird derzeit kein solches Usage-Journal geführt. Wäre es gebaut, wäre es vault-verschlüsselt, nie übertragen, über die Settings vollständig löschbar — als ausdrücklicher Audit-Punkt markiert.
- **OCR / externe Modelle:** OCR läuft lokal (tessdata-Cache); keine Cloud-OCR. Eval-Datasets können über Anthropic generiert werden (API-Key), aber das betrifft Test-Korpora, nicht Nutzerinhalte.
- **Eval-Korpora-Lizenz:** Synthetische Sample-Docs sind selbst verfasst/lizenzfrei; externe Korpora (FLORES-200, Wikipedia) tragen CC-BY-SA-4.0 mit erhaltener Provenance.

> WARN Quelle fehlt — ein formales Datenschutz-/Verarbeitungsverzeichnis (DSGVO-Sicht) ist im Repo nicht vorhanden. Für eine reine Offline-Single-User-App ohne Datenübertragung ist der Verarbeitungsumfang minimal, eine explizite Erklärung fehlt aber bislang.

---

## 21.7 Offene Sicherheitsfragen

Tabelle 21.6 listet die offenen Sicherheitsfragen mit Stand und Beleg.

**Tabelle 21.6:** Offene Sicherheitsfragen mit Belegen.

| Frage | Stand | Beleg |
|---|---|---|
| **EV-Zertifikat / SmartScreen** | Windows-Code-Signing läuft; ein EV-Zertifikat zum sofortigen Abbau der SmartScreen-Warnung ist eine offene Budget-/Beschaffungsfrage | `projektstatusbericht-2026-06-14.md` „Notwendige Entscheidungen" |
| **Header-MAC über den Vault-JSON-Header** | Aktuell nicht implementiert; Header-Manipulation führt zu sauberem GCM-Unwrap-Fehlschlag ("bad password"), aber keine explizite Tamper-Detection auf den Header | ADR-0002 „Open Questions" |
| **Argon2-Parameter-Migration (Re-Hash-on-Login)** | Noch nicht implementiert; wird beim ersten Parameter-Bump in einem Folge-ADR adressiert | ADR-0001 „Open Questions" |
| **Secret-Rotation der lokalen `.env`** | Empfohlen; Live-Keys liegen lokal, nicht auf GitHub | Abschnitt 21.3 |
| **Auto-Update-Sicherheit** | Strategie offen (Velopack vs. electron-updater, Update-Server-Hosting, Rollback) | `projektstatusbericht-2026-06-14.md` |

Querverweise: Lizenz-Gate für Modelle siehe [Testing & QA](19_testing_and_quality_assurance.md) §7 und [Decision Log](23_decision_log.md); die Secret-/Zertifikat-/E2E-Risiken sind in der [Risikotabelle](22_risks_problems_and_mitigations.md) konsolidiert.
