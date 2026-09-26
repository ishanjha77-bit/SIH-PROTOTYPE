"""
WeatherGuard AI — FastAPI backend.

    uvicorn app.main:app --reload --port 8000
    open http://localhost:8000/docs
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import threading
import time
from pathlib import Path
from functools import lru_cache
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine import products
from .engine.pipeline import FAULT_CLS, EngineResult, confidence, metrics, run, wmo_flags
from .engine.sim import FAULT_TYPES, INDEX, STATIONS, STEPS, Fault, Scenario, default_faults
from .ml.runtime import MODEL_DIR, load_models, read_meta

VERSION = "0.1.0"
app = FastAPI(title="WeatherGuard AI", version=VERSION,
              description="Physics-informed anomaly detection for IMD Automatic Weather Stations · SIH 2026 · Team Nex_GenX")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2048)

# ONNX Runtime by default (no PyTorch needed on the server); None → PCA / inverse-distance fallbacks
SCORER, SPATIAL, RUNTIME = load_models()


# ---------------- schemas ----------------
class FaultIn(BaseModel):
    st: str = Field(description="Station id, e.g. 'alibag'")
    type: Literal["flatline", "drift", "spike", "blockage", "power", "soiling", "bearing"]
    k0: int = Field(ge=0, lt=STEPS, description="15-min step at which the fault starts")
    steps: Optional[list[int]] = None
    user: bool = False


class RunRequest(BaseModel):
    faults: Optional[list[FaultIn]] = Field(None, description="Omit to use the reference demo faults")
    model: Literal["auto", "lstm", "pca"] = "auto"
    spatial: Literal["auto", "gnn", "idw"] = "auto"


class IngestIn(BaseModel):
    station: str
    time: str = Field(description="ISO-8601 observation time")
    T: float
    RH: float
    P: float
    W: float
    S: float = 0
    R: float = 0
    V: float = 12.6
    C: float = 30
    prev_T: Optional[float] = Field(None, description="previous reading, if the RTU sends it (rate-of-change check)")


# ---------------- helpers ----------------
def _clean(x):
    """Round floats and replace NaN/inf so the payload is valid, compact JSON."""
    if isinstance(x, float):
        return None if math.isnan(x) or math.isinf(x) else round(x, 4)
    if isinstance(x, dict):
        return {k: _clean(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_clean(v) for v in x]
    return x


def _faults(fs: Optional[list[FaultIn]]) -> list[Fault]:
    if fs is None:
        return default_faults()
    out = []
    for f in fs:
        if f.st not in INDEX:
            raise HTTPException(422, f"Unknown station '{f.st}'")
        out.append(Fault(f.st, f.type, f.k0, f.steps, f.user))
    return out


def _scorer(model: str):
    if model == "pca":
        return None
    if model == "lstm" and SCORER is None:
        raise HTTPException(409, "LSTM model not trained yet. Run: python -m app.ml.train")
    return SCORER


def _spatial(spatial: str):
    if spatial == "idw":
        return None
    if spatial == "gnn" and SPATIAL is None:
        raise HTTPException(409, "ST-GNN not trained yet. Run: python -m app.ml.train_gnn")
    return SPATIAL


@lru_cache(maxsize=16)
def _run_cached(key: str, model: str, spatial: str = "auto") -> tuple[EngineResult, bytes]:
    faults = [Fault(**d) for d in json.loads(key)]
    t0 = time.perf_counter()
    E = run(faults, Scenario(), _scorer(model), spatial=_spatial(spatial))
    payload = {
        "faults": [f.to_json() for f in E.sim.faults],
        "TRUE": E.sim.TRUE, "RAW": E.sim.RAW, "TRUTH": E.sim.TRUTH,
        "OUT": E.OUT, "LEG": E.LEG, "TRAIN": E.TRAIN,
        "meta": {"scorer": E.scorer_name, "spatial": E.spatial_name, "compute_ms": round((time.perf_counter() - t0) * 1000), "version": VERSION},
    }
    return E, json.dumps(_clean(payload), separators=(",", ":"), ensure_ascii=False).encode()


def _key(faults: list[Fault]) -> str:
    return json.dumps([f.to_json() for f in faults], sort_keys=True)


def _model_name(model: str) -> str:
    return "pca" if model == "pca" or (model == "auto" and SCORER is None) else "lstm"


# ---------------- routes ----------------
@app.get("/api/v1/health", tags=["system"])
def health():
    return {"status": "ok", "version": VERSION, "scorer": "lstm-autoencoder" if SCORER else "pca",
            "spatial": "st-gnn" if SPATIAL else "idw", "runtime": RUNTIME, "stations": len(STATIONS)}


@app.get("/api/v1/stations", tags=["network"])
def stations():
    return [s.__dict__ for s in STATIONS]


@app.get("/api/v1/model", tags=["model"])
def model_card():
    meta = read_meta("lstm_ae.json")
    if not meta:
        return {"trained": False, "hint": "python -m app.ml.train_gnn && python -m app.ml.train"}
    bench = MODEL_DIR / "benchmarks.json"
    return {"trained": True, **meta, "gnn": read_meta("st_gnn.json"), "runtime": RUNTIME, "benchmarks": json.loads(bench.read_text()) if bench.exists() else None}


@app.post("/api/v1/run", tags=["pipeline"], summary="Run the full 72-hour stream through the pipeline")
def run_stream(req: RunRequest):
    """Returns every observation, verdict and legacy result for the 12-station network.
    The shape matches the frontend's `EngineResult` type exactly."""
    faults = _faults(req.faults)
    _, body = _run_cached(_key(faults), _model_name(req.model), req.spatial)
    return Response(body, media_type="application/json")


