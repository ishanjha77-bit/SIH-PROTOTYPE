<<<<<<< HEAD
# WeatherGuard AI — SIH 2026 · Team Nex_GenX

Physics-informed edge intelligence for IMD Automatic Weather Station anomaly detection.

- `backend/` — FastAPI, ST-GNN + LSTM-autoencoder (trained in PyTorch, served with ONNX Runtime), five-gate QC pipeline, exports, CAP alerts, Kafka/TimescaleDB streaming, tests.
- `frontend/` — React + TypeScript + Tailwind console (Leaflet, D3) with a guided judge tour.
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
=======
# SIH-PROTOTYPE
>>>>>>> bfdb6176a1e146d22ed9aec4670176ba36aa28c8
