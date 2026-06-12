// AP-T.2 — Retrieval-Korpus für den RetrievalService-E2E-Test (Pflichtenheft §8.2).
//
// Aufbau: ≥50 Chunks aus mehreren Dokumenten. Jede `##`-Sektion wird vom
// markdown-aware Chunker zu (mindestens) einem Chunk mit heading_path, darüber
// ordnet der Test erwartete Sektionen ihren echten Chunk-IDs zu.
//
// WICHTIG zur Chunk-Zählung: Die `#`-Titelzeile (H1) ohne eigenen Fließtext
// erzeugt KEINEN Chunk — gezählt werden nur `##`-Sektionen mit Inhalt. Eine
// kurze Sektion = genau ein Chunk. Also gilt schlicht:
//   Chunks pro Dokument = Anzahl der `##`-Sektionen mit Text.
// Plane mit Puffer, nicht auf Kante: z.B. 10 Dokumente × 6 Sektionen = 60,
// oder 9 × 6 = 54. Genau 50 (10×5) ist riskant — ein Dokument mit nur 4
// Sektionen kippt den Korpus-Umfangs-Test auf 49 und damit auf Rot.
//
// Regeln für gute Korpus-Einträge:
//  - Sektionen kurz halten (2–4 Sätze), damit eine Sektion ≈ ein Chunk bleibt.
//  - Themen klar voneinander trennen — eine Frage darf nur in EINER Sektion
//    beantwortbar sein, sonst ist `erwartet` mehrdeutig und der Test wertlos.
//  - Mischung DE/EN ist erwünscht (BGE-M3 ist mehrsprachig).
//
// TODO(Dominik): weitere Dokumente + Fragen ergänzen bis ≥50 Chunks / ≥10
// Fragen — das erste Dokument und die erste Frage unten zeigen das Muster.
// Themenwahl ist frei (Zielgruppe: Schule), wichtig ist nur die Eindeutigkeit
// pro Frage.

export interface KorpusDokument {
  /** Dateiname im Test-Workspace — stabiler Schlüssel für erwartete Treffer. */
  datei: string
  /** Markdown-Inhalt; jede ##-Sektion ergibt ~1 Chunk. */
  inhalt: string
}

export interface PruefFrage {
  id: string
  frage: string
  /**
   * Wo die Antwort steht: Dokument (datei) + Sektions-Überschrift (sektion).
   * `sektion` ist die `##`-Überschrift (NICHT der `#`-Dokumenttitel) — der Test
   * matcht das letzte/spezifischste Element des heading_path, damit die Zuordnung
   * sektionsgenau bleibt. Er löst das nach dem Import in echte Chunk-IDs auf und
   * verlangt, dass mindestens eine davon im Top-K auftaucht.
   */
  erwartet: { datei: string; sektion: string }[]
}

export const KORPUS: KorpusDokument[] = [
  {
    datei: 'photosynthese.md',
    inhalt: [
      '# Photosynthese',
      '',
      '## Grundprinzip',
      'Pflanzen wandeln Lichtenergie in chemische Energie um. Aus Kohlendioxid und Wasser entstehen Glucose und Sauerstoff. Dieser Prozess findet in den Chloroplasten statt.',
      '',
      '## Lichtreaktion',
      'In der Lichtreaktion wird Wasser gespalten und Sauerstoff freigesetzt. Die Energie des Lichts wird in ATP und NADPH zwischengespeichert. Chlorophyll absorbiert dabei vor allem rotes und blaues Licht.',
      '',
      '## Calvin-Zyklus',
      'Der Calvin-Zyklus nutzt ATP und NADPH aus der Lichtreaktion, um Kohlendioxid zu Glucose zu reduzieren. Er läuft im Stroma der Chloroplasten ab und benötigt kein Licht direkt.',
      '',
      '## Bedeutung für das Ökosystem',
      'Die Photosynthese ist die Grundlage fast aller Nahrungsketten. Sie produziert den Sauerstoff der Atmosphäre und bindet Kohlendioxid aus der Luft.',
      '',
      '## Einflussfaktoren',
      'Lichtintensität, Temperatur und CO2-Konzentration begrenzen die Photosyntheserate. Bei zu hoher Temperatur denaturieren die beteiligten Enzyme.',
    ].join('\n'),
  },
  // TODO(Dominik): 9 weitere Dokumente nach demselben Muster.
]

export const FRAGEN: PruefFrage[] = [
  {
    id: 'F01',
    frage: 'Wo in der Pflanzenzelle läuft der Calvin-Zyklus ab?',
    erwartet: [{ datei: 'photosynthese.md', sektion: 'Calvin-Zyklus' }],
  },
  // TODO(Dominik): 9 weitere Fragen — jede muss eindeutig auf genau eine
  // Sektion zeigen (Querprobe: würde ein Mitschüler die Antwort in einer
  // anderen Sektion suchen? Dann umformulieren).
]
