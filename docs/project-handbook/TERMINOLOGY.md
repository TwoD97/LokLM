# TERMINOLOGY

Verbindliches **Begriffs- und Schreibweisen-Register** für das LokLM-Projekthandbuch.
Es sichert, dass Namen, Versionsbezeichnungen und Fachbegriffe über alle Kapitel hinweg
konsistent bleiben. Wird bei jeder Terminologie-Entscheidung fortgeschrieben
(**Remember-Trigger 2**, siehe [/CLAUDE.md](../../CLAUDE.md)) und dient dem
[v1.0.0-Audit](RELEASE_AUDIT.md) als Konsistenz-Referenz. Stand: **2026-06-14**.

Das ausführliche fachliche Glossar bleibt [27_glossary.md](27_glossary.md); diese Datei
führt nur die **kanonischen Schreibweisen** (was ist richtig, was ist zu vermeiden).

---

## 1. Namen & Personen

| Verbindlich | Nicht verwenden | Beleg / Hinweis |
| --- | --- | --- |
| **Denys Tudosa** (Projekt-Owner) | „Denis", „Denys Tudossa" | Lasten-/Pflichtenheft; Projektstatusberichte nutzen abweichend „Denis" und bleiben so |
| **Dominik Furlan** (Dokumentations-Owner & Tester) | — | `00_cover.md` |
| **Christoph Wirrer** (Betreuer) | — | Lastenheft/Pflichtenheft |
| **Landesberufsschule 4 Salzburg** | „LBS4" im Fließtext ausschreiben (Kürzel nur nach Einführung) | Auftraggeber |

## 2. Produkt & Projekt

| Verbindlich | Nicht verwenden | Hinweis |
| --- | --- | --- |
| **LokLM** | „LokLLM", „Lok-LM" | Projekt-/Produktname |
| **Lokaler KI-Wissensassistent mit Quellenverifikation** | — | offizieller Untertitel |

## 3. Versionen

| Verbindlich | Hinweis |
| --- | --- |
| **Handbuch-Version 0.1** | aktueller Handbuch-Stand (mitwachsend → v1.0.0) |
| **Release bis einschließlich v0.4.1** | höchster **Git-Tag** |
| **v0.4.2 = Release-Commit `783ca4b`** | **kein Git-Tag** — als Commit referenzieren, nicht als Tag |
| Format **vMAJOR.MINOR.PATCH** | SemVer; Versionsangaben mit führendem `v` |

## 4. Fachbegriffe (Schreibweise)

| Verbindlich | Nicht verwenden | Hinweis |
| --- | --- | --- |
| **IPC** (Inter-Process Communication) | „ipc", „I.P.C." | bei Ersterwähnung ausschreiben |
| **RAG** (Retrieval-Augmented Generation) | „Rag" | siehe Glossar |
| **BGE-M3** | „bge-m3", „BGE M3" | produktiver Embedder |
| **PGlite** | „pglite", „PgLite" | In-Prozess-PostgreSQL (WASM) |
| **pgvector** | „PGVector" | Kleinschreibung wie vom Projekt |
| **RRF** (Reciprocal Rank Fusion) | — | siehe Glossar |
| **Argon2id** | „argon2id", „Argon2ID" | KDF, ADR-0001 |
| **AES-256-GCM** | „AES256GCM" | ADR-0002 |
| **ADR** (Architecture Decision Record) | — | `docs/adr/` |
| **AP** (Arbeitspaket) | — | z. B. AP-E.2, AP-T.1 (Punkt-Notation) |

## 5. Englische Fachbegriffe

Bei Ersterwähnung *kursiv* setzen (z. B. *Embedding*, *Sweep*, *Chunk*, *Refusal*), danach
einheitlich ohne Auszeichnung. Etablierte Akronyme (RAG, IPC, RRF) werden nicht kursiv
gesetzt.

---

> WARN durch Team zu ergaenzen: Weitere verbindliche Schreibweisen (z. B. konkrete
> Modell-Tier-Namen) hier ergänzen, sobald festgelegt.
