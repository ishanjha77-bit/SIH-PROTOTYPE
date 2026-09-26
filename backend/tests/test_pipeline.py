from fastapi.testclient import TestClient

from app.engine.pipeline import metrics, run
from app.engine.sim import INDEX, Fault, default_faults, hash3
from app.main import app

client = TestClient(app)


def test_hash_matches_javascript_engine():
    # value produced by the TypeScript engine's hash(3, 150, 1) — guarantees identical simulated data
    assert hash3(3, 150, 1) == 0.24285150109790266


def test_reference_run_beats_legacy():
    E = run(default_faults())
    m = metrics(E)
    assert m["wg"]["rec"] > 0.85 > m["lg"]["rec"]
    assert m["wg"]["fp"] < m["lg"]["fp"]
    assert m["stormWg"] == 0 and m["stormLeg"] > 0  # storms kept, legacy rejects them


def test_every_fault_type_is_detected():
    for ftype, cls in [("flatline", "FLATLINE"), ("drift", "DRIFT"), ("spike", "SPIKE"), ("blockage", "BLOCKAGE"), ("power", "ELECTRICAL")]:
        k0 = 20 if ftype != "blockage" else 110
        f = Fault("alibag", ftype, k0, steps=[k0, k0 + 6, k0 + 13] if ftype == "spike" else None)
        E = run([f])
        i = INDEX["alibag"]
        assert any(E.OUT[k][i]["cls"] == cls for k in range(k0, 288)), ftype


def test_severe_weather_is_kept():
    E = run([])
    severe = [(k, i) for k in range(288) for i in range(12) if E.OUT[k][i]["cls"] == "SEVERE"]
    assert len(severe) > 50


def test_api_run_and_health():
    assert client.get("/api/v1/health").json()["status"] == "ok"
    r = client.post("/api/v1/run", json={"faults": [{"st": "pune", "type": "flatline", "k0": 30}]})
    assert r.status_code == 200
    body = r.json()
    assert len(body["OUT"]) == 288 and len(body["OUT"][0]) == 12
    assert body["faults"][0]["type"] == "flatline"


def test_api_rejects_unknown_station():
    r = client.post("/api/v1/run", json={"faults": [{"st": "atlantis", "type": "flatline", "k0": 30}]})
    assert r.status_code == 422


def test_observation_contract():
    r = client.get("/api/v1/observations/lonavala", params={"k": 150}).json()
    assert r["verdict"]["cls"] == "SEVERE"
    assert {g["id"] for g in r["verdict"]["gates"]} >= {"E", "P", "T", "R", "S"}


def test_bearing_wear_detected_and_predicted():
    E = run([Fault("ahmednagar", "bearing", 30)])
    i = INDEX["ahmednagar"]
    first_warn = next(k for k in range(288) if (E.OUT[k][i]["warn"] or {}).get("kind") == "bearing")
    first_flag = next(k for k in range(288) if E.OUT[k][i]["cls"] == "BEARING")
    assert first_warn < first_flag  # predictive maintenance: warned before it crosses tolerance


def test_no_false_alarms_on_unseen_clean_scenarios():
    from app.engine.pipeline import FAULT_CLS
    from app.ml.train import scenario
    for seed in (41, 42, 43):
        E = run([], scenario(seed))
        assert not any(E.OUT[k][i]["cls"] in FAULT_CLS for k in range(288) for i in range(12))


def test_products_endpoints():
    assert client.get("/api/v1/export", params={"format": "csv", "k": 100}).text.startswith("time,station")
    assert client.get("/api/v1/export", params={"format": "netcdf", "k": 100}).content[:3] == b"CDF"
    assert "shift report" in client.get("/api/v1/report", params={"k": 150}).json()["markdown"]
    assert client.get("/api/v1/alerts", params={"k": 150}).json()[0]["severity"] == "Severe"


def test_streaming_matches_batch(tmp_path, monkeypatch):
    import asyncio
    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "wg.db"))
    from app.streaming.worker import main_async
    asyncio.run(main_async("both", 40, 0))
    import sqlite3
    assert sqlite3.connect(tmp_path / "wg.db").execute("select count(*) from observations").fetchone()[0] == 40 * 12
