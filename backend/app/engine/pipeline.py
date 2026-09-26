"""
WeatherGuard five-gate quality-control pipeline + WMO-style legacy QC.

Runs causally over the simulated stream: each observation is judged using only the current and past
steps. Gate order:
  E  Electrical   – battery / ADC reference, predictive power-failure warning
  P  Physics      – Magnus–Tetens saturation, physical bounds, clear-sky solar ceiling
  T  Temporal     – flatline and isolated-spike detection
  R  Radar & sat  – DWR radar / INSAT cloud-top cross-check: funnel blockage or genuine severe weather
  S  Spatial      – lapse-rate-normalised buddy check, CUSUM drift, solar consistency,
                    and the multivariate anomaly score (LSTM-autoencoder, PCA fallback)
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass
from statistics import median as _median
from typing import Optional, Protocol

import numpy as np

from .sim import LAPSE, N, STATIONS, STEPS, TRAIN_K, W, Fault, Scenario, SimResult, rain_from_dbz, simulate

VARS = ("T", "RH", "P", "W")
FLOOR = {"T": 0.45, "RH": 2.6, "P": 0.45, "W": 1.3}
FAULT_CLS = {"ELECTRICAL", "MISSING", "PHYSICS", "FLATLINE", "SPIKE", "BLOCKAGE", "DRIFT", "SOILING", "BEARING", "ANOMALY"}
SCORE_THRESHOLD = 6.5  # UI threshold; AE errors are rescaled so their calibrated threshold lands here
N_FEATURES = 5


class SpatialPredictor(Protocol):
    name: str

    def predict(self, now: list[Optional[dict]], prev: list[Optional[dict]], ok: dict[str, list[bool]]) -> np.ndarray:
        """Expected [T_sea-level, RH, P_sea-level, W] for every station from its neighbours → (N, 4)."""
        ...


class SequenceScorer(Protocol):
    window: int

    def score(self, windows: np.ndarray) -> np.ndarray:  # (B, window, 5) → (B,) scaled scores
        ...


def median(a: list[float]) -> float:
    return float(_median(a)) if a else 0.0


def magnus(T: float, RH: float) -> float:
    a, b = 17.625, 243.04
    g = math.log(max(RH, 1) / 100) + a * T / (b + T)
    return b * g / (a - g)


def gate(gid: str, name: str, status: str, text: str) -> dict:
    return {"id": gid, "name": name, "status": status, "text": text}


def _jacobi(A: np.ndarray):
    vals, vecs = np.linalg.eigh(A)
    return np.maximum(vals, 1e-3), vecs


@dataclass
class EngineResult:
    sim: SimResult
    OUT: list[list[dict]]
    LEG: list[list[dict]]
    TRAIN: list[dict]
    features: list[list[Optional[list[float]]]]  # f5 per [k][i] (None when missing)
    scorer_name: str
    spatial_name: str = "idw"


def _sign(v: float) -> str:
    return "+" if v >= 0 else ""


def sat_vapour_pressure(T: float) -> float:
    """Clausius–Clapeyron (integrated, constant L): saturation vapour pressure in hPa over water."""
    L, Rv = 2.501e6, 461.5
    return 6.112 * math.exp(L / Rv * (1 / 273.15 - 1 / (T + 273.15)))


def run(faults: list[Fault], scenario: Scenario = Scenario(), scorer: Optional[SequenceScorer] = None,
        steps: int = STEPS, spatial: Optional[SpatialPredictor] = None) -> EngineResult:
    """Simulate the network with the given faults and run the pipeline over it."""
    return evaluate(simulate(faults, scenario, steps), scorer, spatial)


def evaluate(S: SimResult, scorer: Optional[SequenceScorer] = None, spatial: Optional[SpatialPredictor] = None) -> EngineResult:
    """Run the pipeline over any stream (simulated or ingested). S.TRUE only needs dbz / ctt / cs / stormy."""
    TRUE, RAW = S.TRUE, S.RAW
    K = len(RAW)

    def tn(v, i): return v + LAPSE * STATIONS[i].elev
    def psl(v, i): return v * math.exp(STATIONS[i].elev / 8430)

    def own(o, i, key):
        return tn(o["T"], i) if key == "T" else psl(o["P"], i) if key == "P" else o[key]

    def nb_est(k, i, key, ok):
        sw = sv = 0.0
        for j in range(N):
            if j == i or not ok[j]:
                continue
            o = RAW[k][j]
            if o is None:
                continue
            sw += W[i][j]
            sv += W[i][j] * own(o, j, key)
        return sv / sw if sw else float("nan")

    all_ok = [True] * N
    ALL_OK = {key: all_ok for key in VARS}

    def estimates(k: int, ok: dict[str, list[bool]]) -> list[dict]:
        """Neighbour-expected sea-level values per station: ST-GNN when available, else inverse-distance."""
        if spatial is not None:
            pred = spatial.predict(RAW[k], RAW[k - 1] if k > 0 else RAW[k], ok)
            return [{key: float(pred[i][n]) for n, key in enumerate(VARS)} for i in range(N)]
        return [{key: nb_est(k, i, key, ok[key]) for key in VARS} for i in range(N)]

    TK = min(TRAIN_K, K)
    train_est = [estimates(k, ALL_OK) for k in range(TK)]

    # ---------- learn normal residual behaviour ----------
    acc = [{v: [] for v in VARS} for _ in range(N)]
    for k in range(TK):
        for i in range(N):
            o = RAW[k][i]
            if o is None:
                continue
            for key in VARS:
                e = train_est[k][i][key]
                if not math.isnan(e):
                    acc[i][key].append(own(o, i, key) - e)
    TRAIN = []
    for t in acc:
        r = {}
        for key, a in t.items():
            # robust location/scale (median, 1.4826·MAD) so a fault inside the learning window can't hide itself
            m = median(a)
            sd = 1.4826 * median([abs(y - m) for y in a])
            r[key] = {"m": m, "sd": max(sd, FLOOR[key])}
        TRAIN.append(r)

    # PCA fallback score (Mahalanobis over standardised residuals)
    X = []
    for k in range(TK):
        for i in range(N):
            o = RAW[k][i]
            if o is None:
                continue
            f = [(own(o, i, key) - train_est[k][i][key] - TRAIN[i][key]["m"]) / TRAIN[i][key]["sd"] for key in VARS]
            f.append(max(-4, min(4, (o["R"] - rain_from_dbz(TRUE[k][i]["dbz"]) / 4) / 0.8)))
            X.append(f)
    Xa = np.array(X)
    mu = Xa.mean(axis=0)
    pvals, pvecs = _jacobi(np.cov(Xa, rowvar=False, bias=True))

    # regional convective activity: pause slow-learning detectors during storms
    RQ = []
    for k in range(K):
        m = max(TRUE[q][j]["dbz"] for q in range(max(0, k - 12), k + 1) for j in range(N))
        RQ.append(m < 20)
    # stricter quiet flag for wind: no radar echo anywhere for 6 h (post-storm outflow biases wind)
    RQW = []
    for k in range(K):
        m = max(TRUE[q][j]["dbz"] for q in range(max(0, k - 24), k + 1) for j in range(N))
        RQW.append(m < 12)

    OUT: list[list[dict]] = []
    LEG: list[list[dict]] = []
    FEAT: list[list[Optional[list[float]]]] = []
    st = [{"cp": 0.0, "cn": 0.0, "drift": False, "blk": 0, "soil": [], "wind": [], "bearing": False} for _ in range(N)]
    hist = [deque(maxlen=scorer.window if scorer else 1) for _ in range(N)]
    prev_bad = [{v: False for v in (*VARS, "R")} for _ in range(N)]
    prev_score = [0.0] * N  # ANOMALY needs two consecutive high scores (30 min persistence)

    for k in range(K):
        bad = [{v: False for v in (*VARS, "R")} for _ in range(N)]
        rain_all = [o["R"] if o else None for o in RAW[k]]
        row: list[Optional[dict]] = [None] * N
        lrow: list[dict] = []
        frow: list[Optional[list[float]]] = [None] * N
        pre: list[dict] = []
        step_est = estimates(k, {key: [not b[key] for b in prev_bad] for key in VARS})

        # ---------- phase 1: legacy QC, expectations, residuals ----------
        for i in range(N):
            o, tr, s = RAW[k][i], TRUE[k][i], STATIONS[i]
            max_dbz = max([tr["dbz"]] + [TRUE[q][i]["dbz"] for q in range(max(0, k - 2), k)])
            ctx = {"dbz": tr["dbz"], "maxDbz": max_dbz, "ctt": tr["ctt"], "radarR": rain_from_dbz(tr["dbz"]) / 4, "convective": max_dbz > 32}

            leg, why = False, ""
            if o is None:
                leg, why = True, "Missing data"
            else:
                if o["T"] < -5 or o["T"] > 48 or o["RH"] > 100 or o["RH"] < 1:
                    leg, why = True, "Range check failed"
                p = RAW[k - 1][i] if k > 0 else None
                if p:
                    if abs(o["T"] - p["T"]) > 3:
                        leg, why = True, f"Step check: T changed {o['T'] - p['T']:.1f} °C in 15 min"
                    elif abs(o["RH"] - p["RH"]) > 15:
                        leg, why = True, f"Step check: RH changed {o['RH'] - p['RH']:.0f}% in 15 min"
                    elif abs(o["W"] - p["W"]) > 8:
                        leg, why = True, f"Step check: wind changed {o['W'] - p['W']:.1f} m/s"
                if not leg and k >= 16:
                    same = all(RAW[q][i] is not None and abs(RAW[q][i]["T"] - o["T"]) <= 1e-6 for q in range(k - 16, k))
                    if same:
                        leg, why = True, "Persistence: T unchanged for 4 h"
            lrow.append({"flag": leg, "why": why})

            tt = TRAIN[i]
            est = step_est[i]
            exp = {"T": est["T"] - LAPSE * s.elev + tt["T"]["m"], "RH": est["RH"] + tt["RH"]["m"],
                   "P": (est["P"] + tt["P"]["m"]) / math.exp(s.elev / 8430), "W": est["W"] + tt["W"]["m"], "R": ctx["radarR"]}
            z, f5 = {}, None
            if o is not None:
                z = {key: (own(o, i, key) - est[key] - tt[key]["m"]) / tt[key]["sd"] for key in VARS}
                f5 = [z["T"], z["RH"], z["P"], z["W"], max(-4, min(4, (o["R"] - ctx["radarR"]) / 0.8))]
                hist[i].append(f5)
            frow[i] = f5
            pre.append({"ctx": ctx, "exp": exp, "z": z, "f5": f5})

        # ---------- phase 2: multivariate score (batched LSTM-AE, PCA fallback) ----------
        scores = [0.0] * N
        for i in range(N):
            f5 = pre[i]["f5"]
            if f5 is not None:
                proj = (np.array(f5) - mu) @ pvecs
                scores[i] = float(math.sqrt(float(np.sum(proj * proj / pvals)) / 5))
        if scorer is not None:
            idx = [i for i in range(N) if pre[i]["f5"] is not None and len(hist[i]) == scorer.window]
            if idx:
                sc = scorer.score(np.array([list(hist[i]) for i in idx], dtype=np.float32))
                for n_, i in enumerate(idx):
                    scores[i] = float(sc[n_])

        # ---------- phase 3: gates ----------
        for i in range(N):
            o, tr, s = RAW[k][i], TRUE[k][i], STATIONS[i]
            ctx, exp, z = pre[i]["ctx"], pre[i]["exp"], pre[i]["z"]
            res = {"cls": "VALID", "gates": [], "z": z, "exp": exp, "ctx": ctx, "clean": {}, "warn": None,
                   "att": None, "score": scores[i], "dT": 0.0, "edge": {"burst": False, "flags": []}}

            vs = [RAW[k][j]["V"] for j in range(N) if j != i and RAW[k][j]]
            v_med = median(vs)
            v_slope = 0.0
            if k >= 12:
                xs, ys = [], []
                for q in range(k - 11, k + 1):
                    r = RAW[q][i]
                    if r is None:
                        continue
                    vv = [RAW[q][j]["V"] for j in range(N) if j != i and RAW[q][j]]
                    xs.append(q)
                    ys.append(r["V"] - median(vv))
                if len(xs) > 4:
                    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
                    nu = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
                    de = sum((x - mx) ** 2 for x in xs)
                    v_slope = nu / de

            if o is None:
                res["cls"] = "MISSING"
                res["gates"] = [gate("E", "Electrical", "flag", "No transmission. Battery fell below the 10.8 V logger cut-off.")]
                res["clean"] = {"T": exp["T"], "RH": exp["RH"], "R": ctx["radarR"]}
                bad[i] = {v: True for v in (*VARS, "R")}
                row[i] = res
                continue

            zT, zRH, zW = z["T"], z["RH"], z["W"]
            Td = magnus(o["T"], min(o["RH"], 100))
            es = sat_vapour_pressure(o["T"])
            e_vap = max(o["RH"], 0) / 100 * es

            # Tier-1 edge pre-filter: local-only checks the station RTU runs before transmitting
            pv = RAW[k - 1][i] if k > 0 else None
            eflags = []
            if o["T"] < -5 or o["T"] > 48 or o["RH"] > 100 or o["RH"] < 1:
                eflags.append("range")
            if pv and abs(o["T"] - pv["T"]) > 3:
                eflags.append("rate")
            if o["V"] < 11.8:
                eflags.append("battery")
            if o["C"] > 55:
                eflags.append("cabinet")
            burst = o["R"] > 2 or o["W"] > 12 or bool(pv and (abs(o["P"] - pv["P"]) > 1.0 or o["T"] - pv["T"] < -2))
            res["edge"] = {"burst": burst, "flags": eflags}

            # Gate E
            v_rel = o["V"] - v_med
            if o["V"] < 11.6:
                res["cls"] = "ELECTRICAL"
                res["gates"].append(gate("E", "Electrical", "flag", f"Battery {o['V']:.2f} V is below the 11.6 V ADC reference. All channels are biased and quarantined."))
            elif v_slope < -0.012 and v_rel < -0.22:
                hrs = max(0.0, (o["V"] - 11.6) / -v_slope / 4)
                res["warn"] = {"kind": "battery", "hrs": hrs, "slope": v_slope}
                res["gates"].append(gate("E", "Electrical", "warn", f"Battery {o['V']:.2f} V, {-v_rel:.2f} V below the network and falling {-v_slope * 4:.2f} V/h. Reaches 11.6 V in about {hrs:.1f} h."))
            else:
                res["gates"].append(gate("E", "Electrical", "pass", f"Battery {o['V']:.2f} V, in line with the network ({_sign(v_rel)}{v_rel:.2f} V)."))

            # Gate P
            phys_bad = e_vap > 1.005 * es or o["RH"] < 1 or o["T"] < -5 or o["T"] > 48 or o["S"] > 1.15 * tr["cs"] + 60
            if res["cls"] == "VALID" and phys_bad:
                res["cls"] = "PHYSICS"
                res["gates"].append(gate("P", "Physics", "flag", f"Vapour pressure {e_vap:.1f} hPa exceeds saturation {es:.1f} hPa at {o['T']:.1f} °C (Clausius–Clapeyron). RH {o['RH']:.1f}% is impossible." if e_vap > 1.005 * es else "Reading outside physical bounds."))
            else:
                res["gates"].append(gate("P", "Physics", "skip" if res["cls"] == "ELECTRICAL" else "pass",
                                         f"Vapour pressure {e_vap:.1f} ≤ saturation {es:.1f} hPa (Clausius–Clapeyron); dew point {Td:.1f} °C ≤ air {o['T']:.1f} °C (Magnus–Tetens). Solar {o['S']:.0f} ≤ clear-sky {tr['cs']:.0f} W/m²."))

            # Gate T
            flat, flat_rg, flat_nb = False, 1.0, 0.0
            if k >= 6:
                own6 = [RAW[q][i]["T"] for q in range(k - 5, k + 1) if RAW[q][i]]
                nbr = []
                for j in range(N):
                    if j == i:
                        continue
                    a = [RAW[q][j]["T"] for q in range(k - 5, k + 1) if RAW[q][j]]
                    if len(a) > 3:
                        nbr.append(max(a) - min(a))
                flat_rg = max(own6) - min(own6) if len(own6) > 5 else 1.0
                flat_nb = median(nbr)
                flat = flat_rg < 0.02 and flat_nb > 0.15
            prev = RAW[k - 1][i] if k > 0 else None
            dT = o["T"] - prev["T"] if prev else 0.0
            res["dT"] = dT
            if res["cls"] == "VALID" and flat:
                res["cls"] = "FLATLINE"
                res["gates"].append(gate("T", "Temporal", "flag", f"Temperature identical for 90 min (range {flat_rg:.2f} °C) while neighbours moved {flat_nb:.1f} °C."))
            elif res["cls"] == "VALID" and abs(zT) > 5 and abs(dT) > 4 and not ctx["convective"]:
                res["cls"] = "SPIKE"
                res["gates"].append(gate("T", "Temporal", "flag", f"Jump of {'+' if dT > 0 else ''}{dT:.1f} °C in 15 min with no radar echo and no neighbour support (z = {zT:.1f})."))
            else:
                res["gates"].append(gate("T", "Temporal", "skip" if res["cls"] != "VALID" else "pass", f"15-min change {_sign(dT)}{dT:.1f} °C. No flatline or isolated spike."))

            # Gate R
            nb_rain = median([v for j, v in enumerate(rain_all) if j != i and v is not None])
            if o["R"] < 0.1 and ctx["radarR"] > 1.0 and (nb_rain > 0.4 or ctx["dbz"] > 35):
                st[i]["blk"] += 1
            else:
                st[i]["blk"] = 0
            if res["cls"] == "VALID" and st[i]["blk"] >= 2:
                res["cls"] = "BLOCKAGE"
                res["gates"].append(gate("R", "Radar & satellite", "flag", f"Gauge reports 0.0 mm but radar shows {ctx['dbz']:.0f} dBZ ≈ {ctx['radarR']:.1f} mm/15 min and neighbours are raining."))
            elif res["cls"] == "VALID" and ctx["convective"] and (abs(zT) > 2.5 or abs(zW) > 2.5 or abs(dT) > 2 or o["R"] > 3 or abs(zRH) > 2.5):
                res["cls"] = "SEVERE"
                res["gates"].append(gate("R", "Radar & satellite", "severe", f"Explained by real weather: radar {ctx['maxDbz']:.0f} dBZ, INSAT cloud-top {ctx['ctt']:.0f} °C, gauge {o['R']:.1f} mm vs radar {ctx['radarR']:.1f} mm."))
            else:
                res["gates"].append(gate("R", "Radar & satellite", "skip" if res["cls"] != "VALID" else "pass", f"Radar {ctx['dbz']:.0f} dBZ ≈ {ctx['radarR']:.1f} mm; gauge {o['R']:.1f} mm. Consistent."))

            # Gate S
            if RQ[k] and res["cls"] != "ELECTRICAL":
                st[i]["cp"] = max(0.0, st[i]["cp"] + zRH - 0.8)
                st[i]["cn"] = max(0.0, st[i]["cn"] - zRH - 0.8)
            if st[i]["cp"] > 12 or st[i]["cn"] > 12:
                st[i]["drift"] = True
            elif st[i]["cp"] < 4 and st[i]["cn"] < 4:
                st[i]["drift"] = False
            cus = max(st[i]["cp"], st[i]["cn"])
            if res["cls"] == "VALID" and st[i]["drift"]:
                res["cls"] = "DRIFT"
                res["gates"].append(gate("S", "Spatial & drift", "flag", f"RH reads {_sign(o['RH'] - exp['RH'])}{o['RH'] - exp['RH']:.1f}% vs terrain-corrected neighbours. CUSUM {cus:.0f} > 12 means sustained one-sided drift."))
            elif res["cls"] == "VALID" and res["score"] > SCORE_THRESHOLD and prev_score[i] > SCORE_THRESHOLD and RQ[k]:
                res["cls"] = "ANOMALY"
                res["gates"].append(gate("S", "Spatial & drift", "flag", f"Joint residual pattern unlike normal behaviour (score {res['score']:.1f}). Sent for forecaster review."))
            else:
                res["gates"].append(gate("S", "Spatial & drift", "skip" if res["cls"] not in ("VALID", "SEVERE") else "pass",
                                         f"T {_sign(zT)}{zT:.1f}σ, RH {_sign(zRH)}{zRH:.1f}σ vs lapse-rate-normalised neighbours. CUSUM {cus:.1f}."))

            if tr["cs"] > 200:
                ki = o["S"] / tr["cs"]
                nk = [RAW[k][j]["S"] / TRUE[k][j]["cs"] for j in range(N) if j != i and RAW[k][j] and TRUE[k][j]["cs"] > 200]
                m = median(nk)
                if m > 0.3 and RQW[k]:
                    st[i]["soil"].append(ki / m)
                if len(st[i]["soil"]) > 24:
                    st[i]["soil"].pop(0)
            if len(st[i]["soil"]) >= 10:
                r = median(st[i]["soil"])
                res["att"] = 1 - r
                if res["cls"] == "VALID" and r < 0.875 and tr["cs"] > 150:  # below every fault-free value in 24 validation runs (min 0.881)
                    res["cls"] = "SOILING"
                    res["gates"].append(gate("S", "Solar consistency", "flag", f"Pyranometer reads {100 * (1 - r):.0f}% below neighbours' clear-sky index over {len(st[i]['soil'])} daylight samples."))

            # mechanical decay: anemometer bearing wear (wind under-reads vs neighbours, trending down)
            if RQW[k] and exp["W"] > 2.0 and res["cls"] not in ("ELECTRICAL", "MISSING"):
                st[i]["wind"].append((o["W"], exp["W"]))
                if len(st[i]["wind"]) > 32:
                    st[i]["wind"].pop(0)
            wb = st[i]["wind"]
            if len(wb) >= 16:
                # least-squares gain of reported vs expected wind (robust to light-wind noise), and its trend
                ratio = sum(a * b for a, b in wb) / sum(b * b for _, b in wb)
                wr = [a / b for a, b in wb]
                n_ = len(wr)
                mx, my = (n_ - 1) / 2, sum(wr) / n_
                slope = sum((x - mx) * (y - my) for x, y in enumerate(wr)) / sum((x - mx) ** 2 for x in range(n_))
                if ratio < 0.76:  # below every fault-free value seen in 12 validation scenarios (min 0.79)
                    st[i]["bearing"] = True
                elif ratio > 0.86:
                    st[i]["bearing"] = False
                if res["cls"] == "VALID" and st[i]["bearing"]:
                    res["cls"] = "BEARING"
                    res["gates"].append(gate("S", "Mechanical decay", "flag", f"Anemometer reads {100 * (1 - ratio):.0f}% below terrain-corrected neighbours and falling. Bearing friction; cups under-read and stall in light wind."))
                elif res["cls"] == "VALID" and res["warn"] is None and slope < -0.005 and ratio < 0.88:
                    hrs = max(0.0, (ratio - 0.76) / -slope / 4)
                    res["warn"] = {"kind": "bearing", "hrs": hrs, "slope": slope}
                    res["gates"].append(gate("S", "Mechanical decay", "warn", f"Wind ratio vs neighbours {ratio:.2f} and falling {-slope * 4 * 100:.1f}%/h. Bearing will cross the 24% tolerance in about {hrs:.0f} h."))

            t_bad = res["cls"] in ("ELECTRICAL", "FLATLINE", "SPIKE", "PHYSICS")
            rh_bad = res["cls"] in ("ELECTRICAL", "DRIFT", "PHYSICS")
            res["clean"] = {
                "T": exp["T"] if t_bad else o["T"],
                "RH": min(100.0, exp["RH"]) if rh_bad else o["RH"],
                "R": ctx["radarR"] if res["cls"] == "BLOCKAGE" else o["R"],
                "S": o["S"] / (1 - res["att"]) if res["cls"] == "SOILING" and res["att"] else o["S"],
                "W": exp["W"] if res["cls"] in ("BEARING", "ELECTRICAL") else o["W"],
            }
            bad[i] = {"T": t_bad, "RH": rh_bad, "P": res["cls"] == "ELECTRICAL", "W": res["cls"] in ("ELECTRICAL", "BEARING"), "R": res["cls"] == "BLOCKAGE"}
            row[i] = res

        prev_bad = bad
        prev_score = scores
        OUT.append(row)  # type: ignore[arg-type]
        LEG.append(lrow)
        FEAT.append(frow)

    return EngineResult(S, OUT, LEG, TRAIN, FEAT, "lstm" if scorer else "pca", spatial.name if spatial else "idw")


# ---------------- evaluation ----------------
FAULT_CLASSES = {"flatline": {"FLATLINE"}, "drift": {"DRIFT"}, "spike": {"SPIKE"}, "blockage": {"BLOCKAGE"},
                 "power": {"ELECTRICAL", "MISSING"}, "soiling": {"SOILING"}, "bearing": {"BEARING"}}


def metrics(E: EngineResult, K: Optional[int] = None) -> dict:
    K = len(E.OUT) - 1 if K is None else K
    wg = {"tp": 0, "fp": 0, "fn": 0}
    lg = {"tp": 0, "fp": 0, "fn": 0}
    storm = storm_leg = storm_wg = 0
    for k in range(K + 1):
        for i in range(N):
            t = len(E.sim.TRUTH[k][i]) > 0
            w = E.OUT[k][i]["cls"] in FAULT_CLS
            l = E.LEG[k][i]["flag"]
            if t:
                wg["tp" if w else "fn"] += 1
                lg["tp" if l else "fn"] += 1
            else:
                wg["fp"] += w
                lg["fp"] += l
            if not t and E.sim.TRUE[k][i]["stormy"]:
                storm += 1
                storm_leg += l
                storm_wg += w

    def f(x):
        return {**x, "rec": x["tp"] / (x["tp"] + x["fn"]) if x["tp"] + x["fn"] else None,
                "prec": x["tp"] / (x["tp"] + x["fp"]) if x["tp"] + x["fp"] else None}
    return {"wg": f(wg), "lg": f(lg), "storm": storm, "stormLeg": storm_leg, "stormWg": storm_wg}


# ---------------- WMO-style quality flags & confidence ----------------
# 0 good · 1 inconsistent/suspect · 2 doubtful · 3 erroneous · 4 corrected/imputed · 9 missing
def wmo_flags(d: dict) -> dict:
    c = d["cls"]
    raw = {"VALID": 0, "SEVERE": 0, "ANOMALY": 2, "PHYSICS": 3, "MISSING": 9}.get(c, 3 if c in FAULT_CLS else 0)
    clean = 4 if c in FAULT_CLS and c != "ANOMALY" else raw
    return {"raw": raw, "clean": clean}


def confidence(d: dict) -> float:
    """Probability-like trust score (0–1) for the value sent downstream."""
    c = d["cls"]
    if c in ("VALID", "SEVERE"):
        return round(max(0.6, min(0.99, 0.99 - max(0.0, d["score"] - 2) / 20)), 3)
    if c == "ANOMALY":
        return 0.5
    return 0.75 if c != "MISSING" else 0.65  # imputed by the virtual sensor
