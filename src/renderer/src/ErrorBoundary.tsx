import { Component, type ErrorInfo, type ReactNode } from 'react'

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
      return (
        <div role="alert" style={{ padding: 16, color: '#f0d4d4' }}>
          {this.props.label ? `${this.props.label}: ` : ''}
          {this.state.error.message || 'Unbekannter Fehler'}
        </div>
      )
    }
    return this.props.children
  }
}
