import type { ReactNode } from 'react'
import { TONE, type Tone } from '../lib/present'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-3xl border border-line bg-surface shadow-soft', pad && 'p-5 sm:p-6', className)}>
      {children}
    </section>
  )
}

export function CardHead({ title, hint, right }: { title: string; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      {right}
    </div>
  )
}

export function Chip({ tone, children, size = 'sm', dot = true }: { tone: Tone; children: ReactNode; size?: 'sm' | 'md'; dot?: boolean }) {
  const t = TONE[tone]
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium', t.bg, t.fg,
      size === 'sm' ? 'px-2.5 py-0.5 text-[12px]' : 'px-3.5 py-1.5 text-[13px]')}>
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.hex }} />}
      {children}
    </span>
  )
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', className)} style={{ background: TONE[tone].hex }} />
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-full bg-sunken p-1">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}
          className={cx('rounded-full px-3 py-1 text-[12px] font-medium transition-colors',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink-2')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Paired horizontal bars: WeatherGuard vs legacy for one metric. */
export function CompareBars({ wg, legacy, max, fmt, better = 'high' }: {
  wg: number; legacy: number; max: number; fmt: (v: number) => string; better?: 'high' | 'low'
}) {
  const w = (v: number) => `${Math.max(2, Math.min(100, (v / (max || 1)) * 100))}%`
  const wgWins = better === 'high' ? wg >= legacy : wg <= legacy
  return (
    <div className="grid gap-1.5">
      <div className="grid grid-cols-[88px_1fr_52px] items-center gap-3 text-[12px]">
        <span className="text-ink-2">WeatherGuard</span>
        <span className="h-2 rounded-full bg-sunken"><span className="block h-2 rounded-full bg-accent transition-all duration-500" style={{ width: w(wg) }} /></span>
        <span className={cx('tnum text-right font-mono', wgWins ? 'text-accent' : 'text-ink-2')}>{fmt(wg)}</span>
      </div>
      <div className="grid grid-cols-[88px_1fr_52px] items-center gap-3 text-[12px]">
        <span className="text-muted">Legacy QC</span>
        <span className="h-2 rounded-full bg-sunken"><span className="block h-2 rounded-full bg-line-strong transition-all duration-500" style={{ width: w(legacy) }} /></span>
        <span className="tnum text-right font-mono text-muted">{fmt(legacy)}</span>
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-muted">{children}</div>
}
