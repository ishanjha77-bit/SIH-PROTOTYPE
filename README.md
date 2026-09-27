# WeatherGuard AI — SIH 2026 · Team Nex_GenX

Physics-informed edge intelligence for IMD Automatic Weather Station anomaly detection.

- `backend/` — FastAPI, ST-GNN + LSTM-autoencoder (trained in PyTorch, served with ONNX Runtime), five-gate QC pipeline, exports, CAP alerts, Kafka/TimescaleDB streaming, tests.
- `frontend/` — React + TypeScript + Tailwind console (Leaflet, D3) with a guided judge tour.
- `DEMO.md` — the 90-second judge demo, step by step, with the questions to expect.
- `DEPLOY.md` — put it online in about 10 minutes (Render free tier, Netlify/Vercel, or any server).
- `PPT_COVERAGE.md` — every claim in the deck mapped to where it lives in the code.

## Run locally

```bash
docker compose up                      # website + API → http://localhost:8000
```
or without Docker (two terminals):
```bash
cd backend && pip install -r requirements-serve.txt && uvicorn app.main:app --port 8000
cd frontend && npm install && npm run dev          # http://localhost:5173
```
Retraining the models needs the full `backend/requirements.txt` (PyTorch): `python -m app.ml.train_gnn && python -m app.ml.train && python -m app.ml.export_onnx`.

Streaming tier: `docker compose --profile streaming up` (Redpanda + TimescaleDB + station producer + QC worker).

## Real data

The same checks also run on a full year of **real** observations: 18,020 three-hourly SYNOP reports from
11 of the network's IMD stations in 2023, via the NOAA Integrated Surface Database. The ST-GNN, retrained on these
real observations with 4-fold cross-fitting (every prediction from a model that never saw that quarter), predicts
each station from its neighbours with 1.51 °C RMSE, 30% lower than inverse-distance weighting. NOAA's automated QC
flagged 136 readings as suspect; 127 of those are consistent with their neighbours, and 8 were real thunderstorms,
confirmed by cumulonimbus, thunderstorm and rain reports, that WeatherGuard keeps. Rebuild with
`cd backend && python -m app.realdata.gnn_real --year 2023 && python -m app.realdata.build --year 2023` (PyTorch
needed for the first step); the console's **Real data** page shows the results.
