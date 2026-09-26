import { ArrowRight } from 'lucide-react'
import { STATIONS } from '../engine/engine'
import { workOrderId, type Insight } from '../lib/insights'
import { TONE, WMO_MEANING, confidence, narrative, span, stamp, statusOf, wmoFlags } from '../lib/present'
import { useConsole } from '../state/console'
import { GateStepper } from './Blocks'
import { toast } from './Toast'
import { Button, Chip, Drawer, cx } from './ui'

const LEGACY_TEXT: Record<Insight['legacy'], string> = {
  'false-alarm': 'Legacy QC rejected it',
  missed: 'Legacy QC missed it',
  blind: 'Legacy QC can’t see it',
  agrees: 'Legacy QC agrees',
}
const DONE_TEXT: Record<Insight['kind'], string> = { storm: 'Confirmed', fault: 'Work order dispatched', predictive: 'Visit scheduled' }

/**
 * One finding as a line in a list: what's wrong, the evidence, how legacy QC fared.
 * The intelligence is in the sentence, not in a badge.
 */
export function InsightRow({ insight: n, onOpen, style }: { insight: Insight; onOpen: () => void; style?: React.CSSProperties }) {
  const { k, handled } = useConsole()
  const done = n.id in handled
  return (
    <li style={style} className="rise">
      <button type="button" onClick={onOpen} aria-label={`Review: ${n.title}`}
        className={cx('group grid w-full grid-cols-[10px_1fr_auto] items-baseline gap-x-4 gap-y-1 border-b border-line py-5 text-left transition-colors duration-150 hover:bg-sunken/60 sm:grid-cols-[10px_1fr_200px_auto] sm:px-2 sm:-mx-2',
          done && 'opacity-55 hover:opacity-100')}>
        <span className="h-1.5 w-1.5 translate-y-[-2px] rounded-full" style={{ background: TONE[n.tone].hex }} />
        <span className="min-w-0">
          <span className="t-h3 block text-ink">{n.title}</span>
          <span className="tnum t-small mt-1 block text-muted">{n.evidence}</span>
        </span>
        <span className="t-caption col-start-2 text-muted sm:col-start-auto sm:text-right">
          {done ? <span className="text-ok">{DONE_TEXT[n.kind]}</span> : LEGACY_TEXT[n.legacy]}
          <span className="block">for {span(k - n.since + 1)}</span>
        </span>
        <span className="row-start-1 col-start-3 flex items-center gap-1 text-[13px] text-muted transition-colors group-hover:text-ink sm:col-start-4">
          <span className="hidden sm:inline">Review</span><ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        </span>
      </button>
    </li>
  )
}

/** The reasoning for one finding, read like a short document, with one obvious next step. */
export function InsightDrawer({ insight: n, onClose }: { insight: Insight | null; onClose: () => void }) {
  const { engine: E, k, select, setView, handled, handle } = useConsole()
  if (!n) return <Drawer open={false} onClose={onClose} label="Finding">{null}</Drawer>
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
    <Drawer open onClose={onClose} label={`Finding: ${n.title}`}
      title={
        <div>
          <p className="tnum t-caption text-muted">{s.name} · {stamp(k)} IST · {s.elev} m</p>
          <h2 className="t-h2 mt-2 text-ink">{n.title}</h2>
          <div className="mt-3"><Chip tone={st.tone} size="md">{st.label}</Chip></div>
        </div>
      }
      footer={<>
        <Button variant="ghost" onClick={() => go('station')}>Open full diagnosis</Button>
        {done
          ? <Button disabled>{DONE_TEXT[n.kind]}</Button>
          : <Button variant="primary" onClick={act} iconRight={<ArrowRight size={14} />}>{n.action.label}</Button>}
      </>}>
      <div className="typing flex flex-col">
        <section className="border-t border-line py-6">
          <h3 className="eyebrow mb-2">What happened</h3>
          <p className="t-body text-ink">{story.title} {story.body}</p>
        </section>

        <section className="border-t border-line py-6">
          <h3 className="eyebrow mb-2">Why this call</h3>
          <p className="t-small text-ink-2">{n.context}</p>
          <dl className="mt-5 grid grid-cols-3 gap-4">
            {[
              ['Confidence', `${Math.round(confidence(d) * 100)}%`],
              ['WMO flag', `${fl.raw} → ${fl.clean}`],
              ['Sent downstream', WMO_MEANING[fl.clean]],
            ].map(([a, b]) => (
              <div key={a}>
                <dt className="t-caption text-muted">{a}</dt>
                <dd className="t-figure mt-1.5 text-[22px] capitalize text-ink">{b}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="border-t border-line py-6">
          <h3 className="eyebrow mb-4">The five checks, in order</h3>
          <GateStepper i={n.i} />
        </section>

        <section className="border-t border-line pt-6">
          <h3 className="eyebrow mb-2">Next step</h3>
          <p className="t-body text-ink">{n.recommendation}</p>
          {done && <p className="t-small mt-2 text-ok">Done at {stamp(handled[n.id])}.</p>}
        </section>
      </div>
    </Drawer>
  )
}