@app.get("/api/v1/observations/{station_id}", tags=["pipeline"], summary="One observation with its verdict")
def observation(station_id: str, k: int = Query(150, ge=0, lt=STEPS), model: Literal["auto", "lstm", "pca"] = "auto"):
    if station_id not in INDEX:
        raise HTTPException(404, "Unknown station")
    E, _ = _run_cached(_key(default_faults()), _model_name(model))
    i = INDEX[station_id]
    d = E.OUT[k][i]
    return _clean({
        "station": STATIONS[i].__dict__, "k": k, "raw": E.sim.RAW[k][i],
        "verdict": {"cls": d["cls"], "gates": d["gates"], "z": d["z"], "expected": d["exp"], "clean": d["clean"],
                    "score": d["score"], "warn": d["warn"], "context": d["ctx"]},
        "legacy": E.LEG[k][i], "is_fault": d["cls"] in FAULT_CLS,
    })


@app.get("/api/v1/metrics", tags=["evaluation"], summary="WeatherGuard vs legacy QC up to step k")
def get_metrics(k: int = Query(STEPS - 1, ge=0, lt=STEPS), model: Literal["auto", "lstm", "pca"] = "auto"):
    E, _ = _run_cached(_key(default_faults()), _model_name(model))
    return _clean(metrics(E, k))


@app.get("/api/v1/fault-types", tags=["network"])
def fault_types():
    return list(FAULT_TYPES)


def _default_run() -> EngineResult:
    return _run_cached(_key(default_faults()), _model_name("auto"))[0]


@app.get("/api/v1/export", tags=["products"], summary="Quality-controlled observations with WMO QC flags")
def export(fmt: Literal["csv", "json", "netcdf"] = Query("csv", alias="format"), k: int = Query(STEPS - 1, ge=0, lt=STEPS)):
    """Clean observations for NWP assimilation and archives. QC flags: 0 good · 2 doubtful · 3 erroneous ·
    4 corrected/imputed · 9 missing. Each row also carries a 0–1 confidence and the edge burst-mode flag."""
    E = _default_run()
    name = f"weatherguard_qc_upto_{k:03d}"
    if fmt == "netcdf":
        return Response(products.to_netcdf(E, k), media_type="application/x-netcdf", headers={"Content-Disposition": f'attachment; filename="{name}.nc"'})
    recs = products.records(E, k)
    if fmt == "json":
        return Response(json.dumps(recs), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="{name}.json"'})
    return Response(products.to_csv(recs), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


@app.get("/api/v1/alerts", tags=["products"], summary="CAP-style severe-weather alerts")
def get_alerts(k: int = Query(STEPS - 1, ge=0, lt=STEPS)):
    return _clean(products.alerts(_default_run(), k))


@app.get("/api/v1/report", tags=["products"], summary="Natural-language shift report (markdown)")
def get_report(k: int = Query(STEPS - 1, ge=0, lt=STEPS)):
    return {"k": k, "markdown": products.report(_default_run(), k)}


@app.post("/api/v1/ingest", tags=["ingestion"], summary="HTTPS gateway for station RTUs")
async def ingest(obs: IngestIn):
    """Accepts one observation from a station RTU (the HTTPS leg of the MQTT/HTTPS/CoAP gateway), runs the
    tier-1 edge checks and forwards it to the `aws.raw` topic when BUS=kafka."""
    if obs.station not in INDEX:
        raise HTTPException(404, "Unknown station")
    flags = [f for f, bad in (("range", obs.T < -5 or obs.T > 48 or obs.RH > 100 or obs.RH < 1),
                              ("rate", obs.prev_T is not None and abs(obs.T - obs.prev_T) > 3),
                              ("battery", obs.V < 11.8), ("cabinet", obs.C > 55)) if bad]
    burst = obs.R > 2 or obs.W > 12 or (obs.prev_T is not None and obs.T - obs.prev_T < -2)
    forwarded = False
    if os.getenv("BUS") == "kafka":
        from .streaming.bus import TOPIC_RAW, make_bus
        bus = make_bus()
        await bus.start()
        try:
            await bus.publish(TOPIC_RAW, {"station": obs.station, "time": obs.time, "obs": obs.model_dump(exclude={"station", "time", "prev_T"})})
            forwarded = True
        finally:
            await bus.stop()
    return {"accepted": True, "edge_flags": flags, "sampling": "1-min burst" if burst else "15-min batch", "forwarded_to_bus": forwarded}


@app.websocket("/ws/stream")
async def stream(ws: WebSocket, speed: float = 4.0, start: int = 0):
    """Pushes one 15-minute step per message, like a live AWS feed. speed = steps per second."""
    await ws.accept()
    E, _ = _run_cached(_key(default_faults()), _model_name("auto"))
    try:
        for k in range(max(0, start), STEPS):
            await ws.send_json(_clean({
                "k": k,
                "stations": [{"id": s.id, "raw": E.sim.RAW[k][i], "cls": E.OUT[k][i]["cls"], "score": E.OUT[k][i]["score"],
                              "legacy": E.LEG[k][i]["flag"]} for i, s in enumerate(STATIONS)],
            }))
            await asyncio.sleep(1 / max(0.1, speed))
    except WebSocketDisconnect:
        pass


# ---------------- warm-up + single-container frontend ----------------
@app.on_event("startup")
def _warm() -> None:
    # compute the reference run in the background so the first visitor doesn't wait
    threading.Thread(target=lambda: _run_cached(_key(default_faults()), _model_name("auto")), daemon=True).start()


STATIC = Path(os.getenv("WG_STATIC", Path(__file__).resolve().parents[1] / "static"))
if STATIC.is_dir() and (STATIC / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = STATIC / path
        if path and f.is_file() and STATIC in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(STATIC / "index.html")
