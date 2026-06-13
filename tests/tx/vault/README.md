# Transaktionale Vault-Tests

Diese Ebene prüft den vollständigen Vault-Round-Trip: register → in-memory-DB
befüllen → `lock()` schreibt die verschlüsselte Snapshot-Datei → neuer
`AuthService` liest sie wieder ein → `login()` entschlüsselt den DEK → DB-Daten
sind wieder da.

Der Name "transaktional" kommt aus dem Pflichtenheft. Gemeint ist: jeder Test
ist ein abgeschlossenes Round-Trip-Geschäft, das danach garantiert keinen Zustand
auf dem Filesystem hinterlässt.

## Warum getrennt vom integration-layer

Integrationstests fahren Logik durch, lassen den vault aber idealerweise gar
nicht erst auf Disk. Diese Ebene macht genau das _absichtlich_:

- `loklm.vault` wird tatsächlich geschrieben und gelesen.
- AES-GCM-Header/Body werden durch die Pipeline gejagt.
- Re-Konstruktion mit einem _neuen_ `AuthService` simuliert App-Neustart.

Das ist langsam (mehrere argon2-Derivationen pro Test) und IO-lastig, gehört
also nicht in den schnellen integration-layer.

## Konventionen

- Jeder Test bekommt sein eigenes tmp-userData-Verzeichnis und räumt es in
  `afterEach` weg.
- Kein gemeinsamer State zwischen Tests.
- Argon2-Cost bleibt produktionsidentisch (64 MiB, 3 Iterations) — sonst testen
  wir was anderes als die echte App.

## Beispiel

[`round-trip.test.ts`](./round-trip.test.ts) deckt den happy-path ab: register
mit DE-Wortliste, lock, neuer AuthService, login mit Passwort, status zeigt
"unlocked" und der gleiche displayName.

[`crash-resilience.test.ts`](./crash-resilience.test.ts) deckt die
Korruptions-Fälle ab: `loklm.vault.bak` wird als Byte-Kopie geschrieben,
gelöschte oder korrupte Primary fällt auf die .bak zurück (inkl. self-heal beim
nächsten persist), beide kaputt → sauberer Fehler, und ein Passwort-Wechsel
erneuert die .bak mit (altes Passwort öffnet auch den Fallback nicht).

Vorlagen für weitere Tests:

- Version-Bump: alte v3-Datei einlesen sollte sauber fehlschlagen (sobald wir
  v5 oder höher haben).
