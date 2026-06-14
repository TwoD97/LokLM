# Vorwort und Zweck des Dokuments

## 1.1 Zweck des Handbuchs

Dieses Projekthandbuch beschreibt das Projekt **LokLM — Lokaler KI-Wissensassistent mit Quellenverifikation** in seiner Gesamtheit: Auftrag und Ausgangslage, Ziele und Abgrenzung, Architektur und technische Umsetzung, Team und Arbeitspakete sowie den Test- und Evaluierungsstand. Es ergänzt die beiden Vertragsdokumente — **Lastenheft** (`docs/Lastenheft.md`) und **Pflichtenheft** (`docs/Pflichtenheft.md`) — um eine durchgängige, erzählende Darstellung und fasst den realen Umsetzungsstand zusammen, der sich aus dem Quellcode, den Architecture Decision Records (`docs/adr/`), den Feature-Specs (`docs/specs/`) und den wöchentlichen Projektstatusberichten (`docs/work/`) ergibt.

Das Handbuch dient zwei Funktionen:

- **Verständnis:** Es soll einem fachkundigen Leser ermöglichen, das Projekt zu verstehen, ohne den gesamten Quellcode lesen zu müssen.
- **Nachweis:** Es belegt für die Schul-Abgabe, welche Anforderungen umgesetzt, abgewichen oder zurückgestellt wurden, und macht Entscheidungen nachvollziehbar.

## 1.2 Zielgruppe

Tabelle 1.1 fasst die Zielgruppen und ihr jeweiliges Nutzungsinteresse zusammen.

**Tabelle 1.1:** Zielgruppen des Handbuchs und ihr Nutzungsinteresse.

| Zielgruppe                         | Nutzungsinteresse                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Entwickler / Repo-Besucher**     | Einstieg in Architektur, Services, Datenfluss und Build; Orientierung vor dem ersten Code-Beitrag |
| **Prüfer / Projektbetreuung**      | Abgleich von Anforderung (Lasten-/Pflichtenheft) und Umsetzung; Beurteilung des Projektabschlusses |
| **Projektteam**                    | Gemeinsame Referenz für Entscheidungen, Status und offene Punkte; Übergabe-Grundlage              |

## 1.3 Dokumentationsstand

Das Handbuch hat den Stand **2026-06-14** (Handbuch-Version 0.1), entsprechend ca. **9 Wochen Projektarbeit**. Es bezieht sich auf den Release-Stand bis einschließlich **v0.4.1** (Windows-GPU-Translator-Sidecar + Multi-OS-Release-Härtung) und den Branch-Stand der Test-/Eval-Säule (AP-T.1/T.2, AP-E.1/E1b/E.2). Der Pflichtenheft-Stand ist Version 1.1.2 (Nachtrag Sprint-4/5).

Das Handbuch bildet einen **Projektstand**, kein abgeschlossenes Endprodukt ab. Einige Bereiche sind bewusst noch in Arbeit; sie werden im Text klar als solche gekennzeichnet (siehe 1.4).

## 1.4 Umgang mit unfertigen Bereichen

Wo der Umsetzungsstand offen, unklar oder noch nicht belegbar ist, steht im Fließtext genau ein Marker als eigene Blockquote-Zeile, zum Beispiel:

> WARN Status unklar

Solche Marker sind ein **Ehrlichkeits-Instrument**: Sie kennzeichnen, dass eine Aussage durch das Team zu bestätigen oder durch eine Quelle zu belegen ist, statt einen falschen Anschein von Vollständigkeit zu erwecken. Drei Bereiche sind nach aktuellem Stand ausdrücklich noch nicht abgeschlossen:

- **AP-E.2 Phase 2 (GPU-Matrix-Sweep)** ist **offen** — das Dataset (LAP-Korpus, 2.322 Chunks, 163 deutsche Fragen) steht, der eigentliche Embedder × Reranker × Chunker × LLM-Sweep auf GPU und dessen Auswertung für den Abgabe-Laborbericht stehen aber noch aus.
- **AP-T.1, AP-T.2 und AP-E.1** sind umgesetzt, befinden sich aber teils noch in **PR-Review** (AP-T.2 #19, AP-E.1 #25) bzw. auf einem unpushed Branch (AP-T.1).
- Die **Playwright-E2E-Suite** für die Electron-App läuft **nicht in CI** — Playwright kann Electron im Runner nicht starten (`--remote-debugging-port=0`); die Website-E2E-Tests sind davon nicht betroffen.

## 1.5 Umgang mit anonymisierten Daten

Aus Sicherheits- und Datenschutzgründen enthält dieses Handbuch **keine sensiblen Daten**. Folgende Inhalte sind durchgängig durch Platzhalter ersetzt:

| Original                                              | Platzhalter         |
| ----------------------------------------------------- | ------------------- |
| RunPod-/AWS-/S3-Schlüssel und Tokens                  | `<API_KEY>` / `<S3_KEY>` / `<TOKEN>` |
| Interne Dienst-Domains (Outline, Vikunja, MinIO)      | `<PRIVATE_DOMAIN>`  |
| Persönliche E-Mail-Adressen                           | `<EMAIL>`           |
| Absolute lokale Pfade mit Benutzernamen               | `<INTERNAL_PATH>`   |

Kurze, repo-relative Pfade (z. B. `src/main/services/`, `tests/evals/`) sind erlaubt und erwünscht, da sie zur technischen Nachvollziehbarkeit beitragen und keine sensiblen Informationen offenlegen.

## 1.6 Charakter des Dokuments

Das Handbuch ist sachlich und technisch präzise gehalten. Es bevorzugt belegbare Fakten mit Quellenbezug auf konkrete Repository-Dateien. Es bildet den **Projektstand** ab — also eine Momentaufnahme einer laufenden Arbeit — und erhebt nicht den Anspruch, ein fertiges, in jedem Detail finalisiertes Endprodukt zu beschreiben. Die finale, gebundene Fassung folgt zur Schul-Abgabe.
