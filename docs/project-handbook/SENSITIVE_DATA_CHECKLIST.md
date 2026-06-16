# SENSITIVE_DATA_CHECKLIST

Checkliste zur Prüfung sensibler Daten im Projekthandbuch (`docs/project-handbook/`).
Stand: **2026-06-14**. Ziel: sicherstellen, dass das Handbuch **keine** echten Secrets,
Tokens, privaten Adressen oder personenbezogenen Daten enthält und alle solchen Inhalte
durch Platzhalter ersetzt sind, bevor das Handbuch exportiert/gebunden/geteilt wird.

## Platzhalter-Konvention

| Original                                                 | Platzhalter                          |
| -------------------------------------------------------- | ------------------------------------ |
| RunPod-/AWS-/S3-Schlüssel und Tokens                     | `<API_KEY>` / `<S3_KEY>` / `<TOKEN>` |
| Interne Dienst-Domains (Outline, Vikunja, MinIO, RunPod) | `<PRIVATE_DOMAIN>`                   |
| Persönliche E-Mail-Adressen                              | `<EMAIL>`                            |
| Absolute lokale Pfade mit Benutzernamen                  | `<INTERNAL_PATH>`                    |

Kurze repo-relative Pfade (`src/main/services/`, `tests/evals/`) sind erlaubt und
erwünscht — sie sind nicht sensibel und dienen der Nachvollziehbarkeit.

## Checkliste

