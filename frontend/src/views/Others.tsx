import { ArrowDownToLine } from 'lucide-react'
import { useState } from 'react'
import { FAULT_LABEL, STATIONS, latencies, metrics } from '../engine/engine'
import type { FaultType } from '../engine/types'
import { openOrders, WorkOrderCard } from '../components/Blocks'
import { Button, Card, CardHead, Chip, CompareBars, EmptyState, Notice, Segmented, Select, Skeleton, SkeletonRows, cx } from '../components/ui'
import { toast } from '../components/Toast'
import { hours, pct, stamp } from '../lib/present'
import { shiftReport } from '../lib/report'
import { api } from '../api/client'
import { useConsole } from '../state/console'

/* ---------------- Evaluation ---------------- */
export function Evaluation() {
  const { engine: E, k } = useConsole()
  const m = metrics(E, k)
  const lat = latencies(E, k)
  const tiles = [
    { label: 'Recall', sub: 'share of faulty readings caught', wg: m.wg.rec ?? 0, lg: m.lg.rec ?? 0, fmt: pct, max: 1, better: 'high' as const },
    { label: 'Precision', sub: 'share of flags that were real faults', wg: m.wg.prec ?? 0, lg: m.lg.prec ?? 0, fmt: pct, max: 1, better: 'high' as const },
    { label: 'False alarms', sub: 'good readings rejected', wg: m.wg.fp, lg: m.lg.fp, fmt: String, max: Math.max(m.wg.fp, m.lg.fp, 1), better: 'low' as const },
    { label: 'Storm readings rejected', sub: m.storm ? `of ${m.storm} genuine storm observations` : 'storm not arrived yet', wg: m.stormWg, lg: m.stormLeg, fmt: String, max: Math.max(m.stormWg, m.stormLeg, 1), better: 'low' as const },
  ]
  return (
    <div className="flex flex-col gap-20">
      <div className="grid gap-x-16 gap-y-14 md:grid-cols-2">
        {tiles.map((t) => (
          <Card key={t.label}>
            <h2 className="t-h3 text-ink">{t.label}</h2>
            <p className="t-caption mt-0.5 text-muted">{t.sub}</p>
            <div className="mt-8 flex items-baseline gap-4">
              <span className="t-figure text-[64px] text-ink">{t.fmt(t.wg)}</span>
              <span className="t-small text-muted">against <span className="tnum text-ink-2">{t.fmt(t.lg)}</span> for legacy QC</span>
            </div>
            <div className="mt-8"><CompareBars wg={t.wg} legacy={t.lg} max={t.max} fmt={t.fmt} better={t.better} /></div>
          </Card>
        ))}
      </div>

      <Benchmarks />

      <Card>
        <CardHead title="Detection latency per fault" hint="Time from when a fault first corrupts data to when each system flags it" />
        <div className="scroll-soft overflow-x-auto">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead><tr className="border-b border-line text-left text-[12.5px] text-muted">
              <th className="pb-3 font-normal">Fault</th><th className="pb-3 font-normal">Station</th><th className="pb-3 font-normal">Onset</th>
              <th className="pb-3 text-right font-normal">Legacy QC</th><th className="pb-3 text-right font-normal">WeatherGuard</th>
            </tr></thead>
            <tbody>
              {lat.map((l) => {
                const pending = l.onset < 0
                const wg = l.fault.type === 'power' && l.predictive >= 0 ? (l.onset >= 0 && l.predictive < l.onset ? `${hours(l.onset - l.predictive)} early` : 'warned early') : l.wg >= 0 ? hours(l.wg - l.onset) : pending ? '—' : 'pending'
                return (
                  <tr key={l.fi} className="border-b border-line">
                    <td className="py-3 text-ink">{FAULT_LABEL[l.fault.type]}{l.fault.user && <span className="ml-2 text-[12px] text-accent">yours</span>}</td>
                    <td className="py-3 text-ink-2">{STATIONS[l.i].name}</td>
                    <td className="tnum py-3 text-muted">{pending ? (k < l.fault.k0 ? 'scheduled' : 'not visible yet') : stamp(l.onset)}</td>
                    <td className={cx('tnum py-3 text-right', l.lg >= 0 ? 'text-ink-2' : 'text-fault')}>{pending ? '—' : l.lg >= 0 ? hours(l.lg - l.onset) : 'missed'}</td>
                    <td className="tnum py-3 text-right font-medium text-ink">{wg}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="t-small mt-5 max-w-[80ch] text-muted">Every reading is compared with the faults the simulator injected, so recall and precision are exact. Legacy QC applies WMO-style range, step (3 °C, 15% RH, 8 m/s per 15 min) and 4-hour persistence checks.</p>
      </Card>
    </div>
  )
}

function Benchmarks() {
  const { backend: b } = useConsole()
  const bm = b.model?.benchmarks, g = b.model?.gnn
  if (b.status !== 'online' || !bm) {
    const loading = b.status === 'checking' || b.waking || (b.status === 'online' && !b.model)
    return (
      <Card>
        <CardHead title="Benchmarks against literature methods" hint="Isolation Forest, LOF and One-Class SVM, trained on the same data" />
        {loading ? <SkeletonRows rows={5} /> : (
          <EmptyState title="Needs the backend">
            The benchmark table is computed during <span className="font-mono">python -m app.ml.train</span> and served by the API. Start the backend to load it.
          </EmptyState>
        )}
      </Card>
    )
  }
  const best = (k: 'recall' | 'precision') => Math.max(...bm.rows.map((r) => r[k]))
  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-20 xl:grid-cols-12 [&>*]:min-w-0">
      <Card className="xl:col-span-7">
        <CardHead title="Benchmarks against literature methods" hint={`${bm.observations.toLocaleString('en-IN')} observations · ${bm.faulty} faulty · ${bm.storm} genuine storm readings. Every model calibrated to the same 0.1% false-alarm budget.`} />
        <div className="scroll-soft overflow-x-auto">
          <table className="w-full min-w-[560px] text-[14px]">
            <thead><tr className="border-b border-line text-left text-[12.5px] text-muted">
              <th className="pb-3 font-normal">Method</th><th className="pb-3 font-normal">Type</th><th className="pb-3 text-right font-normal">Recall</th>
              <th className="pb-3 text-right font-normal">Precision</th><th className="pb-3 text-right font-normal">False alarms</th><th className="pb-3 text-right font-normal">Storm rejected</th>
            </tr></thead>
            <tbody className="tnum">
              {bm.rows.map((r) => {
                const us = r.method.startsWith('WeatherGuard')
                return (
                  <tr key={r.method} className={cx('border-b border-line', us && 'border-t-2 border-t-ink')}>
                    <td className={cx('py-3', us ? 'font-medium text-ink' : 'text-ink-2')}>{r.method}</td>
                    <td className="py-3 text-muted">{r.kind}</td>
                    <td className={cx('py-3 text-right', r.recall === best('recall') ? 'font-medium text-ink' : 'text-ink-2')}>{pct(r.recall)}</td>
                    <td className="py-3 text-right text-ink-2">{pct(r.precision)}</td>
                    <td className={cx('py-3 text-right', r.false_alarms ? 'text-fault' : 'text-ink-2')}>{r.false_alarms}</td>
                    <td className={cx('py-3 text-right', r.storm_rejected ? 'text-fault' : 'text-ink-2')}>{r.storm_rejected}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="t-small mt-5 max-w-[70ch] text-muted">Generic detectors see only numbers, so at a safe false-alarm rate they miss slow faults like drift, blockage and bearing wear. The physics gates, radar cross-check and trend detectors are what lift recall.</p>
      </Card>
      {g && (
        <Card className="xl:col-span-5">
          <CardHead title="ST-GNN against an inverse-distance check" hint="Error predicting a station from its neighbours on held-out scenarios (RMSE, lower is better)" />
          <div className="grid gap-7">
            {(['T', 'RH', 'P', 'W'] as const).map((v) => (
              <div key={v}>
                <div className="mb-3 flex justify-between text-[14px]"><span className="text-ink">{{ T: 'Temperature °C', RH: 'Humidity %', P: 'Pressure hPa', W: 'Wind m/s' }[v]}</span>
                  <span className="tnum text-[13px] text-ink-2">{Math.round((1 - g.rmse[v].st_gnn / g.rmse[v].idw) * 100)}% lower error</span></div>
                <CompareBars wg={g.rmse[v].st_gnn} legacy={g.rmse[v].idw} max={g.rmse[v].idw} fmt={(x) => x.toFixed(2)} better="low" labels={['ST-GNN', 'Inverse-dist.']} />
              </div>
            ))}
            <p className="t-caption text-muted">Physics-informed loss keeps {((1 - g.physics_violations) * 100).toFixed(1)}% of predictions below saturation (Clausius–Clapeyron).</p>
          </div>
        </Card>
      )}
    </div>
  )
}

/* ---------------- Maintenance ---------------- */
function ReportList({ title, items }: { title: string; items: [string | null, string][] }) {
  return (
    <div className="mt-8 border-t border-line pt-5">
      <h3 className="eyebrow">{title}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map(([who, what]) => (
          <li key={(who ?? '') + what} className="t-body text-ink-2">{who && <span className="text-ink">{who}: </span>}{what}</li>
        ))}
      </ul>
    </div>
  )
}

function ShiftReportCard() {
  const { engine: E, k, backend: b } = useConsole()
  const r = shiftReport(E, k)
  return (
    <div className="grid grid-cols-1 gap-x-16 gap-y-16 lg:grid-cols-12 [&>*]:min-w-0">
      {/* The shift report reads like a memo: headline, then short sections. */}
      <Card className="lg:col-span-8">
        <p className="eyebrow">Shift report, written automatically for the duty forecaster</p>
        <h2 className="tnum t-h2 mt-2 text-ink">{stamp(k)} IST</h2>
        <div className="typing mt-6 flex flex-col">
          <p className="t-lead text-ink">{r.headline}</p>
          <ReportList title="Last 24 hours" items={r.last24.map((x) => [null, x])} />
          {r.attention.length > 0 && <ReportList title="Needs field attention" items={r.attention} />}
          {r.predicted.length > 0 && <ReportList title="Predicted failures" items={r.predicted} />}
        </div>
      </Card>
      <Card className="lg:col-span-4">
        <CardHead title="Clean data export" hint="Quality-controlled observations up to now, with WMO QC flags and confidence, ready for NWP assimilation and archives" />
        {b.status === 'online' ? (
          <div className="flex flex-col border-t border-line">
            {([['csv', 'CSV', 'spreadsheets, quick checks'], ['netcdf', 'NetCDF (CF-1.8)', 'NWP pre-processing, climate archives'], ['json', 'JSON', 'APIs and dashboards']] as const).map(([f, l, d]) => (
              <a key={f} href={api.exportUrl(f, k)} onClick={() => toast(`Exporting ${l}`, { body: `Observations up to ${stamp(k)} with WMO QC flags`, kind: 'info' })}
                className="group flex items-center justify-between gap-3 border-b border-line py-4 transition-colors duration-150 hover:bg-sunken/70">
                <span><span className="block text-[14px] text-ink">{l}</span><span className="t-caption block text-muted">{d}</span></span>
                <ArrowDownToLine size={16} className="text-muted transition-colors group-hover:text-ink" />
              </a>
            ))}
            <p className="t-caption mt-4 text-muted">Flags: 0 good · 2 doubtful · 3 erroneous · 4 corrected · 9 missing.</p>
          </div>
        ) : b.status === 'checking' || b.waking ? <SkeletonRows rows={3} /> : (
          <EmptyState title="Exports need the backend">Start the FastAPI server to download CSV, NetCDF or JSON.</EmptyState>
        )}
      </Card>
    </div>
  )
}

export function Maintenance() {
  const { engine: E, k } = useConsole()
  const orders = openOrders(E, k)
  return (
    <div className="flex flex-col gap-20">
      <ShiftReportCard />
      <section className="border-t border-line pt-10">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="t-h1 text-ink">Open work orders <span className="tnum text-muted">{orders.length}</span></h2>
          <span className="t-small text-muted">Sorted by priority</span>
        </div>
      {orders.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{orders.map((l) => <WorkOrderCard key={l.fi} l={l} />)}</div>
      ) : <EmptyState title="No work orders yet">Faults appear here as soon as WeatherGuard confirms them. Press play, or break a station in the Fault lab.</EmptyState>}
      </section>
    </div>
  )
}

/* ---------------- Fault lab ---------------- */
const LAB: { type: FaultType; looks: string; caught: string }[] = [
  { type: 'flatline', looks: 'Temperature freezes at one value.', caught: 'Temporal check, within 90 minutes' },
  { type: 'drift', looks: 'Humidity creeps up 0.5% per hour.', caught: 'CUSUM against neighbours' },
  { type: 'spike', looks: 'Three ±10 °C spikes over three hours.', caught: 'Temporal and neighbour checks' },
  { type: 'blockage', looks: 'The rain gauge reads zero forever.', caught: 'Radar cross-check, once it rains' },
  { type: 'power', looks: 'The battery drains, then biases every sensor.', caught: 'Electrical check, predicted early' },
  { type: 'soiling', looks: 'The solar sensor reads 14% low.', caught: 'Clear-sky consistency, after ~3 h of daylight' },
  { type: 'bearing', looks: 'The anemometer slows 0.4% every 15 minutes, then stalls.', caught: 'Mechanical decay check, warned early' },
]

export function FaultLab() {
  const { inject, engine: E, k, select, toggle, playing } = useConsole()
  const [st, setSt] = useState('alibag')
  const [done, setDone] = useState<string | null>(null)
  const lat = latencies(E, Math.min(k + 96, 287)).filter((l) => l.fault.user)
  return (
    <div className="flex flex-col gap-20">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 className="t-h2 text-ink">1. Choose a station</h2>
            <p className="t-small mt-1.5 max-w-[60ch] text-muted">The failure starts at the next 15-minute reading. Then play the replay and watch it get found.</p>
          </div>
          <label className="flex items-center gap-3 text-[14px] text-ink-2">Station
            <Select value={st} onChange={(e) => setSt(e.target.value)} className="min-w-[180px]">
              {STATIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        </div>
        <h2 className="t-h2 mt-14 text-ink">2. Choose a failure</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {LAB.map((f) => (
            <div key={f.type} className="flex flex-col rounded-lg border border-line p-5 transition-colors duration-150 hover:border-line-strong">
              <span className="t-h3 text-ink">{FAULT_LABEL[f.type]}</span>
              <p className="t-small mt-2 text-ink-2">{f.looks}</p>
              <p className="t-caption mt-1 text-muted">Caught by: {f.caught}</p>
              <Button className="mt-5 self-start" size="sm" onClick={() => {
                const name = STATIONS.find((s) => s.id === st)?.name
                inject(st, f.type)
                setDone(`${FAULT_LABEL[f.type]} injected at ${name}.`)
                toast(`${FAULT_LABEL[f.type]} injected`, { body: `${name} · starts at the next 15-minute reading`, action: playing ? undefined : { label: 'Play stream', run: toggle } })
              }}>
                Inject at {STATIONS.find((s) => s.id === st)?.name.split(' ')[0]}
              </Button>
            </div>
          ))}
        </div>
        {done && (
          <div className="rise mt-8"><Notice tone="off" action={!playing && <Button size="sm" variant="primary" onClick={toggle}>Play the replay</Button>}>{done} Play the replay and watch it get found.</Notice></div>
        )}
      </Card>

      <Card>
        <CardHead title="Your injected faults" hint="Status updates as the replay plays." />
        {lat.length ? (
          <ul className="border-t border-line">
            {lat.map((l) => {
              const detected = (l.wg >= 0 && l.wg <= k) || (l.predictive >= 0 && l.predictive <= k)
              const at = l.fault.type === 'power' && l.predictive >= 0 ? l.predictive : l.wg
              return (
                <li key={l.fi} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4">
                  <button type="button" onClick={() => select(l.i, true)} className="text-left">
                    <span className="block text-[14px] text-ink">{FAULT_LABEL[l.fault.type]}</span>
                    <span className="t-caption block text-muted">{STATIONS[l.i].name} · starts {stamp(l.fault.k0)}</span>
                  </button>
                  {detected ? <Chip tone="ok">Detected {stamp(at)}</Chip> : k < l.fault.k0 ? <Chip tone="off">Starts next reading</Chip> : <Chip tone="warn">Watching</Chip>}
                </li>
              )
            })}
          </ul>
        ) : <EmptyState title="Nothing injected yet">Choose a failure above. Its status updates here as the replay plays.</EmptyState>}
      </Card>
    </div>
  )
}

/* ---------------- Architecture ---------------- */
const TIERS = [
  { n: '01', t: 'Edge acquisition', d: 'T, RH, pressure, rain, wind, solar and battery telemetry every 15 min; 1-min burst mode in storms. TinyML pre-filter on the RTU.', live: 'Edge pre-filter per observation: range, rate-of-change, battery, cabinet temperature; 1-min burst mode in storms. Models run on ONNX Runtime; LSTM-AE quantised to a 22 KB int8 ONNX file for the RTU.' },
  { n: '02', t: 'Ingestion', d: 'MQTT gateway into Kafka, raw store in TimescaleDB.', live: 'HTTPS ingest endpoint, Kafka/Redpanda producer + QC worker writing to TimescaleDB (in-memory + SQLite for laptops).' },
  { n: '03', t: 'Multi-modal context', d: 'INSAT-3D/3DR cloud-top, Doppler radar reflectivity, DEM elevation.', live: 'Radar dBZ → rain via Marshall–Palmer Z = 200R^1.6, cloud-top temperature, station elevation.' },
  { n: '04', t: 'Physics-informed models', d: 'Electrical decoupling, physics gate, ST-GNN buddy check, drift and radar verifiers, LSTM-autoencoder.', live: 'Clausius–Clapeyron + Magnus–Tetens gate, ST-GNN buddy check, CUSUM drift, bearing-wear decay engine, LSTM-autoencoder.' },
  { n: '05', t: 'Delivery', d: 'Clean WMO-flagged observations for NWP, forecaster console, maintenance dispatch.', live: 'WMO QC flags, CSV/NetCDF/JSON export, CAP alerts, shift report, virtual sensor, work orders.' },
]

function ModelCardView() {
  const { backend: b } = useConsole()
  const m = b.model
  if (b.status === 'checking' || (b.status === 'online' && !m)) {
    return (
      <Card>
        <CardHead title="ST-GNN + LSTM-autoencoder" hint="Loading the live model card…" />
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">{Array.from({ length: 8 }, (_, j) => <Skeleton key={j} className="h-4" />)}</div>
      </Card>
    )
  }
  if (b.status !== 'online' || !m?.trained) {
    return (
      <Card>
        <CardHead title="ST-GNN + LSTM-autoencoder" hint="Model card appears when the FastAPI backend is running" />
        <pre className="scroll-soft overflow-x-auto rounded-md bg-sunken p-5 font-mono text-[12.5px] text-ink-2">{`cd weatherguard-backend
pip install -r requirements.txt
python -m app.ml.train_gnn      # ST-GNN, ~2 min on a laptop CPU
python -m app.ml.train          # LSTM-AE + benchmarks, ~2 min
uvicorn app.main:app --port 8000`}</pre>
      </Card>
    )
  }
  const g = m.gnn
  const rows: [string, string][] = [
    ...(g ? [
      ['ST-GNN', `Graph attention, ${g.heads} heads, ${g.params.toLocaleString('en-IN')} params; inputs: neighbours now + 15 min ago, DEM elevation, geometry`] as [string, string],
      ['ST-GNN accuracy', `T ${g.rmse.T.st_gnn} °C vs ${g.rmse.T.idw} inverse-distance · RH ${g.rmse.RH.st_gnn}% vs ${g.rmse.RH.idw}%`] as [string, string],
      ['Physics-informed loss', 'Saturation bound (Clausius–Clapeyron), vapour-pressure continuity, non-negative wind'] as [string, string],
    ] : []),
    ['LSTM-autoencoder', `LSTM encoder → ${m.params?.toLocaleString('en-IN')} params → LSTM decoder`],
    ['Input window', `${m.window} steps (${(m.window ?? 0) / 4} h) × 5 residual features`],
    ['Training data', `${m.train_windows?.toLocaleString('en-IN')} windows from ${m.scenarios} fault-free storm scenarios`],
    ['Threshold', `99.9th percentile of held-out normal error (${m.threshold?.toFixed(3)})`],
    ['ROC-AUC, faults vs normal', `${m.eval?.roc_auc_fault_vs_normal.toFixed(3)} on the demo run (model score alone)`],
    ['Edge export', m.onnx_bytes ? `ONNX ${(m.onnx_bytes / 1024).toFixed(0)} KB · int8 ${m.int8_onnx_bytes ? (m.int8_onnx_bytes / 1024).toFixed(0) : '—'} KB (score correlation ${m.int8_score_correlation ?? '—'}) — inside the <200 KB TinyML budget` : 'ONNX export unavailable'],
    ['Server runtime', m.runtime === 'onnxruntime' ? 'ONNX Runtime (no PyTorch on the server)' : m.runtime ?? '—'],
    ['Trained', m.trained_at?.replace('T', ' ') ?? '—'],
  ]
  return (
    <Card>
      <CardHead title="Models" hint={`Live model card, served by ${b.url || 'this server'}`} right={<div className="flex items-center gap-5"><a href={api.docsUrl} className="link text-[14px]">API docs</a><Chip tone="ok">Live</Chip></div>} />
      <dl className="grid text-[14px] sm:grid-cols-[240px_1fr]">
        {rows.map(([a, v]) => <div key={a} className="contents"><dt className="border-t border-line py-3 text-muted">{a}</dt><dd className="border-line py-3 text-ink sm:border-t">{v}</dd></div>)}
      </dl>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6">
        <span className="t-small text-ink-2">Detection engine</span>
        <Segmented label="Detection engine" value={b.want} onChange={b.setWant} options={[{ value: 'api', label: 'Server' }, { value: 'browser', label: 'In-browser' }]} />
        <span className="t-caption text-muted">Switch to compare the Python models with the TypeScript fallback.</span>
      </div>
    </Card>
  )
}

export function Architecture() {
  return (
    <div className="flex flex-col gap-20">
      <section aria-label="The five tiers">
        <ol className="grid gap-x-10 gap-y-12 md:grid-cols-2 xl:grid-cols-5">
          {TIERS.map((t) => (
            <li key={t.n} className="flex flex-col border-t border-ink pt-5">
              <span className="tnum t-caption text-muted">{t.n}</span>
              <h3 className="t-h3 mt-3 text-ink">{t.t}</h3>
              <p className="t-small mt-2 text-ink-2">{t.d}</p>
              <p className="t-caption mt-auto border-t border-line pt-4 text-muted"><span className="text-ink-2">In this build: </span>{t.live}</p>
            </li>
          ))}
        </ol>
      </section>
      <ModelCardView />
      <Card>
        <CardHead title="Backend contract" hint="The UI already consumes this shape. The FastAPI service will return the same JSON per observation." />
        <pre className="scroll-soft overflow-x-auto rounded-md bg-sunken p-5 font-mono text-[12.5px] leading-relaxed text-ink-2">{`GET /api/v1/observations/{station_id}?at=2026-07-15T13:30+05:30
{
  "station": { "id": "lonavala", "name": "Lonavala", "lat": 18.75, "lon": 73.41, "elev": 622 },
  "raw":   { "T": 28.2, "RH": 89.9, "P": 935.8, "W": 17.1, "S": 191, "R": 12.1, "V": 12.62 },
  "verdict": {
    "cls": "SEVERE",                       // VALID | SEVERE | FLATLINE | DRIFT | BLOCKAGE | ...
    "gates": [ { "id": "R", "status": "severe", "text": "Explained by real weather: radar 49 dBZ ..." } ],
    "z": { "T": 5.1, "RH": 4.4, "P": -2.3, "W": 8.8 },
    "expected": { "T": 25.8, "RH": 78.4, "P": 936.8 },
    "clean": { "T": 28.2, "RH": 89.9, "R": 12.1 },
    "score": 32.9
  },
  "legacy": { "flag": true, "why": "Step check: T changed -3.2 °C in 15 min" }
}`}</pre>
      </Card>
    </div>
  )
}
