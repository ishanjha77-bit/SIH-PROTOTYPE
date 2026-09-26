import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { TONE } from '../lib/present'
import { cx } from './ui'

type Kind = 'success' | 'error' | 'info'
interface ToastItem { id: number; kind: Kind; title: string; body?: string; action?: { label: string; run: () => void } }

let items: ToastItem[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

/** Fire-and-forget notification. Auto-dismisses after 4.5 s (7 s when it carries an action). */
export function toast(title: string, opts: { kind?: Kind; body?: string; action?: ToastItem['action'] } = {}) {
  const t: ToastItem = { id: ++seq, kind: opts.kind ?? 'success', title, body: opts.body, action: opts.action }
  items = [...items.slice(-2), t]
  emit()
  setTimeout(() => dismiss(t.id), t.action ? 7000 : 4500)
}

const ICON: Record<Kind, ReactNode> = {
  success: <CheckCircle2 size={16} className={TONE.ok.fg} />,
  error: <AlertTriangle size={16} className={TONE.fault.fg} />,
  info: <Info size={16} className="text-accent" />,
}

export function Toaster() {
  const list = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => items)
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-5 sm:top-5 sm:items-end">
      {list.map((t) => (
        <div key={t.id} role="status"
          className="rise pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lift">
          <span className="mt-0.5">{ICON[t.kind]}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-ink">{t.title}</div>
            {t.body && <div className="t-caption mt-0.5 text-muted">{t.body}</div>}
            {t.action && (
              <button type="button" onClick={() => { t.action!.run(); dismiss(t.id) }}
                className={cx('mt-1.5 text-[12.5px] font-medium text-accent hover:underline')}>{t.action.label}</button>
            )}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted transition-colors hover:text-ink"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}