| #   | Kategorie                      | Status                                  | Befund                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Secrets / API-Keys (Werte)** | geprüft — sauber                        | Keine echten Schlüsselwerte im Handbuch. Schlüssel werden ausschließlich als `<API_KEY>`/`<S3_KEY>`/`<TOKEN>` benannt (Kap. 20, 21, 28).                                                                                                                                                       |
| 2   | **Tokens (Werte)**             | geprüft — sauber                        | Keine Bearer-/Auth-Token-Werte. `OLLAMA_BEARER_TOKEN` wird nur als **Variablenname** im `.env.example`-Schema genannt (Kap. 21), ohne Wert.                                                                                                                                                    |
| 3   | **Env-Variablen-Namen**        | geprüft — bewusst dokumentiert          | `RUNPOD_API_KEY`, `RUNPOD_POD_ID`, `ANTHROPIC_API_KEY`, `OLLAMA_BASE_URL` u. a. erscheinen als **Namen** (nicht Werte) in der `.env.example`-Schema-Tabelle (Kap. 21). Das ist Doku der erwarteten Variablen, kein Leak — siehe Sweep-Befund unten.                                            |
| 4   | **Private IPs**                | geprüft — sauber                        | Keine IP-Adressen (öffentlich oder privat) im Handbuch.                                                                                                                                                                                                                                        |
| 5   | **Interne Domains**            | geprüft — 1 Fund **2026-06-16 behoben** | Outline/Vikunja/MinIO/RunPod als `<PRIVATE_DOMAIN>` maskiert. **2026-06-16:** eine unmaskierte MinIO-Domain (`s3.ltwodl.com`, Kap. 09 Release-Assets) entdeckt und auf `<PRIVATE_DOMAIN>` korrigiert. Sonst keine echte interne Domain im Text.                                                |
| 6   | **Personenbezogene Daten**     | geprüft — bewusst                       | Es erscheinen die Klarnamen der zwei Teammitglieder (Denys Tudosa, Dominik Furlan) und des Betreuers (Christoph Wirrer) — das ist in Autorenschaft/Pflichtenheft **gewollt** und bleibt. Keine E-Mail-Adressen, Telefonnummern oder Schüler-/Drittpersonen-Daten.                              |
| 7   | **E-Mail-Adressen**            | geprüft — sauber                        | Keine E-Mail-Adresse im Handbuch (insbesondere keine persönliche oder Schul-/Projekt-Adresse `<EMAIL>`).                                                                                                                                                                                       |
| 8   | **Diagramme / Bilder**         | geprüft — sauber (2026-06-16)           | `assets/` enthält **17 gerenderte Mermaid-SVG** (+ `.mmd`-Quellen); deren Text (AP-Namen, Daten, Service-Bezeichnungen) wurde gesweept — keine Secrets/absoluten Pfade/internen Domains. Keine Foto-Screenshots vorhanden. Vor künftigen Screenshots: auf sichtbare Pfade/Tokens/Namen prüfen. |
| 9   | **Logs**                       | geprüft — sauber                        | Keine eingebetteten Log-Auszüge mit Pfaden/Tokens. Test-Nachweise sind als kurze Ergebniszitate (z. B. „1 passed") wiedergegeben, ohne sensible Pfade.                                                                                                                                         |
| 10  | **Dataset-Pfade**              | geprüft — repo-relativ                  | Nur repo-relative Pfade (`tests/evals/data/…`). LAP-Korpus/Fragen sind als gitignored gekennzeichnet; keine absoluten lokalen Pfade.                                                                                                                                                           |
| 11  | **Modellpfade**                | geprüft — repo-relativ                  | Modelle als repo-relative/`/models/`-Cache-Pfade und HuggingFace-`resolve/main`-URLs benannt (Kap. 20). Keine absoluten Benutzer-Pfade.                                                                                                                                                        |
| 12  | **Absolute lokale Pfade**      | geprüft — sauber                        | Keine `C:\Users\…`-Pfade im Handbuch-Inhalt. (Der Worktree-Pfad `.claude/worktrees/dom-doku/` ist repo-relativ und unbedenklich.)                                                                                                                                                              |
| 13  | **Export-Verzeichnis**         | geprüft                                 | `docs/project-handbook/export/` und `assets/` sind als Ausgabeziele benannt; vor finalem Export erneut auf Sensitivdaten prüfen (siehe EXPORT_NOTES, finaler Schritt).                                                                                                                         |

## Secret-Sweep-Befund (2026-06-14)

Über **alle** Dateien in `docs/project-handbook/` wurde nach folgenden Mustern gesucht:

```
rpa_   rps_   AWS_SECRET   AWS_ACCESS   <interne Domain>   RUNPOD_   <AWS-Key-Fragment>   <E-Mail>
```

**Ergebnis:**

| Muster                              | Treffer | Bewertung                                                                                                                                                                                                    | Korrektur   |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| `rpa_`                              | 0       | —                                                                                                                                                                                                            | —           |
| `rps_`                              | 0       | —                                                                                                                                                                                                            | —           |
| `AWS_SECRET`                        | 0       | —                                                                                                                                                                                                            | —           |
| `AWS_ACCESS`                        | 0       | —                                                                                                                                                                                                            | —           |
| interne Domain (`<PRIVATE_DOMAIN>`) | 0       | —                                                                                                                                                                                                            | —           |
| `RUNPOD_`                           | 1       | **Platzhalter/Schema** — Treffer in `21_security_privacy_and_sensitive_data.md` Zeile 51: die **Variablennamen** `RUNPOD_API_KEY`, `RUNPOD_POD_ID` in der `.env.example`-Schema-Tabelle. Kein Schlüsselwert. | keine nötig |
| AWS-/S3-Key-Präfix (`<S3_KEY>`)     | 0       | —                                                                                                                                                                                                            | —           |
| Schul-/Projekt-E-Mail (`<EMAIL>`)   | 0       | —                                                                                                                                                                                                            | —           |
| E-Mail (`<EMAIL>`)                  | 0       | —                                                                                                                                                                                                            | —           |

**Zusammenfassung:** 1 Mustertreffer insgesamt, **0 echte Secrets**, **0 Korrekturen
durchgeführt**. Der einzige Treffer (`RUNPOD_`) ist ein Variablen**name** in der
Dokumentation des `.env.example`-Schemas, kein geheimer Wert; eine Ersetzung würde die
Doku verfälschen und ist daher bewusst unterblieben. Das Handbuch ist secret-frei.

**Nachtrag-Sweep 2026-06-16** (inkl. `assets/` mit 17 neuen Diagrammen sowie der neuen Kapitel §1.7, §7.6, §8.6–8.9, §24.3, §28.6): **1 echter Befund** — unmaskierte MinIO-Domain `s3.ltwodl.com` in Kap. 09 (Release-Assets) → auf `<PRIVATE_DOMAIN>` korrigiert. Secret-Präfixe (`rpa_`/`rps_`/`sk-ant-`/`AKIA`), E-Mail-Adressen, absolute lokale Pfade: **0 Treffer**. Danach wieder secret-frei.

## WICHTIG: Live-Keys in lokaler `.env` (außerhalb des Handbuchs)

> **Hinweis (dokumentiert, kein Handbuch-Inhalt):** In der lokalen, **gitignoreten**
> `.env` liegen **Live-Schlüssel** (RunPod-, AWS-/S3-, Anthropic-Keys, ggf.
> Ollama-Bearer-Token). Diese sind **nicht** auf GitHub und **nicht** im Handbuch —
> aber sie existieren auf der Arbeitsmaschine.
>
> - Eine **Rotation der Live-Keys wird empfohlen**, bevor das Repo öffentlich breiter
>   geteilt wird (Risiko R9). Siehe auch [22_risks_problems_and_mitigations.md](22_risks_problems_and_mitigations.md).
> - Im Handbuch werden diese Werte **ausschließlich** als `<API_KEY>` / `<S3_KEY>` /
>   `<TOKEN>` genannt — niemals mit echten Werten.
> - Die `.env`-Verschleierung ist über `.gitignore` (`.env`, `.env.*` außer
>   `.env.example`) abgesichert; `.env.example` enthält nur Platzhalter.
> - Ebenfalls gitignored und mit lokalen Zugangsdaten/Recovery-Phrasen: `test-notes/`,
>   `docs/work/`, `docs/abgabe/`, `tests/evals/ANLEITUNG-DOMINIK.md`.

## Finaler Prüfschritt vor Export/Bindung

Vor jedem Export (PDF/Buch) erneut ausführen:

1. Secret-Sweep wiederholen (obige Muster) über `docs/project-handbook/` **inkl.**
   `assets/` (neue Screenshots/Diagramme).
2. Bei künftig eingefügten Bildern: auf sichtbare Pfade, Tokens, E-Mail-Adressen,
   Drittpersonen-Daten prüfen.
3. Bestätigen, dass alle `<API_KEY>`/`<PRIVATE_DOMAIN>`/`<EMAIL>`/`<INTERNAL_PATH>`-
   Platzhalter unverändert sind und kein echter Wert eingeflossen ist.
