# WeatherGuard AI — Backend

FastAPI + PyTorch. Physics-informed anomaly detection for IMD Automatic Weather Stations.
SIH 2026 · Team Nex_GenX.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m app.ml.train_gnn        # optional: trained models are already in models/
python -m app.ml.train            # LSTM-AE on ST-GNN residuals + literature benchmarks
python -m app.ml.export_onnx      # ONNX + int8 files used by the server (and an edge device)
uvicorn app.main:app --reload --port 8000
```

To only serve (no PyTorch): `pip install -r requirements-serve.txt` — the API runs both models with ONNX Runtime.

Open http://localhost:8000/docs for interactive API docs. Run tests with `pytest -q`.

## What's inside

| Path | Purpose |
|---|---|
| `app/engine/sim.py` | Deterministic 12-station AWS network simulator (Konkan–Western Ghats) with a squall line and injectable faults. Bit-identical to the frontend engine for the demo scenario. |
| `app/engine/pipeline.py` | Edge pre-filter + five-gate QC pipeline (electrical → physics [Clausius–Clapeyron, Magnus–Tetens] → temporal → radar/satellite → spatial/drift/mechanical decay), WMO QC flags, confidence, legacy QC and scoring. |
| `app/engine/products.py` | CSV / JSON / NetCDF export with QC flags, CAP-style alerts, natural-language shift report. |
| `app/ml/gnn.py`, `train_gnn.py` | ST-GNN: spatio-temporal graph attention network (DEM-aware) with a physics-informed loss; the expected value and virtual sensor. |
| `app/ml/model.py`, `train.py` | LSTM-autoencoder (≈10.8k params) on ST-GNN residuals; threshold calibration; ONNX export; Isolation Forest / LOF / One-Class SVM benchmarks. |
| `app/streaming/` | Kafka/Redpanda bus, TimescaleDB store, station producer and QC worker (in-memory bus + SQLite fallback). |
| `models/` | `st_gnn.pt/.json`, `lstm_ae.pt/.json/.onnx` (~47 KB), `benchmarks.json`. |
| `app/realdata/` | Real observations: NOAA ISD download and parsing (`isd.py`), the ST-GNN retrained on them (`gnn_real.py`), the checks on 3-hourly SYNOP data (`qc.py`), and the dataset the console shows (`build.py`). |
| `tests/` | Pipeline, API and real-data tests. |

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Status and active scorer |
| GET | `/api/v1/stations` | Station list |
| GET | `/api/v1/model` | Model card: params, threshold, ROC-AUC, ONNX size |
| POST | `/api/v1/run` | Run the 72-hour stream with a fault list → every observation, verdict and legacy result (used by the console) |
| GET | `/api/v1/observations/{station}?k=150` | One observation with its gate-by-gate verdict |
| GET | `/api/v1/metrics?k=287` | WeatherGuard vs legacy QC recall / precision / false alarms |
| GET | `/api/v1/export?format=csv\|json\|netcdf&k=` | Clean observations with WMO QC flags (0 good · 2 doubtful · 3 erroneous · 4 corrected · 9 missing) and confidence |
| GET | `/api/v1/alerts?k=` | CAP-style severe-weather alerts |
| GET | `/api/v1/report?k=` | Natural-language shift report (markdown) |
| POST | `/api/v1/ingest` | HTTPS gateway for station RTUs: edge checks, burst-mode decision, forward to Kafka |
| WS | `/ws/stream?speed=4` | Live feed, one 15-min step per message |

## Streaming (Kafka + TimescaleDB)

```bash
docker compose --profile streaming up        # from the repo root: Redpanda + TimescaleDB + producer + QC worker
python -m app.streaming.worker --role both --steps 96   # same flow in-process, no Docker (memory bus + SQLite)
```

## How the model is trained

1. 48 fault-free scenarios are simulated with random storm timing, speed and intensity (25% calm).
2. Each observation becomes a 5-feature residual vector: temperature, humidity, pressure and wind
   against altitude-corrected neighbours, plus gauge-minus-radar rain.
3. The autoencoder learns to reconstruct 4-hour windows of those vectors, so real storms are "normal".
4. The threshold is the 99.9th percentile of error on 6 held-out scenarios, rescaled to the pipeline's
   review line (6.5). An observation is sent for review only after two consecutive high scores.

## Results on the demo run (ST-GNN + LSTM-AE)

| | Legacy QC | WeatherGuard |
|---|---|---|
| Faulty readings caught | 34% | 87% |
| Good readings wrongly rejected | 16 | 0 |
| Genuine storm readings rejected | 12 | 0 |

No false alarms on 16 unseen fault-free scenarios. ST-GNN cuts neighbour-prediction error by 28–53% versus
inverse-distance weighting. See `models/benchmarks.json` for Isolation Forest / LOF / One-Class SVM.

## Honest scope

The main demo is simulated, so its metrics show the pipeline logic works, not field accuracy. `app/realdata/`
runs on real 2023 IMD observations from NOAA ISD: the ST-GNN retrained on them (`gnn_real.py`, 4-fold
cross-fitting, 1.51 °C RMSE vs 2.14 °C inverse-distance on held-out quarters) supplies each station's expected value,
and the physics, stuck-sensor, spike and consistency checks run with weather evidence from SYNOP reports in place
of radar. Real data has no ground truth, so those results are inconsistencies, not confirmed faults. The LSTM
autoencoder is not applied to it: it models 15-minute sequences and the archive is 3-hourly. The Kafka/TimescaleDB
adapters use the standard aiokafka/psycopg APIs; the in-memory/SQLite path is covered by tests. Not built:
WMO BUFR encoding (NetCDF/CSV/JSON are), diffusion-model imputation (the virtual sensor is the ST-GNN),
and on-device ESP32 firmware (the model is exported to ONNX for it). Next step: retrain the ST-GNN and
LSTM autoencoder on IMD's 15-minute AWS series (or NOAA MADIS), and add DWR radar as the external check.
