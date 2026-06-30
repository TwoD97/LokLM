// quiz domain strings. Keys are 'quiz.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const quizDict: DomainDict = {
  en: {
    // CreateQuizDialog
    'quiz.create.heading': 'New Quiz',
    'quiz.create.nameLabel': 'Name',
    'quiz.create.namePlaceholder': 'e.g. Chapter 3 — Functions',
    'quiz.create.documentsLabel': 'Document',
    'quiz.create.noDocuments': 'No indexed documents in this workspace. Import a file first.',
    'quiz.create.estimate': '{sections} sections · about {questions} questions',
    'quiz.create.estimateEmpty': 'No indexable content in the selected document.',
    'quiz.create.languageLabel': 'Language',
    'quiz.create.languageAuto': 'Auto',
    'quiz.create.languageDe': 'Deutsch',
    'quiz.create.languageEn': 'English',
    'quiz.create.generating': 'Creating…',
    'quiz.create.generate': 'Generate',

    // QuizRunner
    'quiz.runner.progress': 'Question {current} / {total}',
    'quiz.runner.elapsedTime': 'Elapsed time',
    'quiz.runner.scoring': 'Scoring…',
    'quiz.runner.finish': 'Finish',
    'quiz.runner.modeAria': 'Quiz mode',
    'quiz.runner.modePractice': 'Practice',
    'quiz.runner.modeTest': 'Test',
    'quiz.runner.modePracticeHint': 'Reveal each answer as you go',
    'quiz.runner.modeTestHint': 'Answer everything, then see your results',
    'quiz.runner.submit': 'Submit',
    'quiz.runner.answered': '{answered} / {total} answered',

    // QuizResults
    'quiz.results.heading': 'Results',
    'quiz.results.backToList': 'Back to list',
    'quiz.results.completedIn': 'Completed in {duration}',
    'quiz.results.yourAttempts': 'Your attempts',
    'quiz.results.correct': '✓ Correct',
    'quiz.results.yourAnswer': '✗ Your answer: {answer}',
    'quiz.results.correctAnswer': 'Correct: {answer}',

    // QuestionCard
    'quiz.card.viewSource': 'View source',

    // QuizListView
    'quiz.list.heading': 'Quizzes',
    'quiz.list.workspaceLabel': 'from {name}',
    'quiz.list.workspaceHint': 'Quizzes are generated from the documents in this workspace',
    'quiz.list.newQuiz': 'New Quiz',
    'quiz.list.mergeQuiz': 'Merge',
    'quiz.list.empty': 'No quizzes yet. Create one to start learning from your documents.',
    'quiz.list.questions': '{count} questions',
    'quiz.list.fileCount': '{count} file',
    'quiz.list.fileCountPlural': '{count} files',
    'quiz.list.attemptCount': '{count} attempt',
    'quiz.list.attemptCountPlural': '{count} attempts',
    'quiz.list.hideHistory': 'Hide history',
    'quiz.list.showHistory': 'Show history',
    'quiz.list.history': 'History',
    'quiz.list.start': 'Start',
    'quiz.list.deleteDeck': 'Delete deck',
    'quiz.list.statusGenerating': 'Generating…',
    'quiz.list.statusFailed': 'Failed',
    'quiz.list.statusReady': 'Ready',
    'quiz.list.stepStarting': 'Starting…',
    'quiz.list.stepGenerating': 'Writing questions',
    'quiz.list.stepUnitProgress': 'section {current}/{total}',
    'quiz.list.stepsHeader': 'steps',

    // QuizDeckHistory
    'quiz.history.loading': 'Loading history…',
    'quiz.history.empty': 'No attempts yet.',

    // MergeQuizDialog
    'quiz.merge.heading': 'Merge quizzes',
    'quiz.merge.nameLabel': 'Name',
    'quiz.merge.namePlaceholder': 'e.g. Exam prep — combined',
    'quiz.merge.decksLabel': 'Quizzes to merge',
    'quiz.merge.noDecks': 'You need at least two ready quizzes to merge.',
    'quiz.merge.shuffle': 'Shuffle question order',
    'quiz.merge.questionsTotal': '{count} questions total',
    'quiz.merge.merge': 'Merge',
    'quiz.merge.merging': 'Merging…',
  },
  de: {
    // CreateQuizDialog
    'quiz.create.heading': 'Neues Quiz',
    'quiz.create.nameLabel': 'Name',
    'quiz.create.namePlaceholder': 'z.B. Kapitel 3 — Funktionen',
    'quiz.create.documentsLabel': 'Dokument',
    'quiz.create.noDocuments':
      'Keine indizierten Dokumente in diesem Arbeitsbereich. Importiere zuerst eine Datei.',
    'quiz.create.estimate': '{sections} Abschnitte · etwa {questions} Fragen',
    'quiz.create.estimateEmpty': 'Kein indizierbarer Inhalt im ausgewählten Dokument.',
    'quiz.create.languageLabel': 'Sprache',
    'quiz.create.languageAuto': 'Auto',
    'quiz.create.languageDe': 'Deutsch',
    'quiz.create.languageEn': 'English',
    'quiz.create.generating': 'Wird erstellt…',
    'quiz.create.generate': 'Erstellen',

    // QuizRunner
    'quiz.runner.progress': 'Frage {current} / {total}',
    'quiz.runner.elapsedTime': 'Verstrichene Zeit',
    'quiz.runner.scoring': 'Auswertung…',
    'quiz.runner.finish': 'Abschließen',
    'quiz.runner.modeAria': 'Quiz-Modus',
    'quiz.runner.modePractice': 'Üben',
    'quiz.runner.modeTest': 'Test',
    'quiz.runner.modePracticeHint': 'Antwort sofort nach jeder Frage anzeigen',
    'quiz.runner.modeTestHint': 'Alles beantworten, dann Ergebnis ansehen',
    'quiz.runner.submit': 'Abgeben',
    'quiz.runner.answered': '{answered} / {total} beantwortet',

    // QuizResults
    'quiz.results.heading': 'Ergebnisse',
    'quiz.results.backToList': 'Zurück zur Liste',
    'quiz.results.completedIn': 'Abgeschlossen in {duration}',
    'quiz.results.yourAttempts': 'Deine Versuche',
    'quiz.results.correct': '✓ Richtig',
    'quiz.results.yourAnswer': '✗ Deine Antwort: {answer}',
    'quiz.results.correctAnswer': 'Richtig: {answer}',

    // QuestionCard
    'quiz.card.viewSource': 'Quelle anzeigen',

    // QuizListView
    'quiz.list.heading': 'Quizze',
    'quiz.list.workspaceLabel': 'aus {name}',
    'quiz.list.workspaceHint': 'Quizze werden aus den Dokumenten dieses Workspace erstellt',
    'quiz.list.newQuiz': 'Neues Quiz',
    'quiz.list.mergeQuiz': 'Zusammenführen',
    'quiz.list.empty': 'Noch keine Quizze. Erstelle eines, um aus deinen Dokumenten zu lernen.',
    'quiz.list.questions': '{count} Fragen',
    'quiz.list.fileCount': '{count} Datei',
    'quiz.list.fileCountPlural': '{count} Dateien',
    'quiz.list.attemptCount': '{count} Versuch',
    'quiz.list.attemptCountPlural': '{count} Versuche',
    'quiz.list.hideHistory': 'Verlauf ausblenden',
    'quiz.list.showHistory': 'Verlauf anzeigen',
    'quiz.list.history': 'Verlauf',
    'quiz.list.start': 'Starten',
    'quiz.list.deleteDeck': 'Quiz löschen',
    'quiz.list.statusGenerating': 'Wird erstellt…',
    'quiz.list.statusFailed': 'Fehlgeschlagen',
    'quiz.list.statusReady': 'Bereit',
    'quiz.list.stepStarting': 'Wird gestartet…',
    'quiz.list.stepGenerating': 'Fragen werden geschrieben',
    'quiz.list.stepUnitProgress': 'Abschnitt {current}/{total}',
    'quiz.list.stepsHeader': 'Schritte',

    // QuizDeckHistory
    'quiz.history.loading': 'Verlauf wird geladen…',
    'quiz.history.empty': 'Noch keine Versuche.',

    // MergeQuizDialog
    'quiz.merge.heading': 'Quizze zusammenführen',
    'quiz.merge.nameLabel': 'Name',
    'quiz.merge.namePlaceholder': 'z.B. Prüfungsvorbereitung — kombiniert',
    'quiz.merge.decksLabel': 'Zu kombinierende Quizze',
    'quiz.merge.noDecks': 'Mindestens zwei fertige Quizze zum Zusammenführen nötig.',
    'quiz.merge.shuffle': 'Fragenreihenfolge mischen',
    'quiz.merge.questionsTotal': 'insgesamt {count} Fragen',
    'quiz.merge.merge': 'Zusammenführen',
    'quiz.merge.merging': 'Wird zusammengeführt…',
  },
}
