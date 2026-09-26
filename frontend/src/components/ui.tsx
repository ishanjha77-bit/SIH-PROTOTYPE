import { ChevronDown, X } from 'lucide-react'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { TONE, type Tone } from '../lib/present'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

/* ---------- Button ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet'
const BTN: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-[0_0_0_1px_var(--accent),0_6px_20px_-8px_var(--accent)]',
  secondary: 'border border-line-strong bg-surface text-ink hover:border-accent/60 hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  quiet: 'text-accent hover:bg-accent-soft',
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <button type="button" {...rest}
      className={cx('inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background,color,border-color,filter,transform] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'h-8 px-3 text-[12.5px]' : 'h-9 px-3.5 text-[13px]', BTN[variant], className)}>
      {icon}{children}{iconRight}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink active:scale-95', className)}>
      {children}
    </button>
  )
}

/** Native select (keeps OS pickers on mobile) styled to match the system. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative inline-flex', className)}>
      <select {...rest}
        className="h-9 w-full cursor-pointer appearance-none rounded-lg border border-line bg-surface pl-3 pr-9 text-[13px] font-medium text-ink transition-colors duration-150 hover:border-line-strong">
        {children}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  )
}

/* ---------- Card ---------- */
export function Card({ children, className, pad = true, as: As = 'section', style }: {
  children: ReactNode; className?: string; pad?: boolean; as?: 'section' | 'article' | 'div'; style?: React.CSSProperties
}) {
  return (
    <As style={style} className={cx('rounded-2xl border border-line bg-surface shadow-soft', pad && 'p-5 sm:p-6', className)}>
      {children}
    </As>
  )
}

export function CardHead({ title, hint, right, eyebrow }: { title: ReactNode; hint?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className={typeof eyebrow === 'string' ? 'eyebrow mb-1.5' : 'mb-2.5'}>{eyebrow}</div>}
        <h2 className="t-h2 text-ink">{title}</h2>
        {hint && <p className="t-small mt-1 max-w-[70ch] text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

/** A number that matters, with its label and an optional comparison. */
export function StatCard({ label, value, unit, delta, deltaTone = 'ok', foot, className }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; delta?: ReactNode; deltaTone?: Tone; foot?: ReactNode; className?: string
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="t-caption text-muted">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="t-num text-[28px] leading-none text-ink">{value}</span>
        {unit && <span className="t-small text-muted">{unit}</span>}
      </div>
      {delta && <div className={cx('t-caption mt-1.5 font-medium', TONE[deltaTone].fg)}>{delta}</div>}
      {foot && <div className="t-caption mt-1 text-muted">{foot}</div>}
    </div>
  )
}

/* ---------- Badge ---------- */
export function Chip({ tone, children, size = 'sm', dot = true, pulse = false }: { tone: Tone; children: ReactNode; size?: 'sm' | 'md'; dot?: boolean; pulse?: boolean }) {
  const t = TONE[tone]
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium', t.bg, t.fg,
      size === 'sm' ? 'px-2 py-0.5 text-[11.5px]' : 'px-2.5 py-1 text-[12.5px]')}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', pulse && 'pulse-ring')} style={{ background: t.hex, color: t.hex }} />}
      {children}
    </span>
  )
}
export const Badge = Chip

export function AIBadge({ children = 'AI insight' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0l1.8 6.2L16 8l-6.2 1.8L8 16l-1.8-6.2L0 8l6.2-1.8z" fill="currentColor" /></svg>
      {children}
    </span>
  )
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: TONE[tone].hex }} />
}

/* ---------- Controls ---------- */
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx('rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors duration-150',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressBar({ value, tone = 'accent', className, label }: { value: number; tone?: Tone | 'accent'; className?: string; label?: string }) {
  const c = tone === 'accent' ? 'var(--accent)' : TONE[tone].hex
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      className={cx('h-1.5 overflow-hidden rounded-full bg-sunken', className)}>
      <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: c }} />
    </div>
  )
}

/** Paired horizontal bars: WeatherGuard vs legacy for one metric. */
export function CompareBars({ wg, legacy, max, fmt, better = 'high', labels = ['WeatherGuard', 'Legacy QC'] }: {
  wg: number; legacy: number; max: number; fmt: (v: number) => string; better?: 'high' | 'low'; labels?: [string, string]
}) {
  const w = (v: number) => `${Math.max(1.5, Math.min(100, (v / (max || 1)) * 100))}%`
  const wgWins = better === 'high' ? wg >= legacy : wg <= legacy
  return (
    <div className="grid gap-2">
      {([[labels[0], wg, true], [labels[1], legacy, false]] as const).map(([name, v, us]) => (
        <div key={name} className="grid grid-cols-[92px_1fr_48px] items-center gap-3 text-[12px]" title={`${name}: ${fmt(v)}`}>
          <span className={us ? 'text-ink-2' : 'text-muted'}>{name}</span>
          <span className="h-1.5 rounded-full bg-sunken">
            <span className={cx('block h-1.5 rounded-full transition-[width] duration-700 ease-out', us ? 'bg-accent' : 'bg-line-strong')} style={{ width: w(v) }} />
          </span>
          <span className={cx('tnum text-right font-mono', us ? (wgWins ? 'font-medium text-accent' : 'text-ink-2') : 'text-muted')}>{fmt(v)}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- States ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('skeleton', className)} />
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-4" />)}
    </div>
  )
}

/** Placeholder while a lazily-loaded screen arrives. */
export function PageSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" role="status" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-3.5 w-64 max-w-full" />
          <div className="mt-6 flex flex-col gap-3">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-4" />)}</div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-sunken text-muted">{icon}</span>}
      {title && <div className="t-h3 text-ink">{title}</div>}
      <p className="t-small max-w-[48ch] text-muted">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
/** Back-compat alias used across views. */
export const Empty = ({ children }: { children: ReactNode }) => <EmptyState>{children}</EmptyState>

export function Notice({ tone = 'off', icon, children, action }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className={cx('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-[13px]', TONE[tone].bg)}>
      {icon && <span className={TONE[tone].fg}>{icon}</span>}
      <span className="min-w-0 flex-1 text-ink">{children}</span>
      {action}
    </div>
  )
}

/* ---------- Drawer / sheet ---------- */
export function Drawer({ open, onClose, title, children, footer, side = 'right', label }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; side?: 'right' | 'bottom'; label: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !panel.current) return
      // Keep keyboard focus inside the dialog.
      const f = panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], select, input, [tabindex]:not([tabindex="-1"])')
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    const ov = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ov; prev?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  const right = side === 'right'
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="scrim-in absolute inset-0 backdrop-blur-[2px]" style={{ background: 'var(--scrim)' }} onClick={onClose} />
      <div ref={panel} tabIndex={-1}
        className={cx('absolute flex flex-col border-line bg-surface shadow-lift outline-none',
          right ? 'drawer-in inset-y-0 right-0 w-full max-w-[520px] border-l sm:inset-y-2 sm:right-2 sm:rounded-2xl sm:border'
            : 'sheet-in inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t pb-[env(safe-area-inset-bottom,0px)]')}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton label="Close" onClick={onClose}><X size={17} /></IconButton>
        </div>
        <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  )
}
