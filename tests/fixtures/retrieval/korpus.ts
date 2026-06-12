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
// Stand: 10 Dokumente × 6 ##-Sektionen = 60 Chunks, 10 Fragen. Themen bewusst
// breit gestreut (Bio, Geo, Astro, Physik, Geschichte, Mathe) und DE/EN
// gemischt, damit keine Frage versehentlich in zwei Dokumenten beantwortbar
// ist. Jede Frage trägt einen Vokabel-Anker, der nur in ihrer Zielsektion
// vorkommt (z.B. "Calvin-Zyklus", "Ohm's Law", "Gezeiten").
//
// TODO(Dominik) — fachliche Gegenprobe: Bitte für jede Frage prüfen, ob ein
// Mitschüler die Antwort tatsächlich NUR in der angegebenen Sektion suchen
// würde. Inhalte/Fragen frei anpassen — Mechanik (Auflösung Sektion→Chunk-ID)
// bleibt davon unberührt.

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
      '',
      '## Blattaufbau',
      'Die meisten Chloroplasten liegen im Palisadengewebe direkt unter der Blattoberseite. Über die Spaltöffnungen der Blattunterseite gelangt Kohlendioxid ins Blatt und Sauerstoff hinaus.',
    ].join('\n'),
  },
  {
    datei: 'vulkane.md',
    inhalt: [
      '# Vulkane',
      '',
      '## Aufbau eines Vulkans',
      'Ein Vulkan besteht aus einer Magmakammer in der Tiefe, einem Schlot und einem Krater an der Spitze. Durch den Schlot steigt geschmolzenes Gestein an die Oberfläche.',
      '',
      '## Schichtvulkane',
      'Schichtvulkane bauen sich aus abwechselnden Lagen von erkalteter Lava und Vulkanasche auf. Sie haben steile Hänge und neigen zu explosiven Ausbrüchen, etwa der Vesuv oder der Fuji.',
      '',
      '## Schildvulkane',
      'Schildvulkane entstehen aus dünnflüssiger Lava, die weit fließt und flache, breite Hänge bildet. Der Mauna Loa auf Hawaii ist ein typisches Beispiel.',
      '',
      '## Magma und Lava',
      'Solange das geschmolzene Gestein unter der Erde bleibt, heißt es Magma. Tritt es aus, spricht man von Lava, die je nach Gasgehalt ruhig fließt oder explosiv zerstäubt.',
      '',
      '## Vulkanausbrüche',
      'Bei einem Ausbruch werden Lava, Asche und Gase ausgestoßen. Pyroklastische Ströme aus heißem Gas und Gestein sind besonders gefährlich.',
      '',
      '## Vulkane und Klima',
      'Große Ausbrüche schleudern Asche und Schwefelgase in die Atmosphäre und können das Klima für Monate abkühlen. Der Ausbruch des Tambora 1815 führte zum "Jahr ohne Sommer".',
    ].join('\n'),
  },
  {
    datei: 'sonnensystem.md',
    inhalt: [
      '# Das Sonnensystem',
      '',
      '## Die Sonne',
      'Die Sonne ist ein Stern aus heißem Plasma und enthält über 99 Prozent der Masse des Sonnensystems. In ihrem Kern verschmilzt Wasserstoff zu Helium und setzt dabei Energie frei.',
      '',
      '## Die inneren Planeten',
      'Merkur, Venus, Erde und Mars sind die inneren Gesteinsplaneten. Sie haben feste Oberflächen und liegen näher an der Sonne.',
      '',
      '## Die Gasriesen',
      'Jupiter ist der größte Planet im Sonnensystem und besteht überwiegend aus Wasserstoff und Helium. Auch Saturn, Uranus und Neptun zählen zu den Gasriesen.',
      '',
      '## Monde',
      'Viele Planeten werden von Monden umkreist. Der Erdmond beeinflusst die Gezeiten, und Jupiter besitzt über 90 bekannte Monde.',
      '',
      '## Asteroiden und Kometen',
      'Zwischen Mars und Jupiter liegt der Asteroidengürtel aus Gesteinsbrocken. Kometen stammen aus den äußeren Regionen und bilden bei Sonnennähe einen leuchtenden Schweif.',
      '',
      '## Entstehung',
      'Das Sonnensystem entstand vor etwa 4,6 Milliarden Jahren aus einer rotierenden Gas- und Staubwolke. Aus ihr verdichteten sich Sonne und Planeten.',
    ].join('\n'),
  },
  {
    datei: 'roman-empire.md',
    inhalt: [
      '# The Roman Empire',
      '',
      '## Founding of Rome',
      'According to legend, Rome was founded in 753 BC by the twins Romulus and Remus. It grew from a small city on the Tiber into the centre of a vast empire.',
      '',
      '## The Republic',
      'Before the emperors, Rome was a republic governed by elected senators and consuls. Power was shared to prevent any single person from ruling like a king.',
      '',
      '## Roman Roads',
      'The Romans built a network of paved roads so their legions could march quickly across the empire. The roads were so well engineered that some are still visible today.',
      '',
      '## The Legions',
      'The Roman army was organised into legions of several thousand soldiers each. Strict training and discipline made the legions highly effective in battle.',
      '',
      '## Roman Law',
      'Roman law introduced ideas such as written statutes and the presumption of innocence. Many modern legal systems still build on Roman principles.',
      '',
      '## Fall of the Empire',
      'The Western Roman Empire collapsed in 476 AD under pressure from invasions and internal decline. The Eastern half continued for another thousand years as the Byzantine Empire.',
    ].join('\n'),
  },
  {
    datei: 'electricity.md',
    inhalt: [
      '# Electricity Basics',
      '',
      '## Electric Charge',
      'Matter contains positive and negative electric charges carried by protons and electrons. Like charges repel each other, while opposite charges attract.',
      '',
      '## Voltage',
      'Voltage is the difference in electric potential between two points, measured in volts. It can be thought of as the pressure that pushes charges through a circuit.',
      '',
      '## Electric Current',
      'Electric current is the flow of electric charge, measured in amperes. In metal wires the current is carried by moving electrons.',
      '',
      '## Resistance',
      'Resistance opposes the flow of current and is measured in ohms. Thin or long wires have higher resistance than thick or short ones.',
      '',
      "## Ohm's Law",
      "Ohm's Law states that voltage equals current multiplied by resistance (V = I times R). It lets you calculate any one value when the other two are known.",
      '',
      '## Circuits',
      'A circuit is a closed loop that lets current flow from a source back to it. Components can be connected in series, one after another, or in parallel side by side.',
    ].join('\n'),
  },
  {
    datei: 'wasserkreislauf.md',
    inhalt: [
      '# Der Wasserkreislauf',
      '',
      '## Überblick',
      'Der Wasserkreislauf beschreibt die ständige Bewegung des Wassers zwischen Ozeanen, Atmosphäre und Land. Angetrieben wird er von der Energie der Sonne.',
      '',
      '## Verdunstung',
      'Bei der Verdunstung geht flüssiges Wasser durch Sonnenwärme in Wasserdampf über und steigt in die Atmosphäre auf. Aus Pflanzen verdunstet Wasser zusätzlich über die Transpiration.',
      '',
      '## Kondensation',
      'In der kühleren Höhe kondensiert der Wasserdampf zu winzigen Tröpfchen und bildet Wolken. Dieser Vorgang ist die Umkehrung der Verdunstung.',
      '',
      '## Niederschlag',
      'Werden die Tröpfchen in den Wolken zu schwer, fallen sie als Regen, Schnee oder Hagel zur Erde. Dieser Niederschlag speist Flüsse und Seen.',
      '',
      '## Abfluss und Versickerung',
      'Ein Teil des Niederschlags fließt oberirdisch in Bäche und Flüsse ab, ein anderer versickert ins Grundwasser. Von dort gelangt das Wasser schließlich zurück ins Meer.',
      '',
      '## Bedeutung',
      'Der Wasserkreislauf verteilt Süßwasser über die Kontinente und macht Landwirtschaft erst möglich. Er reinigt das Wasser zudem auf natürliche Weise.',
    ].join('\n'),
  },
  {
    datei: 'human-heart.md',
    inhalt: [
      '# The Human Heart',
      '',
      '## Function of the Heart',
      'The heart is a muscular organ that pumps blood through the body. It delivers oxygen and nutrients to cells and carries away waste products.',
      '',
      '## The Four Chambers',
      'The human heart has four chambers: two upper atria and two lower ventricles. The right side handles oxygen-poor blood and the left side oxygen-rich blood.',
      '',
      '## Heart Valves',
      'Valves between the chambers keep blood flowing in one direction only. When they close, they produce the familiar heartbeat sound.',
      '',
      '## Blood Circulation',
      'Blood travels in two loops: one to the lungs to collect oxygen and one to the rest of the body. This double circulation keeps oxygen-rich and oxygen-poor blood separate.',
      '',
      '## The Heartbeat',
      'A natural pacemaker in the heart sends electrical signals that make it contract. A resting adult heart beats roughly 60 to 100 times per minute.',
      '',
      '## Common Diseases',
      'Blocked arteries can starve the heart muscle of oxygen and cause a heart attack. Exercise and a healthy diet lower the risk of heart disease.',
    ].join('\n'),
  },
  {
    datei: 'mittelalter.md',
    inhalt: [
      '# Das Mittelalter',
      '',
      '## Frühmittelalter',
      'Nach dem Untergang des Weströmischen Reiches entstanden in Europa neue germanische Königreiche. Das Frühmittelalter war von Wanderungen und der Ausbreitung des Christentums geprägt.',
      '',
      '## Lehnswesen',
      'Im Lehnswesen vergab der König Land an Adlige, die ihm dafür Treue und Kriegsdienst schuldeten. Die Bauern bearbeiteten das Land und waren von den Grundherren abhängig.',
      '',
      '## Die Kirche',
      'Die Kirche war die mächtigste Institution des Mittelalters und prägte Bildung, Kunst und Alltag. Klöster bewahrten antikes Wissen und schrieben Bücher von Hand ab.',
      '',
      '## Ritter und Burgen',
      'Ritter waren schwer gepanzerte Reiter, die nach einem Ehrenkodex lebten. Burgen dienten als Wohnsitz des Adels und als Schutz in Kriegszeiten.',
      '',
      '## Die Pest',
      'Im 14. Jahrhundert tötete die Pest, auch Schwarzer Tod genannt, etwa ein Drittel der Bevölkerung Europas. Die Seuche wurde über Flöhe und Ratten verbreitet.',
      '',
      '## Städte und Handel',
      'Im Spätmittelalter wuchsen Städte und mit ihnen Handel und Handwerk. Kaufleute schlossen sich zu Bünden wie der Hanse zusammen.',
    ].join('\n'),
  },
  {
    datei: 'ozeane.md',
    inhalt: [
      '# Die Ozeane',
      '',
      '## Die fünf Ozeane',
      'Die Erde besitzt fünf Ozeane: Pazifik, Atlantik, Indischer, Südlicher und Arktischer Ozean. Zusammen bedecken sie rund 71 Prozent der Erdoberfläche.',
      '',
      '## Meeresströmungen',
      'Große Meeresströmungen wie der Golfstrom transportieren warmes und kaltes Wasser um den Globus. Sie beeinflussen das Klima ganzer Kontinente.',
      '',
      '## Gezeiten',
      'Ebbe und Flut entstehen durch die Anziehungskraft des Mondes und in geringerem Maß der Sonne. Diese Gezeiten lassen den Meeresspiegel zweimal täglich steigen und fallen.',
      '',
      '## Meereslebewesen',
      'Die Ozeane beherbergen eine riesige Vielfalt an Lebewesen, vom winzigen Plankton bis zum Blauwal. Plankton bildet die Grundlage der marinen Nahrungskette.',
      '',
      '## Korallenriffe',
      'Korallenriffe bestehen aus den Kalkskeletten winziger Korallenpolypen und bieten unzähligen Arten Lebensraum. Sie reagieren empfindlich auf steigende Wassertemperaturen.',
      '',
      '## Bedrohungen',
      'Überfischung, Plastikmüll und die Erwärmung der Meere bedrohen die Ozeane. Der Schutz der Meere ist daher eine globale Aufgabe.',
    ].join('\n'),
  },
  {
    datei: 'algebra.md',
    inhalt: [
      '# Algebra',
      '',
      '## Variables and Terms',
      'In algebra, letters such as x and y stand for unknown numbers called variables. A term combines numbers and variables, for example 3x or 5ab.',
      '',
      '## Linear Equations',
      'A linear equation can be written in the form ax + b = 0 and has a single solution. Solving it means isolating the variable on one side.',
      '',
      '## The Quadratic Formula',
      'The quadratic formula solves any equation of the form ax squared plus bx plus c equals zero. It gives the solutions x = (-b plus or minus the square root of b squared minus 4ac) divided by 2a.',
      '',
      '## Functions',
      'A function assigns exactly one output value to each input value. Functions are often written as f(x) and can be drawn as graphs.',
      '',
      '## Inequalities',
      'An inequality compares two expressions using signs such as less-than or greater-than. Multiplying both sides by a negative number flips the direction of the sign.',
      '',
      '## Polynomials',
      'A polynomial is a sum of terms with whole-number powers of a variable, such as x cubed minus 2x plus 1. The highest power is called the degree of the polynomial.',
    ].join('\n'),
  },
]

