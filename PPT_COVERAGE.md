# PPT → code coverage

Status: ✅ built and demoable · 🟡 partly (say it carefully) · ⬜ not built (reword or keep as roadmap)

## Slide 1 · Title
| Claim | Status | Where |
|---|---|---|
| IMD AWS network, 15-min transmission | ✅ | 12-station Konkan–Ghats pilot network, 15-min steps (`backend/app/engine/sim.py`) |
| "730+ stations" | 🟡 | Context number about IMD, not our demo size. Say "pilot on 12 stations, designed for 730+". |
| High false-positive risk in legacy QC | ✅ | Legacy QC implemented and scored: 12 genuine storm readings rejected vs 0 (Evaluation page) |
| 24/7 real-time edge AI monitoring | ✅ | Live stream player, WebSocket `/ws/stream`, streaming worker |

## Slide 2 · Idea
| Claim | Status | Where |
|---|---|---|
| Physics-informed LSTM-autoencoder | ✅ | `app/ml/model.py`; trained on residuals from the physics-informed ST-GNN, physics gate before it |
| Clausius–Clapeyron, Magnus–Tetens | ✅ | Physics gate (vapour pressure vs saturation, dew point) + ST-GNN physics loss |
| ST-GNN with DEM-aware topographic normalisation | ✅ | `app/ml/gnn.py`: graph attention over neighbours (now + 15 min ago), elevation/geometry edge features; 28–53% lower error than inverse-distance |
| INSAT-3D/3DR + Doppler radar fusion | ✅ (simulated feeds) | Radar & satellite gate; Marshall–Palmer Z-R |
| TinyML edge inference on RTU | 🟡 | Edge pre-filter per observation; LSTM-AE quantised to a 22 KB int8 ONNX file (score correlation 0.9997 with full precision); the server itself runs ONNX Runtime. No ESP32 firmware. Say "edge-ready, 22 KB int8 model". |
| Root cause: drift, flatline, ADC sag, funnel blockage | ✅ | All four + spike, soiling, bearing wear |
| Generative virtual sensor with physics-constrained diffusion | 🟡 | Virtual sensor = ST-GNN prediction with physics-constrained loss. Diffusion model not built → reword to "physics-constrained GNN virtual sensor (diffusion on roadmap)". |
| Predictive maintenance / failure forecasting | ✅ | Battery and bearing-wear time-to-failure warnings before faults corrupt data |
| XAI explanation + auto work orders | ✅ | Diagnosis page (gate-by-gate), Maintenance page (work orders with spares) |
| Edge-first, bandwidth-aware | 🟡 | 15-min batch / 1-min burst decision per observation; no measured bandwidth numbers |
| Distinguishes severe weather from faults | ✅ | 0 storm readings rejected vs 12 by legacy QC |
| Why now: "36 Doppler radars", "ESP32 now powerful enough" | — | Context statements, not product claims |

