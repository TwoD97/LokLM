import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from './i18n'

// Functional fallback so the class boundary can still use the translation hook
// (hooks can't run inside a class component). Rendered only on error.
function ErrorFallback({
  label,
  message,
}: {
  label?: string | undefined
  message: string
}): JSX.Element {
  const t = useT()
  return (
    <div role="alert" style={{ padding: 16, color: 'var(--error)' }}>
      {label ? `${label}: ` : ''}
      {message || t('shell.unknownError')}
    </div>
  )
}

type Props = {
  children: ReactNode
  /** Optional label shown in the fallback so the user knows which surface failed. */
  label?: string
  /** Optional callback invoked once on error — used by callers to dismiss/reset the
   *  state that mounted the failing subtree (e.g. close the source viewer). */
  onError?: (error: Error) => void
}

type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ''}]`, error, info)
    this.props.onError?.(error)
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <ErrorFallback label={this.props.label} message={this.state.error.message} />
    }
    return this.props.children
  }
}
