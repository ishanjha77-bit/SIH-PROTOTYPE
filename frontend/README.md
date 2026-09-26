# WeatherGuard AI — Console (frontend)

React 19 + TypeScript + Tailwind CSS v4 + Vite. SIH 2026 · Team Nex_GenX.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build → dist/
npm run build:single # one self-contained HTML → dist-single/index.html (easy to share offline)
```

## Structure

```
src/
  engine/        detection engine (simulator, 5-gate QC pipeline, legacy QC, scoring)
    types.ts     data contract shared with the future FastAPI backend
    engine.ts    runEngine(faults) → observations + verdicts
  state/         ConsoleProvider: timeline, playback, selection, fault injection, theme
  components/    Shell (sidebar, top bar, timeline dock), NetworkMap, TraceChart, Blocks, ui
  views/         Overview, Station (diagnosis), Evaluation, Maintenance, Fault lab, Architecture
  lib/present.ts labels, colours, narratives, work-order templates
```

## Design system

Tokens live in `src/index.css` as CSS variables (light "mist" palette + dark mode via the `.dark` class)
and are exposed to Tailwind through `@theme inline` — e.g. `bg-surface`, `text-ink-2`, `bg-storm-soft`.
Fonts: Geist and Geist Mono.

## Backend swap point

`src/state/console.tsx` fetches from the FastAPI service via `src/api/client.ts`,
falling back to `runEngine(faults)` in the browser. Shapes are defined in `src/engine/types.ts`.

## Connecting to the backend

The console auto-detects the FastAPI backend at `VITE_API_URL` (default `http://localhost:8000`).
When it is online, every run goes through `POST /api/v1/run` and the LSTM-autoencoder; the sidebar
shows "FastAPI · LSTM-autoencoder". If the backend is down, the console silently uses the in-browser
TypeScript engine, so the demo never breaks. Use the Server / Browser switch in the sidebar to compare.
