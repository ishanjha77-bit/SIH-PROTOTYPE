import { ChevronDown, X } from 'lucide-react'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { TONE, type Tone } from '../lib/present'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

/* ---------- Buttons ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'link'
const BTN: Record<ButtonVariant, string> = {
  // Primary is ink on paper (inverted), not a coloured glow.
  primary: 'bg-ink text-bg hover:opacity-85',
  secondary: 'border border-line-strong text-ink hover:border-ink-2 hover:bg-sunken',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  quiet: 'text-accent hover:bg-accent-soft',
  link: 'px-0! h-auto! text-accent underline-offset-4 decoration-1 hover:underline',
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <button type="button" {...rest}
      className={cx('group/btn inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background,color,border-color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-[14px]', BTN[variant], className)}>
      {icon}{children}{iconRight && <span className="transition-transform duration-200 group-hover/btn:translate-x-0.5">{iconRight}</span>}
    </button>
  )
}

export function IconButton({ label, children, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest}
      className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink', className)}>
      {children}
    </button>
  )
}

/** Native select (keeps OS pickers on mobile), styled to match. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx('relative inline-flex', className)}>
      <select {...rest}
        className="h-9 w-full cursor-pointer appearance-none rounded-md border border-line-strong bg-transparent pl-3 pr-9 text-[14px] text-ink transition-colors duration-150 hover:border-ink-2">
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  )
}

/* ---------- Sections ----------
 * Default: an editorial section marked by a hairline, no box.
 * `box`: a bordered container, only where grouping genuinely aids comprehension. */
export function Card({ children, className, box = false, pad = true, as: As = 'section', style }: {
  children: ReactNode; className?: string; box?: boolean; pad?: boolean; as?: 'section' | 'article' | 'div'; style?: React.CSSProperties
}) {
  return (
    <As style={style} className={cx(box ? cx('rounded-lg border border-line bg-surface', pad && 'p-5 sm:p-6') : 'border-t border-line pt-6', className)}>
      {children}
    </As>
  )
}

export function CardHead({ title, hint, right, eyebrow }: { title: ReactNode; hint?: ReactNode; right?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h2 className="t-h2 text-ink">{title}</h2>
        {hint && <p className="t-small mt-1.5 max-w-[62ch] text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

/** A figure that matters: the number leads, the label explains it, the footnote compares. */
export function StatCard({ label, value, unit, delta, deltaTone = 'ok', foot, className }: {
  label: ReactNode; value: ReactNode; unit?: ReactNode; delta?: ReactNode; deltaTone?: Tone; foot?: ReactNode; className?: string
}) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex items-baseline gap-1.5">
        <span className="t-figure text-[40px] text-ink sm:text-[44px]">{value}</span>
        {unit && <span className="t-small text-muted">{unit}</span>}
      </div>
      <div className="t-small mt-3 text-ink-2">{label}</div>
      {delta && <div className={cx('t-caption mt-1', TONE[deltaTone].fg)}>{delta}</div>}
      {foot && <div className="t-caption mt-1 text-muted">{foot}</div>}
    </div>
  )
}

/* ---------- Status ----------
 * A dot and a word. Colour carries the meaning; no filled pills. */
export function Chip({ tone, children, size = 'sm', dot = true }: { tone: Tone; children: ReactNode; size?: 'sm' | 'md'; dot?: boolean; pulse?: boolean }) {
  const t = TONE[tone], quiet = tone === 'ok' || tone === 'off'
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap font-medium', quiet ? 'text-ink-2' : t.fg, size === 'sm' ? 'text-[12.5px]' : 'text-[13.5px]')}>
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: t.hex }} />}
      {children}
    </span>
  )
}
export const Badge = Chip

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', className)} style={{ background: TONE[tone].hex }} />
}

