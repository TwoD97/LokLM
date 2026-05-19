// Public contract for the streaming QA pipeline. Mirrors the shared/documents
// version so both main-process callers and renderer subscribers can import
// the same shape (the renderer goes through shared, the main-process goes
// through here for proximity to QAService).
export type {
  StreamEvent,
  AnswerOptions,
  AnswerResult,
  RefusalReason,
} from '../../../shared/documents'