export const FRAGEN: PruefFrage[] = [
  {
    id: 'F01',
    frage: 'Wo in der Pflanzenzelle läuft der Calvin-Zyklus ab?',
    erwartet: [{ datei: 'photosynthese.md', sektion: 'Calvin-Zyklus' }],
  },
  {
    id: 'F02',
    frage: 'Welcher Vulkantyp baut sich aus abwechselnden Schichten von Lava und Asche auf?',
    erwartet: [{ datei: 'vulkane.md', sektion: 'Schichtvulkane' }],
  },
  {
    id: 'F03',
    frage: 'Welcher Planet ist der größte im Sonnensystem?',
    erwartet: [{ datei: 'sonnensystem.md', sektion: 'Die Gasriesen' }],
  },
  {
    id: 'F04',
    frage: 'What did the Romans build so their legions could march quickly across the empire?',
    erwartet: [{ datei: 'roman-empire.md', sektion: 'Roman Roads' }],
  },
  {
    id: 'F05',
    frage: 'Which law relates voltage, current and resistance in a circuit?',
    erwartet: [{ datei: 'electricity.md', sektion: "Ohm's Law" }],
  },
  {
    id: 'F06',
    frage: 'Wie heißt der Übergang von flüssigem Wasser zu Wasserdampf im Wasserkreislauf?',
    erwartet: [{ datei: 'wasserkreislauf.md', sektion: 'Verdunstung' }],
  },
  {
    id: 'F07',
    frage: 'How many chambers does the human heart have?',
    erwartet: [{ datei: 'human-heart.md', sektion: 'The Four Chambers' }],
  },
  {
    id: 'F08',
    frage: 'Welche Seuche tötete im 14. Jahrhundert etwa ein Drittel der Bevölkerung Europas?',
    erwartet: [{ datei: 'mittelalter.md', sektion: 'Die Pest' }],
  },
  {
    id: 'F09',
    frage: 'Wodurch entstehen Ebbe und Flut in den Ozeanen?',
    erwartet: [{ datei: 'ozeane.md', sektion: 'Gezeiten' }],
  },
  {
    id: 'F10',
    frage: 'Which formula solves equations of the form ax squared plus bx plus c equals zero?',
    erwartet: [{ datei: 'algebra.md', sektion: 'The Quadratic Formula' }],
  },
]
