import { ArrowRight, ArrowUpRight, Check, CloudLightning, TrendingDown, Wrench } from 'lucide-react'
import { STATIONS } from '../engine/engine'
import { workOrderId, type Insight } from '../lib/insights'
import { TONE, WMO_MEANING, confidence, narrative, span, stamp, statusOf, wmoFlags } from '../lib/present'
import { useConsole } from '../state/console'
import { GateStepper } from './Blocks'
import { toast } from './Toast'
import { AIBadge, Button, Chip, Drawer, cx } from './ui'

const KIND_ICON = { storm: CloudLightning, fault: Wrench, predictive: TrendingDown }
const LEGACY_TEXT: Record<Insight['legacy'], string> = {
  'false-alarm': 'Legacy QC rejected it',
  missed: 'Legacy QC missed it',
  blind: 'Legacy QC can’t see it',
  agrees: 'Legacy QC agrees',
}
const DONE_TEXT: Record<Insight['kind'], string> = { storm: 'Confirmed', fault: 'Work order dispatched', predictive: 'Visit scheduled' }

/** Neutral comparison tag: states a fact about legacy QC without shouting in red. */
function LegacyTag({ n }: { n: Insight }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line px-1.5 py-0.5 text-[11px] font-medium text-ink-2">
      <span className="h-1 w-1 rounded-full bg-muted" />{LEGACY_TEXT[n.legacy]}
    </span>
  )
}

function DoneTag({ n }: { n: Insight }) {
  return <Chip tone="ok" dot={false}><Check size={12} strokeWidth={2.6} />{DONE_TEXT[n.kind]}</Chip>
}

/** The primary AI surface: observation → evidence → context → next step. */
export function InsightCard({ insight: n, featured = false, onExplain, style }: {
  insight: Insight; featured?: boolean; onExplain: () => void; style?: React.CSSProperties
}) {
  const { k, handled } = useConsole()
  const done = n.id in handled
  const Icon = KIND_ICON[n.kind]
  const age = `${span(k - n.since + 1)}`

  if (!featured) {
    // Compact: the whole row is the button.
    return (
      <button type="button" onClick={onExplain} style={style} aria-label={`Explain: ${n.title}`}
        className={cx('rise group flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-left shadow-soft transition-[border-color,background-color,opacity] duration-200 hover:border-line-strong hover:bg-surface-2',
          done && 'opacity-60 hover:opacity-100')}>
        <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', TONE[n.tone].bg, TONE[n.tone].fg)}><Icon size={16} /></span>
        <span className="min-w-0 flex-1">
          <span className="t-h3 block text-ink">{n.title}</span>
          <span className="tnum mt-1 line-clamp-2 block text-[12.5px] text-ink-2">{n.evidence}</span>
          <span className="mt-2.5 flex flex-wrap items-center gap-2">
            {done ? <DoneTag n={n} /> : <LegacyTag n={n} />}
            <span className="t-caption text-muted">for {age}</span>
          </span>
        </span>
        <ArrowRight size={16} className="mt-1 shrink-0 text-muted transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-accent" />
      </button>
    )
  }

  return (
    <article style={style} className="ai-edge rise relative flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-soft sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <AIBadge>Top finding</AIBadge>
        {done ? <DoneTag n={n} /> : <LegacyTag n={n} />}
        <span className="t-caption ml-auto text-muted">for {age}</span>
      </div>

      <div className="mt-5 flex items-start gap-3.5">
        <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', TONE[n.tone].bg, TONE[n.tone].fg)}><Icon size={19} /></span>
        <div className="min-w-0">
          <h3 className="t-h2 text-ink sm:text-[20px]">{n.title}</h3>
          <p className="tnum mt-1.5 text-[13px] text-ink-2">{n.evidence}</p>
        </div>
      </div>

      <p className="t-small mt-5 text-ink-2">{n.context}</p>
      <GateStrip i={n.i} />

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-6">
        <Button variant="primary" onClick={onExplain} iconRight={<ArrowRight size={14} />}>Explain and act</Button>
        <span className="t-caption text-muted">{done ? 'Action recorded. Open to review.' : 'See every check behind this call'}</span>
      </div>
    </article>
  )
}

const GATE_TONE = { pass: 'ok', flag: 'fault', warn: 'warn', severe: 'storm', skip: 'off' } as const
const GATE_WORD = { pass: 'passed', flag: 'flagged', warn: 'warning', severe: 'real weather', skip: 'skipped' } as const

