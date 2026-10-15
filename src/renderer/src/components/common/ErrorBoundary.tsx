import { Component, type ErrorInfo, type ReactNode } from 'react'
import { RotateCcw, TriangleAlert } from 'lucide-react'
import { useT } from '@/lib/i18n'

interface Props {
  children: ReactNode
  /** short name of the area, shown in the fallback */
  area: string
  /** render nothing but a slim notice (for small panes) */
  compact?: boolean
}

interface State {
  error: Error | null
}

/** The fallback is a function component so it can follow the UI language. */
function CrashNotice({ area, compact, error, onRetry }: { area: string; compact?: boolean; error: Error; onRetry(): void }) {
  const t = useT()
  return (
    <div className={`crash${compact ? ' compact' : ''}`} role="alert">
      <TriangleAlert size={compact ? 16 : 26} strokeWidth={1.6} />
      <div className="crash-text">
        <strong>{t('{area} ran into a problem', { area })}</strong>
        <span className="selectable">{error.message}</span>
      </div>
      <button className="btn btn-sm" onClick={onRetry}>
        <RotateCcw size={13} /> {t('Try again')}
      </button>
    </div>
  )
}

/** Keeps a crash in one view from blanking the whole window. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[clauditor] ${this.props.area} crashed:`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return <CrashNotice area={this.props.area} compact={this.props.compact} error={error} onRetry={() => this.setState({ error: null })} />
  }
}
