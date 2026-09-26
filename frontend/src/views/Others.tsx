import { Activity, BatteryLow, FlaskConical, Wrench, CloudRain, Database, Download, Droplets, FileText, Radar, Satellite, Server, Sun, ThermometerSnowflake, Wind, Workflow, Zap } from 'lucide-react'
import { useState } from 'react'
import { FAULT_LABEL, STATIONS, latencies, metrics } from '../engine/engine'
import type { FaultType } from '../engine/types'
import { openOrders, WorkOrderCard } from '../components/Blocks'
import { AIBadge, Button, Card, CardHead, Chip, CompareBars, EmptyState, Select, Skeleton, SkeletonRows, cx } from '../components/ui'
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
    <div className="fade-in flex flex-col gap-5">
      <div className="grid gap-5 md:grid-cols-2">
        {tiles.map((t) => {
          const wgBetter = t.better === 'high' ? t.wg >= t.lg : t.wg <= t.lg
          return (
            <Card key={t.label} className="rise">
              <div className="flex items-start justify-between gap-3">
                <div><h2 className="t-h3">{t.label}</h2><p className="t-caption mt-0.5 text-muted">{t.sub}</p></div>
                {wgBetter && <Chip tone="ok" dot={false}>WeatherGuard ahead</Chip>}
              </div>
              <div className="mt-5 flex items-baseline gap-3">
                <span className="t-num text-[44px] leading-none text-ink">{t.fmt(t.wg)}</span>
                <span className="t-small text-muted">vs <span className="tnum font-medium text-ink-2">{t.fmt(t.lg)}</span> legacy</span>
              </div>
              <div className="mt-5"><CompareBars wg={t.wg} legacy={t.lg} max={t.max} fmt={t.fmt} better={t.better} /></div>
            </Card>
          )
        })}
      </div>

      <Benchmarks />

      <Card>
        <CardHead title="Detection latency per fault" hint="Time from when a fault first corrupts data to when each system flags it" />
        <div className="scroll-soft overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead><tr className="text-left text-[11.5px] text-muted">
              <th className="pb-2 font-normal">Fault</th><th className="pb-2 font-normal">Station</th><th className="pb-2 font-normal">Onset</th>
              <th className="pb-2 text-right font-normal">Legacy QC</th><th className="pb-2 text-right font-normal">WeatherGuard</th>
            </tr></thead>
            <tbody>
              {lat.map((l) => {
                const pending = l.onset < 0
                const wg = l.fault.type === 'power' && l.predictive >= 0 ? (l.onset >= 0 && l.predictive < l.onset ? `${hours(l.onset - l.predictive)} early` : 'warned early') : l.wg >= 0 ? hours(l.wg - l.onset) : pending ? '—' : 'pending'
                return (
                  <tr key={l.fi} className="border-t border-line">
                    <td className="py-2.5 text-ink">{FAULT_LABEL[l.fault.type]}{l.fault.user && <span className="ml-2 text-[11px] text-accent">yours</span>}</td>
                    <td className="py-2.5 text-ink-2">{STATIONS[l.i].name}</td>
                    <td className="tnum py-2.5 font-mono text-muted">{pending ? (k < l.fault.k0 ? 'scheduled' : 'not visible yet') : stamp(l.onset)}</td>
                    <td className={cx('tnum py-2.5 text-right font-mono', l.lg >= 0 ? 'text-ink-2' : 'text-fault')}>{pending ? '—' : l.lg >= 0 ? hours(l.lg - l.onset) : 'missed'}</td>
                    <td className="tnum py-2.5 text-right font-mono text-accent">{wg}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[12.5px] leading-relaxed text-muted">Every reading is compared with the faults the simulator injected, so recall and precision are exact. Legacy QC applies WMO-style range, step (3 °C, 15% RH, 8 m/s per 15 min) and 4-hour persistence checks.</p>
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
          <EmptyState icon={<Server size={18} />} title="Needs the backend">
            The benchmark table is computed during <span className="font-mono">python -m app.ml.train</span> and served by the API. Start the backend to load it.
          </EmptyState>
        )}
      </Card>
    )
  }
  const best = (k: 'recall' | 'precision') => Math.max(...bm.rows.map((r) => r[k]))
  return (
    <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <Card>
        <CardHead title="Benchmarks against literature methods" hint={`${bm.observations.toLocaleString('en-IN')} observations · ${bm.faulty} faulty · ${bm.storm} genuine storm readings. Every model calibrated to the same 0.1% false-alarm budget.`} />
        <div className="scroll-soft overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead><tr className="text-left text-[11.5px] text-muted">
              <th className="pb-2 font-normal">Method</th><th className="pb-2 font-normal">Type</th><th className="pb-2 text-right font-normal">Recall</th>
              <th className="pb-2 text-right font-normal">Precision</th><th className="pb-2 text-right font-normal">False alarms</th><th className="pb-2 text-right font-normal">Storm rejected</th>
            </tr></thead>
            <tbody className="tnum">
              {bm.rows.map((r) => {
                const us = r.method.startsWith('WeatherGuard')
                return (
                  <tr key={r.method} className={cx('border-t border-line', us && 'bg-accent-soft/60')}>
                    <td className={cx('py-2.5 pl-2', us ? 'font-semibold text-ink' : 'text-ink')}>{r.method}</td>
                    <td className="py-2.5 text-muted">{r.kind}</td>
                    <td className={cx('py-2.5 text-right font-mono', r.recall === best('recall') ? 'text-accent' : 'text-ink-2')}>{pct(r.recall)}</td>
                    <td className="py-2.5 text-right font-mono text-ink-2">{pct(r.precision)}</td>
                    <td className={cx('py-2.5 text-right font-mono', r.false_alarms ? 'text-fault' : 'text-ink-2')}>{r.false_alarms}</td>
                    <td className={cx('py-2.5 pr-2 text-right font-mono', r.storm_rejected ? 'text-fault' : 'text-ink-2')}>{r.storm_rejected}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12.5px] text-muted">Generic detectors see only numbers, so at a safe false-alarm rate they miss slow faults like drift, blockage and bearing wear. The physics gates, radar cross-check and trend detectors are what lift recall.</p>
      </Card>
      {g && (
        <Card>
          <CardHead title="ST-GNN vs inverse-distance buddy check" hint="Error predicting a station from its neighbours on held-out scenarios (RMSE, lower is better)" />
          <div className="grid gap-4">
            {(['T', 'RH', 'P', 'W'] as const).map((v) => (
              <div key={v}>
                <div className="mb-1.5 flex justify-between text-[13px]"><span>{{ T: 'Temperature °C', RH: 'Humidity %', P: 'Pressure hPa', W: 'Wind m/s' }[v]}</span>
                  <span className="text-[12px] text-accent">{Math.round((1 - g.rmse[v].st_gnn / g.rmse[v].idw) * 100)}% lower error</span></div>
                <CompareBars wg={g.rmse[v].st_gnn} legacy={g.rmse[v].idw} max={g.rmse[v].idw} fmt={(x) => x.toFixed(2)} better="low" labels={['ST-GNN', 'Inverse-dist.']} />
              </div>
            ))}
            <p className="text-[12px] text-muted"> Physics-informed loss keeps {((1 - g.physics_violations) * 100).toFixed(1)}% of predictions below saturation (Clausius–Clapeyron).</p>
          </div>
        </Card>
      )}
    </div>
  )
}

/* ---------------- Maintenance ---------------- */
function ShiftReportCard() {
  const { engine: E, k, backend: b } = useConsole()
  const r = shiftReport(E, k)
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
      <Card>
        <CardHead eyebrow={<AIBadge>Written by WeatherGuard</AIBadge>} title={`Shift report · ${stamp(k)} IST`} hint="For the forecaster on duty. Updates as the stream plays." right={<FileText size={18} className="text-muted" />} />
        <div className="typing flex flex-col gap-5 text-[13.5px] leading-relaxed">
          <p className="t-body text-[15px] text-ink">{r.headline}</p>
          <div><div className="eyebrow mb-1.5">Last 24 hours</div><ul className="list-disc space-y-1 pl-5 text-ink-2">{r.last24.map((x) => <li key={x}>{x}</li>)}</ul></div>
          {r.attention.length > 0 && <div><div className="eyebrow mb-1.5">Needs field attention</div><ul className="list-disc space-y-1 pl-5 text-ink-2">{r.attention.map(([n, l]) => <li key={n}><span className="text-ink">{n}</span>: {l}</li>)}</ul></div>}
          {r.predicted.length > 0 && <div><div className="eyebrow mb-1.5">Predicted failures</div><ul className="list-disc space-y-1 pl-5 text-ink-2">{r.predicted.map(([n, l]) => <li key={n}><span className="text-ink">{n}</span>: {l}</li>)}</ul></div>}
        </div>
      </Card>
      <Card>
        <CardHead title="Clean data export" hint="Quality-controlled observations up to now, with WMO QC flags and confidence, ready for NWP assimilation and archives" />
        {b.status === 'online' ? (
          <div className="flex flex-col gap-2">
            {([['csv', 'CSV', 'spreadsheets, quick checks'], ['netcdf', 'NetCDF (CF-1.8)', 'NWP pre-processing, climate archives'], ['json', 'JSON', 'APIs and dashboards']] as const).map(([f, l, d]) => (
              <a key={f} href={api.exportUrl(f, k)} onClick={() => toast(`Exporting ${l}`, { body: `Observations up to ${stamp(k)} with WMO QC flags`, kind: 'info' })}
                className="group flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 transition-colors duration-150 hover:border-accent/60 hover:bg-surface-2">
                <span><span className="block text-[13.5px] font-medium text-ink">{l}</span><span className="block text-[12px] text-muted">{d}</span></span>
                <Download size={16} className="text-muted transition-colors group-hover:text-accent" />
              </a>
            ))}
            <p className="mt-1 text-[11.5px] text-muted">Flags: 0 good · 2 doubtful · 3 erroneous · 4 corrected · 9 missing.</p>
          </div>
        ) : b.status === 'checking' || b.waking ? <SkeletonRows rows={3} /> : (
          <EmptyState icon={<Download size={18} />} title="Exports need the backend">Start the FastAPI server to download CSV, NetCDF or JSON.</EmptyState>
        )}
      </Card>
    </div>
  )
}

export function Maintenance() {
  const { engine: E, k } = useConsole()
  const orders = openOrders(E, k)
  return (
    <div className="fade-in flex flex-col gap-5">
      <ShiftReportCard />
      {orders.length > 0 && (
        <div className="-mb-1 mt-2 flex items-baseline justify-between gap-3">
          <h2 className="t-h2">Open work orders <span className="tnum font-normal text-muted">· {orders.length}</span></h2>
          <span className="t-caption text-muted">Sorted by priority</span>
        </div>
      )}
      {orders.length ? (
        <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">{orders.map((l) => <WorkOrderCard key={l.fi} l={l} />)}</div>
      ) : <EmptyState icon={<Wrench size={18} />} title="No work orders yet">Faults appear here as soon as WeatherGuard confirms them. Press play, or break a station in the Fault lab.</EmptyState>}
    </div>
  )
}

/* ---------------- Fault lab ---------------- */
const LAB: { type: FaultType; icon: typeof Zap; looks: string; caught: string }[] = [
  { type: 'flatline', icon: ThermometerSnowflake, looks: 'Temperature freezes at one value.', caught: 'Temporal gate, within 90 min' },
  { type: 'drift', icon: Droplets, looks: 'Humidity creeps up 0.5% per hour.', caught: 'CUSUM against neighbours' },
  { type: 'spike', icon: Activity, looks: 'Three ±10 °C spikes over 3 hours.', caught: 'Temporal + buddy check' },
  { type: 'blockage', icon: CloudRain, looks: 'Rain gauge reads zero forever.', caught: 'Radar cross-check, when it rains' },
  { type: 'power', icon: BatteryLow, looks: 'Battery drains, then biases every sensor.', caught: 'Electrical gate, predicted early' },
  { type: 'soiling', icon: Sun, looks: 'Solar sensor reads 14% low.', caught: 'Clear-sky consistency, after ~3 h of daylight' },
  { type: 'bearing', icon: Wind, looks: 'Anemometer slows by 0.4% per 15 min, then stalls.', caught: 'Mechanical decay engine, warned early' },
]

export function FaultLab() {
  const { inject, engine: E, k, select, toggle, playing } = useConsole()
  const [st, setSt] = useState('alibag')
  const [done, setDone] = useState<string | null>(null)
  const lat = latencies(E, Math.min(k + 96, 287)).filter((l) => l.fault.user)
  return (
    <div className="fade-in flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="t-h2">Break a station</h2>
            <p className="t-small mt-1 max-w-[60ch] text-muted">Pick a station and a failure. It starts at the next 15-minute reading. Then press play and watch WeatherGuard find it.</p>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">Station
            <Select value={st} onChange={(e) => setSt(e.target.value)} className="min-w-[180px]">
              {STATIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {LAB.map((f) => (
            <div key={f.type} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-2 p-4 transition-colors duration-150 hover:border-line-strong">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-fault-soft text-fault"><f.icon size={17} /></span>
                <span className="t-h3">{FAULT_LABEL[f.type]}</span>
              </div>
              <p className="t-small text-ink-2">{f.looks}</p>
              <p className="t-caption text-muted">Caught by: {f.caught}</p>
              <Button className="mt-auto w-full" onClick={() => {
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
          <div className="rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[13px]" role="status">
            <span className="text-ink">{done} Press play and watch the pipeline find it.</span>
            {!playing && <Button size="sm" variant="primary" onClick={toggle}>Play stream</Button>}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="Your injected faults" hint="Status updates as the stream plays" />
        {lat.length ? (
          <ul className="divide-y divide-line">
            {lat.map((l) => {
              const detected = (l.wg >= 0 && l.wg <= k) || (l.predictive >= 0 && l.predictive <= k)
              const at = l.fault.type === 'power' && l.predictive >= 0 ? l.predictive : l.wg
              return (
                <li key={l.fi} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <button type="button" onClick={() => select(l.i, true)} className="text-left">
                    <span className="block text-[13.5px] font-medium">{FAULT_LABEL[l.fault.type]}</span>
                    <span className="block text-[12px] text-muted">{STATIONS[l.i].name} · starts {stamp(l.fault.k0)}</span>
                  </button>
                  {detected ? <Chip tone="ok">Detected {stamp(at)}</Chip> : k < l.fault.k0 ? <Chip tone="off">Starts next reading</Chip> : <Chip tone="warn">Watching</Chip>}
                </li>
              )
            })}
          </ul>
        ) : <EmptyState icon={<FlaskConical size={18} />} title="Nothing injected yet">Pick a failure above. Its status will update here as the stream plays.</EmptyState>}
      </Card>
    </div>
  )
}

/* ---------------- Architecture ---------------- */
const TIERS = [
  { n: 'Tier 1', t: 'Edge acquisition', icon: Satellite, d: 'T, RH, pressure, rain, wind, solar and battery telemetry every 15 min; 1-min burst mode in storms. TinyML pre-filter on the RTU.', live: 'Edge pre-filter per observation: range, rate-of-change, battery, cabinet temperature; 1-min burst mode in storms. Models run on ONNX Runtime; LSTM-AE quantised to a 22 KB int8 ONNX file for the RTU.' },
  { n: 'Tier 2', t: 'Ingestion', icon: Server, d: 'MQTT gateway into Kafka, raw store in TimescaleDB.', live: 'HTTPS ingest endpoint, Kafka/Redpanda producer + QC worker writing to TimescaleDB (in-memory + SQLite for laptops).' },
  { n: 'Tier 3', t: 'Multi-modal context', icon: Radar, d: 'INSAT-3D/3DR cloud-top, Doppler radar reflectivity, DEM elevation.', live: 'Radar dBZ → rain via Marshall–Palmer Z = 200R^1.6, cloud-top temperature, station elevation.' },
  { n: 'Tier 4', t: 'Physics-informed AI', icon: Workflow, d: 'Electrical decoupling, physics gate, ST-GNN buddy check, drift and radar verifiers, LSTM-autoencoder.', live: 'Clausius–Clapeyron + Magnus–Tetens gate, ST-GNN buddy check, CUSUM drift, bearing-wear decay engine, LSTM-autoencoder.' },
  { n: 'Tier 5', t: 'Delivery', icon: Database, d: 'Clean WMO-flagged observations for NWP, forecaster console, maintenance dispatch.', live: 'WMO QC flags, CSV/NetCDF/JSON export, CAP alerts, shift report, virtual sensor, work orders.' },
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
        <pre className="scroll-soft overflow-x-auto rounded-xl bg-sunken p-4 font-mono text-[12px] text-ink-2">{`cd weatherguard-backend
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
      <CardHead title="Models · live model card" hint={`Served by ${b.url}`} right={<div className="flex items-center gap-3"><a href={api.docsUrl} className="text-[12.5px] text-accent hover:underline">API docs</a><Chip tone="ok">Live</Chip></div>} />
      <dl className="grid gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-[220px_1fr]">
        {rows.map(([a, v]) => <div key={a} className="contents"><dt className="text-muted">{a}</dt><dd className="text-ink">{v}</dd></div>)}
      </dl>
    </Card>
  )
}

export function Architecture() {
  return (
    <div className="fade-in flex flex-col gap-5">
      <ModelCardView />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {TIERS.map((t) => (
          <Card key={t.n} className="rise flex flex-col gap-3 !p-5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent"><t.icon size={18} /></span>
            <div><div className="eyebrow">{t.n}</div><h3 className="t-h3 mt-1">{t.t}</h3></div>
            <p className="t-small text-ink-2">{t.d}</p>
            <div className="mt-auto rounded-lg bg-sunken p-3 text-[12.5px] text-ink"><span className="font-medium text-accent">In this build: </span>{t.live}</div>
          </Card>
        ))}
      </div>
      <Card>
        <CardHead title="Backend contract" hint="The UI already consumes this shape. The FastAPI service will return the same JSON per observation." />
        <pre className="scroll-soft overflow-x-auto rounded-xl bg-sunken p-4 font-mono text-[12px] leading-relaxed text-ink-2">{`GET /api/v1/observations/{station_id}?at=2026-07-15T13:30+05:30
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
