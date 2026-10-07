import type { PersonaKey } from './cluster'
import type { Lang } from '../i18n/ui'

interface Workflow {
  documents: string
  question: string
  check: string
}

export const workflows: Record<Lang, Record<PersonaKey, Workflow>> = {
  de: {
    lawyer: {
      documents:
        'Beginne mit einem Vertrag und seinen zugehörigen Nachträgen. Halte verschiedene Mandate in getrennten Arbeitsbereichen.',
      question:
        'Welche Kündigungsfrist nennt der Vertrag, und wird sie in einem Nachtrag geändert? Nenne beide Fundstellen.',
      check:
        'Lies die vollständige Klausel und den Nachtrag. Prüfe Parteien, Geltungsbereich, Unterschriften und Wirksamkeitsdatum selbst; eine Fundstelle ersetzt keine rechtliche Bewertung.',
    },
    research: {
      documents:
        'Wähle zwei oder drei Paper zu derselben Forschungsfrage. Nutze möglichst durchsuchbare PDFs und kontrolliere bei Scans die Texterkennung.',
      question:
        'Welche Stichprobe und welche Messmethode beschreibt jedes Paper? Nenne die Fundstellen getrennt.',
      check:
        'Öffne die Methodik im Original. Unterscheide Ergebnisse, Einschränkungen und Interpretation und übernimm bibliografische Angaben aus dem Paper selbst.',
    },
    consulting: {
      documents:
        'Lege für ein Projekt einen Arbeitsbereich mit Angebot, Leistungsbeschreibung und freigegebenem Protokoll an. Verwende eindeutige Dateinamen mit Versionsdatum.',
      question:
        'Welche Liefergegenstände stehen im Angebot, und welche Änderungen nennt das freigegebene Protokoll?',
      check:
        'Prüfe die zitierten Abschnitte auf Freigabe, Zuständigkeit und Datum. Ein neueres Dokument ist nicht automatisch eine verbindliche Änderung.',
    },
    development: {
      documents:
        'Starte mit einem kleinen Repository oder einem Modul und seiner Dokumentation. Lass Zugangsdaten und andere Geheimnisse außerhalb der importierten Dateien.',
      question:
        'Wo wird eine Sitzung geprüft, und welche Aufrufer verlassen sich auf diese Prüfung? Nenne die Dateien.',
      check:
        'Lies Definitionen und Aufrufer im aktuellen Code. Prüfe die Erklärung mit den vorhandenen Tests, bevor du darauf eine Änderung aufbaust.',
    },
    business: {
      documents:
        'Nimm ein aktuelles, intern freigegebenes Handbuch für genau einen Prozess. Importiere nur Dokumente, auf die du zugreifen darfst.',
      question:
        'Welche Schritte nennt das Handbuch für eine Rücksendung, und wann ist eine Freigabe nötig?',
      check:
        'Vergleiche jeden Schritt mit der freigegebenen Fassung und prüfe Ausnahmen. Halte den Originalprozess und seine verantwortliche Person als Entscheidungsgrundlage fest.',
    },
  },
  en: {
    lawyer: {
      documents:
        'Start with one contract and its amendments. Keep separate client matters in separate workspaces.',
      question:
        'What notice period does the contract state, and does an amendment change it? Cite both passages.',
      check:
        'Read the full clause and amendment. Check parties, scope, signatures and effective dates yourself; a retrieved passage does not replace legal review.',
    },
    research: {
      documents:
        'Choose two or three papers about the same research question. Prefer searchable PDFs and check text recognition when using scans.',
      question:
        'What sample and measurement method does each paper describe? Cite each paper separately.',
      check:
        'Open the original methods sections. Distinguish results, limitations and interpretation, and take bibliographic details from the paper itself.',
    },
    consulting: {
      documents:
        'Create a project workspace with the proposal, scope of work and approved meeting notes. Use clear filenames with version dates.',
      question:
        'Which deliverables appear in the proposal, and which changes are recorded in the approved notes?',
      check:
        'Check cited passages for approval, ownership and dates. A newer document is not automatically an authorized change.',
    },
    development: {
      documents:
        'Start with a small repository or one module and its documentation. Keep credentials and other secrets out of imported files.',
      question:
        'Where is a session validated, and which callers rely on that check? Name the files.',
      check:
        'Read definitions and callers in the current code. Check the explanation with existing tests before basing a change on it.',
    },
    business: {
      documents:
        'Choose a current, internally approved handbook covering one process. Import only documents you are authorized to access.',
      question:
        'What steps does the handbook give for handling a return, and when is approval needed?',
      check:
        'Compare each step with the approved version and check exceptions. Keep the original procedure and its owner as the basis for decisions.',
    },
  },
}
