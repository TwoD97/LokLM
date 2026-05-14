# ADR-0002 — Envelope-Encryption: DEK + KEK-Wrapping mit AES-256-GCM

**Status:** accepted
**Datum:** 2026-05-14
**Owner:** Denys
**Bezug:** [PH] Pflichtenheft §3.1.1 (Verschlüsselung der lokalen DB), §3.1.3 (Recovery-Flow), [ADR-0001](0001-argon2id-password-kdf.md)
**Implementierung:** [src/main/services/auth/AuthService.ts:17-96](../../src/main/services/auth/AuthService.ts#L17-L96), [src/main/services/auth/AuthService.ts:380-455](../../src/main/services/auth/AuthService.ts#L380-L455), [src/main/services/auth/AuthService.ts:528-573](../../src/main/services/auth/AuthService.ts#L528-L573)

## Libraries

Konkrete Pakete aus [package.json](../../package.json), die diese Entscheidung tragen:

| Paket                  | Version   | Rolle                                                                                                                                                                                            |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node:crypto` (stdlib) | Node ≥ 20 | Komplette Wrap-/Bulk-Cipher-Schicht: `createCipheriv('aes-256-gcm', …)`, `createDecipheriv`, `getAuthTag` / `setAuthTag`, `randomBytes` für Nonces + DEK, `timingSafeEqual` für den Magic-Check. |
| `@electric-sql/pglite` | `^0.4.5`  | Liefert via `db.dump()` den Tar-Blob, der zum Snapshot-Plaintext wird. Bestimmt Größe und Struktur dessen, was AES-256-GCM verschlüsselt.                                                        |
| `argon2`               | `^0.44.0` | KEK-Ableitung für jeden Wrap-Eintrag (siehe [ADR-0001](0001-argon2id-password-kdf.md)).                                                                                                          |
| `drizzle-orm`          | `^0.45.2` | Schreibt die Schema-konformen `users` / `recovery_codes`-Zeilen in den PGlite-Snapshot. Sieht nur Plaintext-Klartext-DB — Verschlüsselungs-Layer ist unter Drizzle, nicht durch Drizzle.         |
| `electron`             | `^42.0.0` | Stellt `app.getPath('userData')` bereit, unter dem `loklm.vault` mit Mode `0o600` abgelegt wird.                                                                                                 |
| `node:fs/promises`     | Node ≥ 20 | Atomare `write tmp → rename`-Persistenz für die Vault-Datei.                                                                                                                                     |

Bewusst **nicht** verwendet (Anti-Liste, damit künftige Beiträge nicht unbemerkt zusätzliche Krypto-Surface einziehen):

- `crypto-js`, `node-forge`, `sjcl` — Pure-JS-Krypto. Langsamer, größerer Audit-Surface, kein AES-NI. Stdlib reicht.
- `@noble/ciphers`, `libsodium-wrappers` — exzellente Bibliotheken, aber Stdlib deckt unseren Bedarf vollständig. Eine zweite AEAD-Implementierung im Tree wäre nur zusätzlicher Maintenance-Aufwand.
- `keytar` / OS-Keychain-Integration — explizit nicht: das Bedrohungsmodell verlangt, dass der DEK _nur_ über das Benutzergeheimnis erreichbar ist, nicht über einen automatisch entsperrten OS-Keystore.

---

## Context

LokLM persistiert den kompletten PGlite-Tar-Dump zusammen mit dem Auth-Header in einer einzigen Vault-Datei (`loklm.vault`). Diese Datei enthält den gesamten Tresor (Dokumente, Chunks, Chat-Verläufe, Vektoren) sowie die Wrap-Material-Header und muss zwei Eigenschaften erfüllen:

1. **Vertraulich** — ohne das Benutzergeheimnis nicht lesbar.
2. **Recoverbar** — wenn der Benutzer das Passwort vergisst, muss eine 18-Wort-Passphrase denselben Tresor entsperren, **ohne die DB neu zu verschlüsseln**.

Würde der Snapshot direkt mit einem aus dem Passwort abgeleiteten Key (`KEK_pw`) verschlüsselt:

- Passwort-Reset = vollständige Neuverschlüsselung des kompletten Tresors (potenziell hunderte MB).
- Recovery-Passphrase müsste denselben Key liefern — heißt: zwei Eingaben generieren bitgenau dasselbe `KEK_pw`. Unmöglich, ohne Klartext-Sharing.

Standard-Lösung dafür ist **Envelope-Encryption** (RFC 5649, NIST SP 800-38F — Key Wrap, plus die Common-Practice-Variante mit AES-GCM): ein einmal generierter, niemals geänderter Daten-Key (DEK) verschlüsselt die Nutzdaten, und der DEK selbst wird unter mehreren Schlüssel-Wrappern (KEKs) abgelegt.

## Decision

### Aufbau

Einziges On-Disk-Artefakt ist `loklm.vault`. Header (wrapped DEKs + Metadata) und verschlüsselter Snapshot leben im selben File und werden atomar als Einheit getauscht.

```text
                    ┌──── loklm.vault ───────────────────────────────────────┐
                    │ "LOKLM04\0"  ║  headerLen(4 BE)  ║  headerJson         │
                    │                                                        │
                    │ headerJson = {                                         │
                    │   passwordSalt (32 B base64)                           │
                    │   passwordWrappedDek = AES-256-GCM(KEK_pw,  DEK)       │
                    │   recoveryEntries[0]:                                  │
                    │     salt (32 B base64)                                 │
                    │     wrappedDek = AES-256-GCM(KEK_rec, DEK)             │
                    │   displayName, recoveryLang, createdAt                 │
                    │ }                                                      │
                    │ ────────────────────────────────────────────────────── │
                    │ nonce(12)  ║  tag(16)  ║  ciphertext                   │
                    │                                                        │
                    │ ciphertext = AES-256-GCM(DEK, tar(pglite-dump))        │
                    └────────────────────────────────────────────────────────┘
                                  │
   Passwort ── Argon2id(salt) ──► KEK_pw  ─┐
                                            ├─► unwrap ─► DEK ─┐
   Passphrase ─ Argon2id(salt) ─► KEK_rec ─┘                   │
                                                                ▼
                                                       Body wird entschlüsselt
                                                       und an PGlite.loadDataDir
                                                       übergeben.
```

- **DEK** — 32 Zufallsbytes, einmal pro Installation generiert, lebt **nie auf der Platte im Klartext**.
- **KEK** — pro Geheimnis individuell aus Argon2id abgeleitet (siehe [ADR-0001](0001-argon2id-password-kdf.md)).
- **Wrap-Primitive** — AES-256-GCM mit 12-Byte-Nonce und 16-Byte-Auth-Tag.
- **Bulk-Cipher für den Snapshot** — ebenfalls AES-256-GCM mit eigenem Nonce/Tag.
- **Single-File-Layout** — 8-Byte-Magic (`LOKLM04\0`), 4-Byte-Big-Endian-headerLen, JSON-Header, dann Nonce/Tag/Ciphertext.

### Warum ein einziges File

Vorgänger-Iteration (v2/v3) hatte zwei Dateien: `auth.json` (Header) + `pgdata.snapshot.enc` (Body). Probleme:

- **Drift-Risiko** — ein Crash zwischen den beiden atomaren Renames hinterlässt einen Mischzustand (altes Header zu neuem Body oder umgekehrt) → "Bad password" obwohl Passwort richtig.
- **Header-Verlust = Total-Verlust** — versehentliches Löschen oder Antivirus-Quarantäne der kleinen `auth.json` brickt den großen Snapshot dauerhaft. Recovery-Passphrase hilft nicht, weil der Recovery-Salt im Header steht.
- **Backup-Surface** — Anwender muss zwei Files kopieren, vergisst oft eins.

Single-File-Layout collapseiert beides:

- Atomarer Rename garantiert per Konstruktion, dass Header und Body **immer** zusammenpassen.
- Ein File backuppen = volle Recovery-Kette intakt.
- Korruption ist binär: Vault ist entweder lesbar oder weg — kein Mischzustand mehr.

### Warum AES-256-GCM für beides

| Anforderung               | AES-256-GCM erfüllt?                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated Encryption  | ✅ — GCM kombiniert CTR-Mode mit GMAC. Der 16-Byte-Auth-Tag erkennt jede Manipulation am Ciphertext **und** macht falschen KEK detektierbar. |
| Standardisiert            | ✅ — NIST SP 800-38D, in TLS 1.2/1.3, SSH, IPsec, FIPS-zertifiziert.                                                                         |
| In Node.js Stdlib         | ✅ — `node:crypto`, `createCipheriv('aes-256-gcm', …)`. Keine externe Krypto-Bibliothek nötig.                                               |
| Hardware-Beschleunigt     | ✅ — AES-NI auf jeder x86-CPU seit 2010, ARMv8 Crypto-Extensions. GCM-Throughput ist auf Desktop-Hardware GB/s.                              |
| Konstant-Zeit (PRF-Sicht) | ✅ — bei Hardware-Implementierung. Wichtig für die Auth-Tag-Vergleichs-Operation.                                                            |

### Warum 12-Byte-Nonce, frisch pro Operation

NIST SP 800-38D §8.2.1 fordert: für eine gegebene Key/Nonce-Kombination darf der Nonce **niemals** wiederverwendet werden — Wiederholung kompromittiert die Confidentiality des betroffenen Plaintexts und den Auth-Tag. 12 Byte ist die GCM-Standard-Länge (geringster Overhead, kein internes Nonce-Padding).

In LokLM wird jeder Nonce vom OS-CSPRNG (`crypto.randomBytes(12)`) generiert. Bei 2⁹⁶ möglichen Nonces ist die Birthday-Bound bei ~2⁴⁸ Operationen mit demselben Key (~280 Billionen) — für einen Single-User-Snapshot, der bei jedem Lock einmal neu geschrieben wird, irrelevant.

### Warum Wrong-Secret-Detection über den Auth-Tag, kein separater Verifier

Klassisches Anti-Pattern: KDF-Output wird in zwei Hälften gespalten, eine wird auf die Platte geschrieben als "Stimmt das Passwort?"-Verifier, die andere wird als KEK verwendet. Das gibt einem Offline-Angreifer einen **kostenlosen Orakel-Check**: kein AES-Decrypt nötig, nur Hash-Vergleich.

LokLM-Konstruktion: KEK ist das volle 32-Byte-Argon2id-Output. Falsches Passwort → falscher KEK → AES-GCM-Auth-Tag-Verifikation schlägt fehl → `unwrapKey` gibt `null` zurück. Der Angreifer muss **jeden** Kandidaten durch die volle Argon2id-Berechnung schicken und dann durch den GCM-Auth-Check — kein Shortcut.

Dieselbe Konstruktion verwenden:

- **age** (`age-encryption.org/v1`): `HKDF` → `ChaCha20-Poly1305`-Wrap des Daten-Keys, Wrong-Recipient-Detection ausschließlich über den Poly1305-Tag.
- **Bitwarden**: Master-Key wrappt den Symmetric-Key per AES-CBC + HMAC (vor 2023) bzw. AES-GCM (neuere Clients). Verifier-Hash existiert separat, ist aber serverseitig (Login zu Bitwarden-Cloud). Für rein lokale Vaults wäre er unnötig.
- **Signal-Desktop**: Argon2id-Output ist SQLCipher-Key; SQLCipher selbst macht den Wrong-Key-Check über sein Page-MAC.
- **Vaultwarden**: spiegelt das Bitwarden-Schema 1:1, inklusive Argon2id-Defaults seit 2023.

### Warum die DEK über die Lebenszeit der Installation konstant bleibt

- **Reset-Performance**: Passwort-Reset re-wrappt nur den 32-Byte-DEK unter neuem KEK_pw + neuem KEK_rec. Der DEK selbst bleibt gleich; das Ciphertext wird zwar mit frischem Nonce neu geschrieben, der Plaintext-Tresor bleibt aber inhaltlich unverändert.
- **Crash-Sicherheit**: Reset schreibt die neue Vault atomar via `write tmp → rename`. Bei Crash mitten im Rename liegt entweder die alte Vault (altes Passwort funktioniert) oder die neue (neues Passwort funktioniert) auf der Platte. Kein Mischzustand möglich, weil Header und Body untrennbar zur selben Datei gehören.
- **Atomare Rotation**: Einzelner `fs.rename`-Call, dem das OS POSIX-Atomicity garantiert.

Trade-off: ein einmal kompromittierter DEK bleibt für die Lebenszeit der Installation kompromittiert. Mitigation: bei Verdacht ist die Anweisung "neuer Tresor, alten Snapshot importieren" — DEK-Rotation ist explizit nicht implementiert, weil sie ohne Re-Encrypt nicht möglich ist und der Aufwand für ein lokales Single-User-Tool nicht gerechtfertigt scheint.

### Wie Production-Systeme das umsetzen

| System                      | DEK + KEK-Wrap?                                                     | Bulk-Cipher                                    | Wrap-Cipher                               | Bemerkung                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bitwarden / Vaultwarden** | Ja — Master-Key wrappt Symmetric-Key, Symmetric-Key wrappt Items    | AES-CBC + HMAC-SHA256 (legacy) / AES-GCM (neu) | Identisch zum Bulk                        | "Account Encryption Key" = DEK in unserer Terminologie. Wird beim Master-Password-Reset neu gewrapped, nicht neu generiert.                      |
| **1Password**               | Ja — "Account Unlock Key" + "Vault Keys" hierarchisch               | AES-256-GCM                                    | AES-256-GCM (RFC 5649 KW-Variante teilw.) | 1P fügt einen "Secret Key" (zufällige 128-Bit Komponente) zum Passwort hinzu, bevor Argon2 läuft — Verteidigung gegen schwaches Master-Password. |
| **AWS KMS / GCP KMS**       | Ja — `GenerateDataKey` liefert (Plaintext-DEK, Wrapped-DEK)         | Beliebig (AES-GCM common)                      | AES-256-GCM / AES Key Wrap (RFC 5649)     | Das Original-Pattern. KMS-Master-Key spielt die Rolle des KEK, Cloud-Service speichert den Wrapped-DEK neben dem Ciphertext.                     |
| **HashiCorp Vault**         | Ja — `transit` Engine                                               | AES-256-GCM                                    | AES-256-GCM                               | "Encryption-as-a-Service"-Pattern: DEK wird per `GenerateDataKey` an die App ausgeliefert, KEK bleibt im Vault.                                  |
| **Signal Desktop**          | Halb — kein klassisches Envelope; SQLCipher-Key direkt aus Argon2id | SQLCipher (AES-256-CBC + HMAC)                 | n/a                                       | Kein DEK-Layer, weil Recovery-Flow anders aussieht (Backup-PIN getrennt vom Daten-Key).                                                          |
| **age**                     | Ja — File-Key (DEK) wird je Recipient gewrappt                      | ChaCha20-Poly1305                              | ChaCha20-Poly1305 + HKDF                  | Multi-Recipient-Support ist genau unser Pattern (Passwort + Recovery-Passphrase = zwei Recipients).                                              |

LokLM liegt **strukturell auf der Linie age/Bitwarden**: ein DEK, mehrere Wrap-Einträge (Passwort + Recovery), GCM für beide Ebenen.

### Verworfene Alternativen

- **Snapshot direkt unter passwortabgeleitetem Key verschlüsseln (kein DEK-Layer).** Erzwingt Re-Encrypt bei jedem Passwort-Reset; bricht Recovery (zwei Eingaben → identischer Key unmöglich).
- **AES-CBC + HMAC** statt GCM. Wäre defensiv (CBC ist älter, einfacher zu analysieren), aber zwei Primitive zu kombinieren ist eine bekannte Fehlerquelle ("encrypt-then-MAC" vs. "MAC-then-encrypt", Padding-Oracle). GCM kombiniert beides in einem standardisierten Mode.
- **AES-Key-Wrap (RFC 3394 / 5649)** für die DEK-Wraps. Eleganter (deterministisch, kein Nonce-Management für die Wraps), aber Node-Stdlib hat keine Implementierung. AES-GCM mit frischem Nonce erreicht dieselben Sicherheits-Eigenschaften und ist out-of-the-box verfügbar.
- **ChaCha20-Poly1305** statt AES-GCM. Cipher-mäßig äquivalent (beide AEAD, beide modern), aber AES profitiert auf jeder Ziel-Hardware von AES-NI. ChaCha hätte auf reinem ARM ohne AES-Extensions einen Performance-Vorteil — LokLM zielt auf x86-Desktops, kein Mobile.
- **Eigene Konstruktion (XOR + HMAC, etc.)** — Nein.

## Consequences

**Positiv**

- **Konstanter Reset-Aufwand** — unabhängig von Tresor-Größe (~ms statt potenziell minutenlanges Re-Encrypt mehrerer GB).
- **Sauberer Recovery-Flow** — Passphrase ist ein zweiter Wrap, kein zweiter Master-Key. Recovery-Codes funktionieren als unabhängige Backup-Channels.
- **Wrong-Secret-Detection ohne Verifier-Leak** — Angreifer hat keinen kostenlosen Orakel.
- **Erweiterbar auf N Recovery-Wraps** — wenn später z.B. eine YubiKey-Integration kommt, wird ein dritter Wrap-Eintrag in `recoveryEntries` hinzugefügt. Keine Schema-Änderung.

**Negativ**

- **DEK-Rotation nicht möglich** ohne kompletten Re-Encrypt. Akzeptiert für Single-User-Lokal-App.
- **Vault-Korruption ist fatal** — geht `loklm.vault` verloren oder werden die Header-Bytes überschrieben, ist der Tresor ein Brick (auch mit korrekter Passphrase). Mitigation: die Vault ist die einzige zu sichernde Datei, Backup-Strategie wird in [PH] §X separat festgelegt.
- **Magic-Byte-Versionierung manuell** — `LOKLM04\0` muss jedes Mal bumpen, wenn das Wire-Format der Vault bricht. Klare Diagnostik (kein "korrupte Datei" für ein altes Format), aber Migration-Pfade müssen je Bump bewusst geschrieben werden.
- **Komplexer als Single-Layer** — mehr Code-Pfade in `AuthService`, mehr Tests, mehr Audit-Surface. Konzeptuell aber das Pattern, das jedes Production-Vault-System verwendet — Abweichung wäre die teurere Wahl.

## Open Questions

- Sollen wir einen **Header-MAC** über den JSON-Header einführen (HMAC-SHA256 des Header-Bytes unter dem KEK_pw oder als AES-GCM-AAD beim Body-Encrypt)? Tamper-Detection auf den Header-Teil, nicht nur den Body. Aktuell nicht — Header-Inhalt zu manipulieren bewirkt schlimmstenfalls einen GCM-Unwrap-Fehlschlag, der korrekt als "bad password" gemeldet wird; den Body-Nonce/Tag-Bereich zu manipulieren scheitert am Body-Auth-Tag.
- **Snapshot-Splitting** — wenn der Tresor > 1 GB wird, ist Single-File-Replace bei jedem Lock teuer. Erst dann adressieren (z.B. inkrementelle WAL-Verschlüsselung).
- **Vault-Backup-UX** — der Single-File-Approach erfordert eine sichere Export/Import-UI im Settings-Pane, damit Anwender die Vault auf externe Medien sichern können. Spec separat.
