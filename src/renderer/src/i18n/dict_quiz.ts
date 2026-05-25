// quiz domain strings. Keys are 'quiz.*' , English-first , EN is the fallback.
// Owned by the i18n agent for this domain — fill both en + de.
import type { DomainDict } from './types'

export const quizDict: DomainDict = {
  en: {
    // CreateQuizDialog
    'quiz.create.heading': 'New Quiz',
    'quiz.create.nameLabel': 'Name',
    'quiz.create.namePlaceholder': 'e.g. Chapter 3 — Functions',
    'quiz.create.documentsLabel': 'Documents',
    'quiz.create.noDocuments': 'No indexed documents in this workspace. Import a file first.',
    'quiz.create.questionsLabel': 'Questions',
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
    'quiz.list.newQuiz': 'New Quiz',
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

    // QuizDeckHistory
    'quiz.history.loading': 'Loading history…',
    'quiz.history.empty': 'No attempts yet.',
  },
  de: {
    // CreateQuizDialog
    'quiz.create.heading': 'Neues Quiz',
    'quiz.create.nameLabel': 'Name',
    'quiz.create.namePlaceholder': 'z.B. Kapitel 3 — Funktionen',
    'quiz.create.documentsLabel': 'Dokumente',
    'quiz.create.noDocuments':
      'Keine indizierten Dokumente in diesem Arbeitsbereich. Importiere zuerst eine Datei.',
    'quiz.create.questionsLabel': 'Fragen',
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
    'quiz.list.newQuiz': 'Neues Quiz',
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

    // QuizDeckHistory
    'quiz.history.loading': 'Verlauf wird geladen…',
    'quiz.history.empty': 'Noch keine Versuche.',
  },
}