/* ---------- Controls ---------- */
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md border border-line p-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx('rounded-[4px] px-2.5 py-1 text-[12.5px] transition-colors duration-150',
            o.value === value ? 'bg-sunken font-medium text-ink' : 'text-muted hover:text-ink')}>
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
      className={cx('h-[3px] overflow-hidden rounded-full bg-line', className)}>
      <div className="h-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: c }} />
    </div>
  )
}

/** Paired thin bars: WeatherGuard (ink) vs the baseline (grey), for one metric. */
export function CompareBars({ wg, legacy, max, fmt, better = 'high', labels = ['WeatherGuard', 'Legacy QC'] }: {
  wg: number; legacy: number; max: number; fmt: (v: number) => string; better?: 'high' | 'low'; labels?: [string, string]
}) {
  const w = (v: number) => `${Math.max(0.8, Math.min(100, (v / (max || 1)) * 100))}%`
  const wgWins = better === 'high' ? wg >= legacy : wg <= legacy
  return (
    <div className="grid gap-2.5">
      {([[labels[0], wg, true], [labels[1], legacy, false]] as const).map(([name, v, us]) => (
        <div key={name} className="grid grid-cols-[96px_1fr_52px] items-center gap-4 text-[13px]" title={`${name}: ${fmt(v)}`}>
          <span className={us ? 'text-ink' : 'text-muted'}>{name}</span>
          <span className="h-[3px] bg-line">
            <span className={cx('block h-[3px] transition-[width] duration-700 ease-out', us ? 'bg-ink' : 'bg-line-strong')} style={{ width: w(v) }} />
          </span>
          <span className={cx('tnum text-right', us ? (wgWins ? 'font-medium text-ink' : 'text-ink-2') : 'text-muted')}>{fmt(v)}</span>
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
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-3.5" />)}
    </div>
  )
}

/** Placeholder while a lazily-loaded screen arrives. */
export function PageSkeleton() {
  return (
    <div className="grid gap-10 lg:grid-cols-2" role="status" aria-label="Loading">
      {[0, 1].map((i) => (
        <div key={i} className="border-t border-line pt-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-3 h-3.5 w-64 max-w-full" />
          <div className="mt-6 flex flex-col gap-3">{[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-3.5" />)}</div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ title, children, action }: { icon?: ReactNode; title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-10">
      {title && <div className="t-h3 text-ink">{title}</div>}
      <p className="t-small mt-1 max-w-[52ch] text-muted">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
/** Back-compat alias used across views. */
export const Empty = ({ children }: { children: ReactNode }) => <EmptyState>{children}</EmptyState>

export function Notice({ tone = 'off', children, action }: { tone?: Tone; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 py-1 pl-4 text-[14px]" style={{ borderColor: TONE[tone].hex }}>
      <span className="min-w-0 flex-1 text-ink">{children}</span>
      {action}
    </div>
  )
}

/* ---------- Drawer / sheet ---------- */
export function Drawer({ open, onClose, title, children, footer, side = 'right', label }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; side?: 'right' | 'top'; label: string
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
  // Portalled to <body>: animated ancestors (entrance transforms) would otherwise trap a fixed dialog
  // in their stacking context, underneath the nav and the replay bar.
  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={label}>
      <div className="scrim-in absolute inset-0" style={{ background: 'var(--scrim)' }} onClick={onClose} />
      <div ref={panel} tabIndex={-1}
        className={cx('absolute flex flex-col bg-bg shadow-lift outline-none',
          right ? 'drawer-in inset-y-0 right-0 w-full max-w-[560px] border-l border-line'
            : 'sheet-in inset-x-0 top-0 max-h-[90vh] border-b border-line pt-[env(safe-area-inset-top,0px)]')}>
        <div className="flex items-start justify-between gap-4 px-6 pb-5 pt-6 sm:px-8">
          <div className="min-w-0 flex-1">{title}</div>
          <IconButton label="Close" onClick={onClose} className="-mr-2 -mt-1"><X size={17} /></IconButton>
        </div>
        <div className="scroll-soft min-h-0 flex-1 overflow-y-auto px-6 pb-8 sm:px-8">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
