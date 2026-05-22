# LokLM Datenbank , Normalisierungs-Entscheidungen

Stand: Migration `0006_partial_3nf` (2026-05-22)

Dieses Dokument erklärt , welche Normalisierungs-Verletzungen wir aufgelöst
haben , welche wir bewusst behalten , und für jeden Einzelfall den Grund. Es
ist die schriftliche Verteidigung des Schemas für die akademische Abgabe und
zugleich die Entscheidungs-Aktennotiz für Wartungsentscheidungen.

## Kernaussage

> Das Schema befindet sich in **BCNF modulo kontrollierter Denormalisierung**.
> Migration 0006 hat alle Normalisierungs-Verletzungen aufgelöst , deren
> Eliminierung _keine_ funktionale oder semantische Regression produziert.
> Die verbleibenden Verletzungen sind drei klar benannten Patterns aus der
> DB-Literatur zuzuordnen , jede mit nachweisbarem Grund und Integritäts-Schutz.

## Was Migration 0006 ändert

Drei Änderungen , alle Tier-1 (frei von echten Tradeoffs):

### 1. `chunks.text_search` , Spalte → Expression-Index

| vorher                                                                                      | nachher                                                                                                                          |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Stored `tsvector`-Spalte , gepflegt von `BEFORE`-Trigger `chunks_tsv_biu` aus `chunks.text` | Spalte entfernt , Trigger entfernt , GIN-Index direkt auf der `tsvector`-Expression                                              |
| GIN-Index `idx_chunks_fts` auf der Spalte                                                   | GIN-Index `idx_chunks_fts` auf `(setweight(to_tsvector('german', text), 'A') \|\| setweight(to_tsvector('english', text), 'B'))` |
| 3NF-Verletzung (derivative Spalte)                                                          | 3NF-konform                                                                                                                      |

**Tradeoff , ehrlich:** `ts_rank_cd` braucht den `tsvector`-Wert für die
Bewertung der getroffenen Zeilen. Da die Spalte weg ist , wird er pro Treffer
zur Abfragezeit neu berechnet. Für eine typische Suche mit 10-100 Treffern und
~0,5 ms `tsvector`-Compute pro Chunk sind das **5-50 ms Mehrkosten pro
Anfrage**. Search ist nicht so frequent (Nutzerinneneingaben im Chat) , dass
das spürbar wäre , und die saubere Eliminierung der Trigger-gepflegten Spalte
ist die Investition wert.

**Was bleibt schneller:** Filter (`WHERE … @@ qq.query`) nutzt den Index
identisch , weil Postgres `idx_chunks_fts` auf derselben Expression matcht
wie die `WHERE`-Klausel.

### 2. `workspaces.sync_folders` , jsonb-Array → eigene Tabelle

| vorher                                    | nachher                                                               |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `workspaces.sync_folders jsonb<string[]>` | Tabelle `workspace_sync_folders (workspace_id , path)` , Composite-PK |
| 1NF-Verletzung (nicht-atomares Array)     | 1NF-konform                                                           |
| `setSyncFolders` als jsonb-Overwrite      | `DELETE + INSERT` Sequenz                                             |

**Tradeoff , ehrlich:** Keiner. Read-Frequenz ist einmal pro Workspace-Open
(Watcher-Attach). Die paar zusätzlichen Datenbank-Roundtrips sind in PGlite
(in-process WASM) sub-millisekunde. `setSyncFolders` ist transaktional
äquivalent zur alten jsonb-Overwrite-Operation.

### 3. `citations.document_id` , Spalte → JOIN auf `chunks.document_id`

| vorher                                                                                | nachher                                    |
| ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `citations.document_id` als FK auf `documents.id` , redundant zu `chunks.document_id` | Spalte entfernt , Read-Path JOINt `chunks` |
| 3NF-Verletzung (transitive Abhängigkeit)                                              | 3NF-konform                                |

**Tradeoff , ehrlich:** Im `getWithMessages`-Pfad einer Konversation gibt es
einen zusätzlichen JOIN über `chunks` für die Citation-Liste. Citations werden
typisch 5-10 pro Assistant-Turn produziert , der zusätzliche JOIN ist in PGlite
nicht messbar (`idx_citations_chunk` + `chunks.id` PK , beide sub-ms).

**Sicherheits-Anmerkung:** `PersistCitationInput` behält das `doc_id`-Feld
auf der Input-Seite , weil das Streaming-Event (`{type:'citation', doc_id,
chunk_id, score}`) es natürlicherweise emittiert. Das Feld wird beim Persist
nicht mehr in die DB geschrieben , das ist im `persistCitations`-Body
dokumentiert.