/** Compact read-out of the five checks for one station, in order. Status is in text, not colour alone. */
function GateStrip({ i }: { i: number }) {
  const { engine, k } = useConsole()
  const gates = engine.OUT[k][i].gates
  return (
    <ol className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Five-check result">
      {gates.slice(0, 5).map((g) => {
        const t = TONE[GATE_TONE[g.status]]
        return (
          <li key={g.id} title={g.text} className="min-w-0">
            <span className="block h-1 rounded-full" style={{ background: t.hex, opacity: g.status === 'skip' ? 0.35 : 1 }} />
            <span className="t-caption mt-1.5 block truncate text-ink-2">{g.name}</span>
            <span className={cx('t-caption block truncate', g.status === 'pass' ? 'text-muted' : t.fg)}>{GATE_WORD[g.status]}</span>
          </li>
        )
      })}
    </ol>
  )
}

/** Side drawer: the full reasoning for one insight and a single obvious next step. */
export function InsightDrawer({ insight: n, onClose }: { insight: Insight | null; onClose: () => void }) {
  const { engine: E, k, select, setView, handled, handle } = useConsole()
  if (!n) return <Drawer open={false} onClose={onClose} label="Insight">{null}</Drawer>
  const s = STATIONS[n.i], d = E.OUT[k][n.i], o = E.RAW[k][n.i], st = statusOf(d)
  const story = narrative(n.i, d, o), fl = wmoFlags(d)
  const done = n.id in handled
  const wo = workOrderId(E, n.i)
  const go = (v: typeof n.action.view) => { select(n.i); setView(v); onClose() }

  const act = () => {
    handle(n.id)
    if (n.kind === 'storm') {
      toast(`${s.name} observations confirmed`, { body: 'Kept in the forecast feed. CAP alert on record for IMD and NDMA.' })
    } else {
      toast(`${wo ?? 'Work order'} ${n.kind === 'fault' ? 'dispatched' : 'scheduled'}`, {
        body: `${s.name} · ${n.recommendation.split('.')[0]}`,
        action: { label: 'View in Maintenance', run: () => go('maintenance') },
      })
    }
    onClose()
  }

  return (
    <Drawer open onClose={onClose} label={`Insight: ${n.title}`}
      title={
        <div>
          <div className="flex flex-wrap items-center gap-2"><AIBadge>AI explanation</AIBadge><Chip tone={st.tone}>{st.label}</Chip></div>
          <h2 className="t-h2 mt-2.5 text-ink">{s.name}</h2>
          <p className="t-caption tnum mt-0.5 text-muted">{stamp(k)} IST · {s.elev} m · {s.lat.toFixed(2)}°N {s.lon.toFixed(2)}°E</p>
        </div>
      }
      footer={<>
        <Button variant="ghost" onClick={() => go('station')} iconRight={<ArrowUpRight size={14} />}>Full diagnosis</Button>
        {done
          ? <Button disabled icon={<Check size={14} />}>{DONE_TEXT[n.kind]}</Button>
          : <Button variant="primary" onClick={act} iconRight={<ArrowRight size={14} />}>{n.action.label}</Button>}
      </>}>
      <div className="typing flex flex-col gap-7">
        <section>
          <h3 className="eyebrow mb-2">What happened</h3>
          <p className="t-body text-ink">{story.title} {story.body}</p>
        </section>

        <section>
          <h3 className="eyebrow mb-2">Why WeatherGuard is confident</h3>
          <p className="t-small text-ink-2">{n.context}</p>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['Confidence', `${Math.round(confidence(d) * 100)}%`],
              ['WMO flag', `${fl.raw} → ${fl.clean}`],
              ['Output', WMO_MEANING[fl.clean]],
            ].map(([a, b]) => (
              <div key={a} className="rounded-xl bg-sunken px-3 py-2.5">
                <dt className="t-caption text-muted">{a}</dt>
                <dd className="t-num mt-0.5 text-[16px] capitalize text-ink">{b}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h3 className="eyebrow mb-3">Five checks, in order</h3>
          <GateStepper i={n.i} />
        </section>

        <section className="rounded-xl border border-accent/25 bg-accent-soft p-4">
          <h3 className="eyebrow mb-1.5 !text-accent">Recommended next step</h3>
          <p className="t-small text-ink">{n.recommendation}</p>
          {done && <p className="t-caption mt-2 font-medium text-ok">Done at {stamp(handled[n.id])}.</p>}
        </section>
      </div>
    </Drawer>
  )
}
