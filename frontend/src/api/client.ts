import type { EngineResult } from '../engine/engine'
import type { Fault } from '../engine/types'

/** Backend base URL. Set VITE_API_URL in .env to point elsewhere. */
// Dev: separate FastAPI on :8000. Production: same origin (FastAPI serves this app) unless VITE_API_URL is set.
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? 'http://localhost:8000' : '')

export interface Health { status: string; version: string; scorer: 'lstm-autoencoder' | 'pca'; spatial: 'st-gnn' | 'idw'; runtime?: string; stations: number }
export interface ModelCard {
  trained: boolean
  name?: string; version?: string; params?: number; window?: number; threshold?: number
  train_windows?: number; scenarios?: number; epochs?: number; onnx_bytes?: number; trained_at?: string
  eval?: { roc_auc_fault_vs_normal: number; anomaly_false_positives: number; pipeline_false_positives: number }
  spatial?: string
  runtime?: string
  int8_onnx_bytes?: number
  int8_score_correlation?: number
  gnn?: { params: number; heads: number; hidden: number; scenarios: number; physics_weight: number; physics_violations: number
    rmse: Record<'T' | 'RH' | 'P' | 'W', { st_gnn: number; idw: number }> } | null
  benchmarks?: { observations: number; faulty: number; storm: number
    rows: { method: string; kind: string; recall: number; precision: number; false_alarms: number; storm_rejected: number }[] } | null
}
export type ApiResult = EngineResult & { meta: { scorer: string; spatial: string; compute_ms: number; version: string } }

async function withTimeout<T>(p: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await p(ctl.signal) } finally { clearTimeout(t) }
}

export const api = {
  health: () => withTimeout(async (signal) => {
    const r = await fetch(`${API_URL}/api/v1/health`, { signal })
    if (!r.ok) throw new Error(`health ${r.status}`)
    return (await r.json()) as Health
  }, 4000),

  model: () => withTimeout(async (signal) => {
    const r = await fetch(`${API_URL}/api/v1/model`, { signal })
    return (await r.json()) as ModelCard
  }, 3000),

  exportUrl: (format: 'csv' | 'json' | 'netcdf', k: number) => `${API_URL}/api/v1/export?format=${format}&k=${k}`,
  docsUrl: `${API_URL}/docs`,

  run: (faults: Fault[]) => withTimeout(async (signal) => {
    const body = { faults: faults.map(({ st, type, k0, steps, user }) => ({ st, type, k0, steps, user: !!user })), model: 'auto' }
    const r = await fetch(`${API_URL}/api/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
    if (!r.ok) throw new Error(`run ${r.status}: ${await r.text()}`)
    return (await r.json()) as ApiResult
  }, 20000),
}
