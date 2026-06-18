# Kurzfassung

LokLM ist ein **lokaler KI-Wissensassistent mit Quellenverifikation** — eine offline
lauffähige Desktop-Anwendung (Electron), mit der Benutzer eigene Dokumente (PDF, Markdown,
Text, Quellcode, optional DOCX) importieren, in Arbeitsbereichen organisieren und über eine
Chat-Oberfläche befragen können. Jede Antwort enthält klickbare Quellenverweise auf die
zugrundeliegenden Textstellen; findet sich kein passender Beleg, verweigert das System
ehrlich die Antwort, statt zu erfinden (*Refusal*). Der Standardbetrieb läuft vollständig
lokal (lokales Sprachmodell und In-Prozess-Datenbank); eine Internetverbindung ist nur
einmalig für Installation und ersten Modell-Download erforderlich.

Das Projekt verbindet eine hybride *Retrieval-Augmented-Generation*-Pipeline (lexikalische
Suche und Vektorsuche, fusioniert per Reciprocal Rank Fusion, mit Reranking und
Query-Routing) mit einem verschlüsselten lokalen Datentresor (Argon2id-Schlüsselableitung,
AES-256-GCM-Envelope-Verschlüsselung). Eine eigene Evaluierungs-Säule misst Retrieval- und
Antwortqualität über eine kartesische Matrix aus Embedder, Reranker, Chunker und
Sprachmodell.

Dieses Handbuch dokumentiert Auftrag, Architektur, Umsetzung, Test-/Evaluierungsstand sowie
die Projektorganisation und macht Entscheidungen nachvollziehbar.

> WARN zu verifizieren: Die gemessenen Zielwerte (Recall@K, Citation-Genauigkeit,
> Refusal-Quote) und die finale Matrix-Auswertung folgen nach Abschluss des
> AP-E.2-GPU-Sweeps; bis dahin bleibt die Kurzfassung ohne Ergebniszahlen.

> WARN durch Team zu ergaenzen: Optionale englische Fassung (*Abstract*) für die gebundene
> Version, falls gewünscht.