## Slide 3 · Technical approach
| Claim | Status | Where |
|---|---|---|
| React + Leaflet.js + D3.js | ✅ | Leaflet street map (Overview → Street map), D3 scales in charts |
| Python + FastAPI | ✅ | `backend/app/main.py` |
| Apache Kafka | ✅ | `app/streaming/bus.py` (Kafka/Redpanda via aiokafka), `docker compose --profile streaming` |
| TimescaleDB / InfluxDB | ✅ TimescaleDB · ⬜ InfluxDB | `app/streaming/store.py`. Drop "InfluxDB" from the slide or say "TimescaleDB". |
| LSTM-AE + ST-GNN + TinyML (ONNX) | ✅ | See above |
| XAI dashboard + natural-language diagnostics | ✅ | Narratives per observation + shift report |
| Tier 1: battery, solar, cabinet temp telemetry | ✅ | Battery, solar, cabinet temperature in every observation |
| Tier 1: rolling 1-s derivative monitor | 🟡 | Rate-of-change check on each reading (15-min data in the demo) |
| Tier 1: adaptive sampling 15-min / 1-min storm | ✅ | Burst-mode flag per observation, shown in UI |
| Tier 2: MQTT / HTTPS / CoAP gateway | 🟡 | HTTPS `POST /api/v1/ingest` built; MQTT and CoAP not. Say "HTTPS gateway (MQTT-ready)". |
| Tier 3: INSAT, DWR, DEM, spatial + temporal context | ✅ | |
| Tier 4: power & electrical decoupling | ✅ | Electrical gate |
| Tier 4: physics sanity gate | ✅ | |
| Tier 4: ST-GNN + DEM embeddings + lapse-rate normalisation | ✅ | |
| Tier 4: mechanical decay engine | ✅ | Anemometer bearing-wear detector with time-to-failure |
| Tier 4: cross-modal radar verifier | ✅ | |
| Tier 5: clean observation DB, WMO BUFR / NetCDF / JSON | ✅ NetCDF, JSON, CSV · ⬜ BUFR | `/api/v1/export`. Say "NetCDF/JSON (BUFR via ecCodes on roadmap)". |
| Tier 5: meteorologist command centre (GIS + XAI) | ✅ | The console |
| Tier 5: predictive maintenance dispatch + work orders | ✅ | |
| Tier 5: NWP assimilation (WRF/GFS) | 🟡 | CF NetCDF export is assimilation-ready; no live WRF run |
| Activity flow: power sag → alert tech; valid → WMO flag; storm → instant alert; fault → imputation + ticket | ✅ | QC flags, CAP alerts (`/api/v1/alerts`), virtual sensor, work orders |

## Slide 4 · Feasibility
| Claim | Status | Note |
|---|---|---|
| Working prototype: LSTM-AE + ST-GNN pipeline, edge inference demo, XAI dashboard | ✅ | |
| Python, TF Lite, Kafka, TimescaleDB, Leaflet | 🟡 | We use PyTorch → ONNX Runtime, not TensorFlow Lite. Change "TensorFlow Lite" to "ONNX Runtime". |
| Modular, independently deployable tiers | ✅ | Separate API, worker, producer services in docker-compose |
| Quantised ONNX < 200 KB | ✅ | LSTM-AE int8 22 KB, ST-GNN 107 KB (`python -m app.ml.export_onnx`) |
| "Validated on real weather station hardware" | ⬜ | **Remove or change** to "sized for ESP32 / Cortex-M4". Judges will ask. |
| DEM-aware GAT for sparse networks | ✅ | ST-GNN is a graph attention network |
| WMO BUFR/NetCDF standardisation | 🟡 | NetCDF yes, BUFR no |

## Slide 5 · Impact
| Claim | Status | Note |
|---|---|---|
| XAI alerts, confidence-scored observations, fewer false positives | ✅ | Confidence shown per observation and in exports |
| Natural-language diagnostic reports | ✅ | Shift report on Maintenance page, `/api/v1/report` |
| Predictive failure alerts "weeks before" | 🟡 | Demo shows hours before (3-day run). Say "hours to days ahead". |
| Work orders with exact spare parts | ✅ | |
| Drift, blockage, ice-jam, wiring fault | 🟡 | Ice-jam not built (not relevant for Konkan); wiring = spike detector |
| Pyranometer soiling "14% attenuation" | ✅ | Exactly the demo number |
| Anemometer bearing wear from spin-down curve | 🟡 | Bearing wear detected from wind vs neighbours trend, not a spin-down test. Reword "from wind-ratio trend". |
| Storm burst mode, radar + satellite validation, civil-defence auto-alerts | ✅ | Burst flag, CAP alerts |
| WMO BUFR/NetCDF output, 30-year baseline, IPCC | 🟡/⬜ | NetCDF yes; 30-year baselines are roadmap |
| Competitive table: physics-informed, TinyML, fusion, predictive maintenance | ✅ | |

## Slide 6 · Research
The Isolation Forest, LOF and One-Class SVM papers are now backed by a real benchmark: same features, same
false-alarm budget. Recall on the demo run: Isolation Forest 0.5%, One-Class SVM 18%, LOF 19%,
LSTM-AE alone 21%, legacy QC 27%, WeatherGuard pipeline 85% — with 0 false alarms and 0 storm readings rejected.