## Was wir _nicht_ normalisiert haben , und warum

Drei Klassen verbleibender Verletzungen , jede mit benannter Begründung:

### Klasse A , Materialisierte derivative Attribute

| Spalte                  | Funktional abhängig von                               | Warum behalten                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents.chunk_count` | `COUNT(*) FROM chunks WHERE document_id = id`         | Library-Liste lädt N≈hunderte Docs pro Render. Statement-Trigger (`counter_statement`, Mig 0003) pflegt den Wert atomar. View-basierter Ersatz wäre messbar langsamer. |
| `documents.token_count` | `SUM(token_count) FROM chunks WHERE document_id = id` | Gleicher Zugriffspfad , selber Trigger , selbe Begründung.                                                                                                             |
| `chunks.embedding`      | `BGE-M3(text)` , neuronales Modell                    | Re-Berechnung kostet 30+ Minuten pro Buch. Diese Spalte _ist_ der Cache , der RAG-Performance definiert. Nicht VIEW-bar.                                               |
| `quiz_attempts.score`   | `COUNT(*) FILTER (WHERE correct) FROM answers`        | Wird in derselben Transaktion wie `answers` per `UPDATE` gesetzt (`finishAttempt`). Single-writer , kein Drift-Zeitfenster.                                            |

**Pattern aus der Literatur:** _Materialized Derived Attribute_ (Kimball)
bzw. _Pre-aggregated Fact_. Integrität durch Statement-Trigger oder
Single-Transaction-Write garantiert.

### Klasse B , Bewusst behalten (Tier 2)

| Spalte                                     | Pattern                             | Warum behalten                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quiz_questions.options` (jsonb<string[]>) | „Werte-Vektor ohne eigenes Leben"   | Optionen existieren nur als Bestandteil ihrer Frage. Auflösung in eine Optionen-Tabelle wäre theoretisch sauberer , bringt aber 1-2 extra Zeilen Repo-Code für jeden Insert/List ohne semantischen Gewinn. Bewusster Punkt gegen Über-Normalisierung. |
| `chunks.heading_path` (jsonb<string[]>)    | „Strukturelles Attribut des Chunks" | Hierarchischer Breadcrumb des Chunks selbst , kein eigenständiges Entity-Konzept. Wird einmal beim Indexieren gesetzt und nie geändert.                                                                                                               |

### Klasse C , Snapshot-Arrays (semantik-tragend)

