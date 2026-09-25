import {
  CalendarDays,
  NotebookPen,
  ListTodo,
  GraduationCap,
  Mic,
  Languages,
  PenLine,
  Library,
  MessageSquare,
} from 'lucide-react'
import type { AppView } from '@shared/settings'

export const MODULE_OPTIONS = [
  { id: 'library', key: 'shell.navLibrary', Icon: Library },
  { id: 'chat', key: 'shell.navChat', Icon: MessageSquare },
  { id: 'calendar', key: 'prefs.calendar', Icon: CalendarDays },
  { id: 'notes', key: 'prefs.notes', Icon: NotebookPen },
  { id: 'todos', key: 'prefs.todos', Icon: ListTodo },
  { id: 'quiz', key: 'shell.navQuiz', Icon: GraduationCap },
  { id: 'transcription', key: 'shell.navTranscription', Icon: Mic },
  { id: 'translation', key: 'shell.navTranslation', Icon: Languages },
  { id: 'writing', key: 'shell.navWriting', Icon: PenLine },
] satisfies Array<{ id: AppView; key: string; Icon: typeof Library }>
