# ADR-0001 — Argon2id as the password / passphrase KDF

**Status:** accepted
**Datum:** 2026-05-14
**Owner:** Denys
**Bezug:** [PH] Pflichtenheft §3.1.1 (Passwortspeicherung), §3.1.3 (Recovery), AP-2.1 (Auth)
**Implementierung:** [src/main/services/auth/AuthService.ts:54-61](../../src/main/services/auth/AuthService.ts#L54-L61), [src/main/services/auth/AuthService.ts:516-520](../../src/main/services/auth/AuthService.ts#L516-L520)

## Libraries

Konkrete Pakete aus [package.json](../../package.json), die diese Entscheidung tragen:

| Paket                        | Version   | Rolle                                                                                                                                    |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `argon2`                     | `^0.44.0` | Node-Bindings zu **libargon2** (Referenz-Implementierung der PHC-Gewinner). Liefert `argon2.argon2id` und `raw: true`-Output.            |
| `@electron/rebuild`          | `^3.7.1`  | Rebuildet `argon2`s Native-Binary gegen Electrons Node-ABI. Läuft via `postinstall`-Hook (`electron-rebuild -f -w argon2`).              |
| `electron`                   | `^42.0.0` | Definiert die Node-ABI, gegen die `argon2` gebaut werden muss. Bump → `electron-rebuild` erneut ausführen.                               |
| `node:crypto` (stdlib)       | Node ≥ 20 | `randomBytes(32)` für KEK-Salts und den Recovery-Passphrase-Entropy-Pool ([src/shared/authHelpers.ts](../../src/shared/authHelpers.ts)). |
| `pnpm.onlyBuiltDependencies` | n/a       | In [package.json](../../package.json) gelistet, damit pnpm den Native-Build von `argon2` nicht silently überspringt.                     |

Keine direkten Konkurrenz-Pakete (`bcrypt`, `node-argon2-ffi`, `scrypt-js`, …) sind installiert — falls die je auftauchen, ist das ein Hinweis auf einen Verstoß gegen diesen ADR.

---

## Context

LokLM ist eine rein lokale Single-User-Desktop-App. Aus zwei Geheimnissen — einem vom Benutzer gewählten Passwort und einem 18-Wort-Recovery-Passphrase — muss je ein symmetrischer Key abgeleitet werden, mit dem der **Data Encryption Key (DEK)** des Snapshots gewrappt wird (siehe [ADR-0002](0002-envelope-encryption-aes-gcm.md)).

Anforderungen an die KDF:

1. **Resistenz gegen Offline-Brute-Force**: `auth.json` liegt unverschlüsselt auf der Platte. Ein Angreifer mit Festplattenzugriff kann beliebig viele Kandidaten gegen den GCM-Tag testen. Die KDF muss jeden einzelnen Versuch teuer machen.
2. **Resistenz gegen GPU-/ASIC-Beschleunigung**: Klassische Hash-Iterationen (PBKDF2, bcrypt) sind speicherarm und auf spezialisierter Hardware um Größenordnungen billiger als auf der CPU des Angreifers.
3. **Standardisiert, auditiert, nicht-experimentell**: Selbstgebaute Konstruktionen sind ein Risiko. Die KDF muss als Standard etabliert sein.
4. **Tunbare Parameter** (`memoryCost`, `timeCost`, `parallelism`), um auf zukünftige Hardware reagieren zu können, ohne den Algorithmus zu wechseln.
5. **Verfügbar als wartungsaktives Node-Modul** mit nativen Bindings (`argon2` npm-Paket).

## Decision

**Argon2id** als KDF, mit folgenden Parametern:

```ts
// src/main/services/auth/AuthService.ts:54
const ARGON_OPTS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3, // 3 Passes
  parallelism: 4,
  hashLength: 32, // 32 Bytes Raw-Output = AES-256-Key
  raw: true,
}
```

Salt: 32 zufällige Bytes pro Geheimnis (Passwort + jeder Recovery-Eintrag), gespeichert in `auth.json`.

Das Raw-Output **ist** der KEK — kein separater Verifier-Hash. Falsche Passworteingabe wird über den AES-GCM-Auth-Tag-Check beim Unwrap des DEK erkannt (Konstruktion vgl. [ADR-0002](0002-envelope-encryption-aes-gcm.md)).

### Warum Argon2id

- **PHC-Gewinner** (Password Hashing Competition, 2015) und **RFC 9106** (2021). Algorithmus existiert seit über 10 Jahren in Produktion.
- **Argon2id** kombiniert die Eigenschaften der zwei Varianten: die ersten Passes laufen daten-unabhängig (Argon2i — Side-Channel-resistent), die folgenden daten-abhängig (Argon2d — GPU-resistent). RFC 9106 §4 empfiehlt **explizit Argon2id** als Default, wenn keine zwingenden Gründe für eine reine Variante vorliegen.
- **OWASP Password Storage Cheat Sheet** (aktuell zum Stand 2026-05) listet Argon2id als bevorzugte Wahl, gefolgt von scrypt und bcrypt.

### Warum diese Parameter

| Parameter     | Wert     | Begründung                                                                                                                                                                                                  |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memoryCost`  | 64 MiB   | OWASP-Mindestempfehlung für Argon2id mit `t=3`. Erzwingt 64 MiB pro Versuch — eine GPU mit 24 GiB VRAM kann höchstens ~370 Versuche parallel halten, statt zehntausenden bei PBKDF2.                        |
| `timeCost`    | 3 Passes | RFC 9106 §4 Empfehlung für die `m=64 MiB`-Variante. Ergibt auf Desktop-Hardware ~300–500 ms pro Hash — gut bemerkbar für den Benutzer einmal pro Login, prohibitiv für einen Angreifer mit 10⁹+ Kandidaten. |
| `parallelism` | 4 Lanes  | Entspricht dem typischen Desktop-Core-Count und macht den Algorithmus auf den am wahrscheinlichsten verbauten CPUs gut ausgelastet, ohne den schwächsten Lehrlings-Laptop zu blockieren.                    |
| `hashLength`  | 32 Bytes | Genau ein AES-256-Key. Raw-Output kann direkt als KEK verwendet werden, kein zweites HKDF nötig.                                                                                                            |
| Salt          | 32 Bytes | Mehr als ausreichend (≫ 16-Byte-Minimum aus RFC 9106 §3.1). Wird in `auth.json` neben dem gewrappten DEK gespeichert.                                                                                       |

Diese Profile liegen **auf oder über** den Defaults der referenzierten Production-Deployments (siehe unten).

### Wie Production-Systeme das umsetzen

Die Wahl orientiert sich bewusst an etablierten Password-Managern und Secrets-Tools mit ähnlichem Bedrohungsmodell (Offline-Brute-Force gegen ein Vault auf der Disk):

| System                      | KDF                                          | Parameter                                                      | Quelle                                                                               |
| --------------------------- | -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Bitwarden / Vaultwarden** | Argon2id (Default seit 2023.2)               | `m=64 MiB, t=3, p=4`                                           | Bitwarden Security Whitepaper, Sektion "KDFs" (`bitwarden.com/help/kdf-algorithms/`) |
| **1Password**               | Argon2d (in `2SKD` über `PBKDF2-HKDF`)       | Tunable, Vergleichbare Größenordnung                           | 1Password Security Design White Paper, Sektion "Key derivation"                      |
| **Signal Desktop**          | Argon2id (für Local-Database-Key)            | `m=16 MiB, t=32, p=1`                                          | Signal Desktop Source (`Signal-Desktop/ts/sql/Server.ts`, `getArgon2Hash`)           |
| **age (FiloSottile)**       | scrypt (KDF-Recipient `x25519`) — kein Argon | N=2^18 default                                                 | age spec §scrypt                                                                     |
| **Tauri Stronghold**        | Argon2id                                     | `m=4 GiB (!), t=4, p=1` (überdimensioniert für mobile/desktop) | Stronghold-Engine Source                                                             |

LokLM landet exakt auf dem **Bitwarden-Profil**, weil dort das Bedrohungsmodell am dichtesten am unseren liegt: lokal entschlüsselter Tresor, Angreifer hat das verschlüsselte Blob, jeder Versuch muss durch den vollen KDF-Pass.

### Verworfene Alternativen

- **PBKDF2-HMAC-SHA256** — Speicherarm. Mit 600k Iterations (OWASP-Minimum) auf einer Mid-Range-GPU ~10⁶ Versuche/s. Argon2id mit 64 MiB drückt das auf < 100/s/GPU.
- **scrypt** — Speicher-hart und solide, aber Argon2id ist der jüngere PHC-Gewinner und in RFC 9106 explizit empfohlen. Neue Projekte sollten Argon2id wählen; scrypt bleibt für Bestandssysteme akzeptabel.
- **bcrypt** — Auf 72 Byte Eingabe begrenzt, kein Memory-Hardening. Disqualifiziert für ein KEK-Derivat.
- **Eigene Konstruktion (HKDF + Iterations)** — Verstößt gegen Anforderung 3. Nie.

## Consequences

**Positiv**

- Offline-Angriff gegen `auth.json` ist auf Desktop-Hardware ~5–6 Größenordnungen langsamer als gegen einen PBKDF2-geschützten Container vergleichbarer Iteration-Count.
- Recovery-Passphrase + Passwort durchlaufen denselben Pfad — eine KDF-Konfiguration für beide Geheimnisse.
- Raw-Output (`raw: true`) liefert direkt einen AES-256-Key; kein zweites HKDF nötig, kein Verifier-Hash.
- Parameter sind durchgängig auf OWASP-/Bitwarden-Niveau — schließt die häufigste Audit-Findung ("Argon2 mit `m=4 MiB` ist nicht stark genug") proaktiv aus.

**Negativ**

- **Native Bindings:** Das `argon2`-npm-Paket benötigt `electron-rebuild` für Electron-Renderer-/Main-Builds (bereits in `postinstall` verankert, siehe [Skeleton-Spec §Build](../specs/2026-05-13-ap-1-1-project-skeleton-design.md)). Das verkompliziert CI-Caches.
- **Login-Latenz:** Ein vollständiger KDF-Pass kostet auf einem 2020er Mid-Range-Laptop 300–500 ms. Der Benutzer sieht eine spürbare Verzögerung beim Entsperren — Schmerz für den Benutzer ist hier explizites Ziel.
- **Parameter-Migration:** Falls wir später `memoryCost` oder `timeCost` erhöhen, muss die KDF beim nächsten erfolgreichen Login re-derived werden (DEK bleibt gleich, KEK wird neu gewrapped). Aktuell nicht implementiert — wird beim ersten Parameter-Bump in einem Folge-ADR adressiert.
- **RAM-Footprint:** 64 MiB pro paralleler Argon2-Operation. Da Login sequentiell ist und während Login nichts anderes läuft, unkritisch.

## Open Questions

- Sollen wir den `t=3`-Wert anhand einer Hardware-Probe beim ersten Start kalibrieren (vgl. Bitwarden-Iterations-Slider)? Aktuell hartkodiert, einfacher zu auditieren. Re-evaluierung wenn Lehrlings-Hardware sich als zu langsam erweist.
- Re-Hash-on-Login (Parameter-Migration) ist offen — sobald die App in Produktion ist und ein Bump nötig wird.
