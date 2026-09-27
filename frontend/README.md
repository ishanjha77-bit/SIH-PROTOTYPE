# WeatherGuard — Console (frontend)

React 19 + TypeScript + Tailwind CSS v4 + Vite. SIH 2026 · Team Nex_GenX.

## Run

```bash
npm install
npm run dev          # http://localhost:5173  (add ?intro=0 to skip the opening sequence)
npm run build        # production build → dist/
npm run build:single # one self-contained HTML → dist-single/index.html (simulation only; no Real data page)
```

## Pages

| Page | What it shows |
|---|---|
| Overview | The command centre: live network, fault simulator, stage-by-stage validation, decision, why, impact |
| Real data | The same checks on 18,020 real 2023 IMD observations (NOAA ISD), compared with NOAA's own QC flags |
| Diagnosis | One observation, check by check, with a 24-hour trace |
| Maintenance | Shift report, work orders, clean-data export |
| Fault lab | Inject any of seven faults at any station |
| Evaluation | Recall, precision, false alarms, latency, and benchmarks against Isolation Forest, LOF, One-Class SVM |
| Architecture | The five tiers, the live model card, and the backend contract |

## Structure

```
src/
  engine/        in-browser reference engine (simulator, five-gate pipeline, legacy QC, scoring)
  state/         ConsoleProvider: replay clock, selection, fault injection, backend detection, theme
  intro/         opening sequence (Canvas 2D), variant store, staggered reveal, count-up
  components/    Shell (top nav, replay strip, footer), CommandCenter, Insights, NetworkMap, TraceChart, Mark, ui
  views/         Overview, RealData, Station (Diagnosis), Others (Evaluation, Maintenance, Fault lab, Architecture)
  lib/           present (labels, narratives), insights (findings), investigate (simulator walkthrough), realdata
public/realdata/ konkan-2023.json, written by backend/app/realdata/build.py
```

## Design system

Tokens live in `src/index.css` as CSS variables: a paper-and-ink palette for light and dark themes, one ink-blue
accent, and muted status colours (ok, severe weather, fault, power, warning, offline). They are exposed to
Tailwind through `@theme inline` (`bg-surface`, `text-ink-2`, …). Type scale: `t-display`, `t-headline`, `t-h1`,
`t-h2`, `t-h3`, `t-lead`, `t-body`, `t-small`, `t-caption`, `t-figure`. Font: Geist.

## Backend

The console auto-detects the FastAPI backend at `VITE_API_URL` (default `http://localhost:8000` in dev, same
origin in production) and falls back to the in-browser engine if it is unreachable. The nav shows which engine
produced what is on screen. Shapes are defined in `src/engine/types.ts` and `src/api/client.ts`.