| Spalte                                       | Snapshot-Beziehung       | Warum brücke wäre falsch                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations.active_document_ids` (int[])  | Konversation ↔ Dokumente | Brücken-Tabelle + `ON DELETE CASCADE` würde den historischen Fokus-Zustand zerstören , wenn der User später eine Quelle löscht. Citation-Chip kann nicht mehr graceful zu „Quelle nicht mehr verfügbar" degradieren. |
| `quiz_decks.document_ids` (int[])            | Deck ↔ Quell-Dokumente   | Deck soll Doc-Delete überleben , damit der Nutzer das Quiz auch nach Aufräumen der PDFs noch spielen kann. Fachliche Anforderung aus dem Lastenheft.                                                                 |
| `quiz_questions.source_chunk_ids` (int[])    | Frage ↔ Beweis-Chunks    | Frage muss Chunk-Delete überleben (Stem + Antwort + Erklärung bleiben gültig , nur der Beweis-Link degradiert).                                                                                                      |
| `quiz_attempts.answers` (jsonb-Objekt-Array) | Attempt → Antworten      | Attempt-Historie soll Question-Regenerate überleben. Brücken-Tabelle würde durch CASCADE die Versuchs-Geschichte zerstören , wenn der User das Deck regeneriert.                                                     |

**Pattern aus der Literatur:** _Immutable Snapshot_ / _Temporal Snapshot_
(Date , _Temporal Data and the Relational Model_). Aus ERM-Sicht streng
genommen die _theoretisch korrekte_ Modellierung für historische
Tatsachen , nicht die denormalisierte Notlösung. Brücken-Tabellen
modellieren live mitlaufende Beziehungen , Snapshots modellieren
eingefrorene Vergangenheits-Zustände.

## Integritäts-Garantien der verbleibenden Verletzungen

Update-Anomalien sind das eigentliche Risiko von Denormalisierung. Für jede
verbliebene Verletzung lässt sich nachweisen , warum sie konstruktiv unmöglich
ist:

| Spalte                                  | Mögliche Anomalie                             | Warum sie nicht eintreten kann                                                                                                                   |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `documents.chunk_count` / `token_count` | INSERT/DELETE auf `chunks` ohne Zähler-Update | Statement-Trigger `chunks_count_aii_stmt` / `chunks_count_aid_stmt` (Mig 0003) feuern garantiert im selben Statement-Scope. Nicht überspringbar. |
| `chunks.embedding`                      | UPDATE auf `chunks.text` ohne Re-Embed        | `chunks` sind nach Insert immutable im App-Code. `embedder_identity` markiert die Provenienz , der Backfill-Job räumt Identitäts-Mismatches auf. |
| `quiz_attempts.score`                   | UPDATE `answers` ohne Score-Recompute         | Beide werden in einem einzigen SQL-`UPDATE` in derselben Transaktion geschrieben (`finishAttempt`). Kein Zeitfenster.                            |
| jsonb-Snapshots                         | „Drift" gegenüber dem Original                | Per Definition gewollt. Der Snapshot soll _nicht_ mitlaufen — das ist das Feature , nicht der Bug.                                               |

## Was eine _strikt theorie-reine_ 3NF-Variante kosten würde

Wir haben die vollständige 3NF-Normalisierung intern durchgerechnet , aber
gegen die Umsetzung entschieden:

| Operation                              | Aktueller Pfad                                        | Strikt-3NF-Pfad                                                   | Folge                                                         |
| -------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- |
| Library-Liste (autorefresh)            | direkter Spalten-Read                                 | `JOIN v_document_stats`, `GROUP BY`                               | ca. 15-30× langsamer auf >100 Docs                            |
| `documents.chunk_count` nullen         | Trigger , atomic                                      | View , recompute pro Read                                         | unverändert auf Read-Pfad teurer                              |
| Citation-Render mit Doc-Titel          | JOIN über `chunks` _oder_ (alt) direkter Spalten-Read | erzwungener JOIN über `chunks`                                    | Im aktuellen Pfad nach Mig 0006 ohnehin so. Kein Unterschied. |
| Conversation/Quiz-Deck nach Doc-Delete | Snapshot bleibt , Chip degradiert                     | CASCADE löscht aus Brücken-Tabelle , Fokus-Zustand weg            | **UX-Anforderung gebrochen**                                  |
| Quiz-Frage nach Chunk-Delete           | Snapshot bleibt , Quelle nicht klickbar               | CASCADE löscht aus Brücken-Tabelle , Frage verliert Evidence-Link | **UX-Anforderung gebrochen**                                  |
| Quiz-Attempt nach Question-Regenerate  | Snapshot bleibt , Versuch lesbar                      | CASCADE löscht aus Brücken-Tabelle , Versuch verschwindet         | **Datenverlust**                                              |

Strikt-3NF rettet _keine_ Integrität (wir haben keine zu retten , siehe
Integritäts-Garantien oben) und zerstört semantische Anforderungen aus dem
Lastenheft. Daher die Tier-1-Selektion , nicht die Vollnormalisierung.

## Wie wir das im Prüfungsgespräch formulieren

> Das Schema ist in **BCNF modulo kontrollierter Denormalisierung**.
> Migration 0006 hat alle Verletzungen aufgelöst , deren Eliminierung
> kosten- und semantik-neutral war , konkret:
>
> - `chunks.text_search` durch einen Expression-Index (eliminiert Spalte +
>   Trigger),
> - `workspaces.sync_folders` durch eine Brücken-Tabelle (1NF-rein),
> - `citations.document_id` durch einen JOIN über `chunks` (transitive
>   Abhängigkeit aufgelöst).
>
> Die verbleibenden vier transitiven Attribute (`chunk_count` ,
> `token_count` , `embedding` , `score`) sind materialisierte deterministische
> Funktionen des Primärschlüssel-Zustands , Statement-atomar gepflegt , und
> ihre Eliminierung würde messbare Performance-Regression _ohne_
> Integritäts-Gewinn produzieren. Die vier verbleibenden jsonb-Snapshot-Arrays
> modellieren immutable historische Tatsachen , deren Auflösung in
> Brücken-Tabellen die fachliche Snapshot-Semantik aus dem Lastenheft
> verletzen würde.

## Referenzen

- Migration: `src/main/db/migrations/0006_partial_3nf.sql`
- Schema: `src/main/db/schema.ts`
- Repo-Konsumenten: `src/main/db/database.ts` (`searchChunks` , `WorkspacesRepo` , `ConversationsRepo`)
- Counter-Trigger (Mig 0003): `src/main/db/migrations/0003_chunks_counter_statement.sql`
- Tests: `tests/tx/db/schema-objects.test.ts` (Expression-Index-Verifikation)
