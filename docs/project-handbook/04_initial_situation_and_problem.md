# Ausgangslage und Problemstellung

## 4.1 Ausgangslage vor Projektbeginn

Wissen liegt heute verteilt in unterschiedlichen Dateien, Notizen und Skripten vor — PDF-Skripten, Markdown-Mitschriften, Textdateien und Quellcode. Diese Inhalte sind nicht zentral durchsuchbar; eine konkrete Aussage später belegbar zu zitieren ist mühsam, weil der genaue Fundort verloren geht. In schulischen, beruflichen und privaten Kontexten verschärft sich das Problem mit wachsender Materialmenge (Lastenheft §1).

Gleichzeitig sind KI-Chatassistenten zur breit verfügbaren Hilfe geworden — sie können Inhalte zusammenfassen, Fragen beantworten und Texte erschließen. Ihr Standardbetriebsmodell ist jedoch **serverbasiert**: Anfragen und damit oft auch die zugrunde liegenden Dokumente werden an externe Cloud-Dienste übermittelt und dort verarbeitet.

## 4.2 Problemstellung: Cloud-LLMs gegen lokale Vertraulichkeit

Daraus ergibt sich der zentrale Zielkonflikt des Projekts:

| Pol                         | Eigenschaft                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| **Cloud-LLM (Status quo)**  | Hohe Antwortqualität, aber Inhalte verlassen das Gerät; problematisch für DSGVO-relevante, schulische oder interne Unterlagen |
| **Lokale Vertraulichkeit**  | Daten bleiben auf dem Gerät, aber ohne Assistenz bleibt eigenes Wissen schwer durchsuchbar und nicht belegbar zitierbar |

Für viele reale Unterlagen — Prüfungsmaterial, interne Dokumentation, persönliche Aufzeichnungen — ist die Übermittlung an einen externen Dienst **nicht akzeptabel**. Damit fällt die naheliegende Cloud-Lösung aus, und der Nutzen eines Chatassistenten bleibt ungenutzt.

LokLM löst diesen Konflikt auf, indem es den Assistenten **lokal** betreibt: Das Sprachmodell und die Suche laufen auf dem Gerät des Benutzers; die Dokumente verlassen das Gerät nicht. Damit ist sowohl Vertraulichkeit als auch Assistenzfunktion gegeben (Lastenheft §2, Pflichtenheft Z-1).

## 4.3 Das zweite Kernproblem: Halluzination und fehlende Nachvollziehbarkeit

Sprachmodelle können plausibel klingende, aber sachlich falsche Antworten erzeugen („Halluzination") und Quellen nennen, die nicht existieren. Für ein Werkzeug, das gerade die **Überprüfbarkeit** eigener Unterlagen verspricht, ist das ein Kernrisiko. LokLM begegnet dem auf zwei Ebenen:

- **Quellenbindung:** Antworten werden ausschließlich aus den importierten Dokumenten erzeugt; jede Antwort enthält klickbare Verweise auf konkrete Textstellen, die der Benutzer selbst öffnen und prüfen kann (Z-3).
- **Ehrlichkeit statt Erfindung:** Enthalten die eigenen Dokumente keine Antwort, verweigert das System ehrlich, statt zu erfinden (Z-4).

## 4.4 Technische Herausforderungen

| Herausforderung                         | Beschreibung                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Lokale Modellinferenz**               | Ein Sprachmodell und ein Embedding-Modell müssen auf Endgeräte-Hardware (auch ohne dedizierte GPU) lauffähig sein — gelöst über quantisierte GGUF-Modelle und node-llama-cpp (Vulkan/CUDA/CPU-adaptiv). |
| **Hybride Suche ohne Server**           | Volltext- und Vektorsuche müssen ohne externen Datenbankserver funktionieren — gelöst über In-Process-Postgres (pglite/WASM) mit `tsvector` und `pgvector`/HNSW. |
| **Belastbare Quellenangaben**           | Antworten müssen auf exakte Chunks zurückführbar sein; dies erfordert ein durchdachtes Chunking, Citation-Format und einen SourceViewer. |
| **Verweigerung statt Halluzination**    | Es braucht eine robuste Schwellenwert-Logik, die schwache Treffer als „keine Antwort" einordnet.         |
| **Reproduzierbarkeit der Auslieferung** | ~6 GB Modell-Payload sind nicht beliebig in einen Installer packbar; gelöst über Slim-Installer + First-Launch-Download aus eigenen, gespiegelten Buckets. |

## 4.5 Organisatorische Herausforderungen

- **Kleines Team mit klarer Rollentrennung:** zwei Personen müssen Architektur/Backend einerseits und Tests/Doku/UI andererseits arbeitsteilig und ohne Wissens-Silos abdecken.
- **Echo-Kammer-Risiko bei der Eval:** Wenn dieselbe Person Code, Tests und Bewertung erstellt, droht eine selbstbestätigende Messung — adressiert durch ein separat gehaltenes Hold-out-Set (Risiko R5, Pflichtenheft §10).
- **Zeitknappheit und Ausfallrisiko:** ca. 9 Wochen mit einer reservierten Pufferwoche; Wissensübergabe erfolgt über tägliche Commits und PR-Beschreibungen (Risiken R3, R7).

> WARN durch Team zu ergaenzen — In KW 23 ist laut Projektstatusbericht ein partnerseitiger Ausfall eingetreten, der zwischenzeitlich zu einem kritischen Gesamtstatus führte. Die organisatorischen Auswirkungen sind im Statusbericht 2026-06-14 vermerkt; eine genauere Einordnung obliegt dem Team.

## 4.6 Motivation

Die Motivation des Projekts ist, ein **praktisch nutzbares** Werkzeug zu schaffen, das den Mehrwert moderner KI-Assistenz mit dem Datenschutzanspruch lokaler Datenhaltung verbindet — und das durch konsequente Quellenbindung das Vertrauen in die Antworten begründet, statt es vorauszusetzen. Damit ist LokLM zugleich ein Beitrag zur Frage, wie weit lokale, offene Modelle einen vertraulichen Wissensassistenten heute schon tragen können.
