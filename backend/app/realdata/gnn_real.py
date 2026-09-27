"""
ST-GNN retrained on REAL observations: 11 IMD synoptic stations, 3-hourly, 2023 (NOAA ISD).

Same idea as app/ml/gnn.py (graph attention over the station network, DEM-aware edges, the target station never
sees its own reading), adapted to real data:
  • nodes carry sea-level-reduced temperature and relative humidity, now and 3 h earlier, plus validity masks
    (real networks have gaps; the mask lets any subset of neighbours report)
  • time-of-day and time-of-year inputs, because real weather has strong diurnal and seasonal cycles
  • residual learning: each station's hour-of-day climatology (from the training quarters only) is subtracted,
    so the network predicts the anomaly and does not have to relearn every station's typical cycle
  • Huber loss, because real training data contains storms and the odd bad reading
  • physics-informed term: predicted RH may not exceed 100 % (saturation)

Evaluation is honest by construction: four models are trained with one calendar quarter held out each
(cross-fitting), and every reading is predicted by the model that never saw its quarter. The held-out error is
compared with non-learned neighbour estimates computed under the same rules (climatology from the training
quarters only): inverse-distance mean, and climatology plus the robust weighted-median neighbour anomaly.

    python -m app.realdata.gnn_real --year 2023
"""
from __future__ import annotations

import argparse
import json
import math
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import torch
from torch import nn

from . import isd

LAPSE = 0.0065
STEP = timedelta(hours=3)
OUT = Path(__file__).resolve().parents[2] / "models" / "st_gnn_real.json"
QUARTERS = [(1, 2, 3), (4, 5, 6), (7, 8, 9), (10, 11, 12)]


def rh(T: float, Td: float) -> float:
    """Relative humidity from air temperature and dew point (Magnus)."""
    es = lambda x: 6.112 * math.exp(17.62 * x / (243.12 + x))  # noqa: E731
    return max(1.0, min(100.0, 100 * es(Td) / es(T)))


def tensors(stations: dict[str, isd.Station]):
    """Dense arrays on the 3-hourly grid: X (steps, N, 2) sea-level T and RH, M (steps, N, 2) validity."""
    keys = list(stations)
    t0 = min(min(s.obs) for s in stations.values())
    t1 = max(max(s.obs) for s in stations.values())
    steps = int((t1 - t0) / STEP) + 1
    X = np.zeros((steps, len(keys), 2), np.float32)
    M = np.zeros((steps, len(keys), 2), np.float32)
    for j, k in enumerate(keys):
        st = stations[k]
        for t, o in st.obs.items():
            n = int((t - t0) / STEP)
            X[n, j, 0], M[n, j, 0] = o.T + LAPSE * st.elev, 1  # type: ignore[operator]
            if o.Td is not None and o.Td <= o.T + 0.5:  # type: ignore[operator]
                X[n, j, 1], M[n, j, 1] = rh(o.T, o.Td), 1  # type: ignore[arg-type]
    times = [t0 + n * STEP for n in range(steps)]
    return keys, times, X, M


class RealSTGNN(nn.Module):
    def __init__(self, static: torch.Tensor, edge: torch.Tensor, hidden: int = 48, heads: int = 4):
        super().__init__()
        self.register_buffer("static", static)   # (N, 4)
        self.register_buffer("edge", edge)       # (N, N, 4)
        self.heads = heads
        n_in = 2 + 2 + 2 + 4 + 4                 # now, prev, mask, static, time
        self.node = nn.Sequential(nn.Linear(n_in, hidden), nn.GELU(), nn.Linear(hidden, hidden), nn.GELU())
        self.att = nn.Sequential(nn.Linear(hidden + 4 + 4, hidden), nn.GELU(), nn.Linear(hidden, heads))
        self.msg = nn.Sequential(nn.Linear(hidden + 4, hidden), nn.GELU(), nn.Linear(hidden, hidden))
        self.out = nn.Sequential(nn.Linear(hidden + 4 + 4, hidden), nn.GELU(), nn.Linear(hidden, 2))

    def forward(self, x_now, x_prev, mask, tfeat):
        B, N, _ = x_now.shape
        st = self.static.expand(B, N, 4)
        tf = tfeat.unsqueeze(1).expand(B, N, 4)
        h = self.node(torch.cat([x_now * mask, x_prev * mask, mask, st, tf], -1))
        hj = h.unsqueeze(1).expand(B, N, N, h.shape[-1])
        si = st.unsqueeze(2).expand(B, N, N, 4)
        e = self.edge.expand(B, N, N, 4)
        logits = self.att(torch.cat([hj, si, e], -1))
        reporting = (mask[..., 0] > 0).unsqueeze(1).expand(B, N, N)
        valid = reporting & ~torch.eye(N, dtype=torch.bool, device=x_now.device)   # never your own reading
        logits = logits.masked_fill(~valid.unsqueeze(-1), -1e9)
        alpha = torch.softmax(logits, dim=2)
        m = self.msg(torch.cat([hj, e], -1)).view(B, N, N, self.heads, -1)
        agg = (alpha.unsqueeze(-1) * m).sum(2).reshape(B, N, -1)
        return self.out(torch.cat([agg, st, tf], -1))


def time_features(times: list[datetime]) -> np.ndarray:
    h = np.array([t.hour + t.minute / 60 for t in times]) / 24 * 2 * math.pi
    d = np.array([t.timetuple().tm_yday for t in times]) / 365.25 * 2 * math.pi
    return np.stack([np.sin(h), np.cos(h), np.sin(d), np.cos(d)], -1).astype(np.float32)


def graph(stations: dict[str, isd.Station], keys: list[str]):
    s = [stations[k] for k in keys]
    static = torch.tensor([[x.elev / 1000, x.lon - 73.5, x.lat - 18.5, 1.0 if x.lon < 73.0 else 0.0] for x in s])
    edge = torch.tensor([[[b.lon - a.lon, b.lat - a.lat, math.hypot(b.lon - a.lon, b.lat - a.lat), (b.elev - a.elev) / 1000]
                          for b in s] for a in s])
    return static.float(), edge.float()


def baselines(X: np.ndarray, M: np.ndarray, stations, keys: list[str]):
    """Non-learned neighbour estimates of sea-level T for every (step, station): IDW mean and weighted median."""
    N = len(keys)
    d = np.array([[max(1.0, _km(stations[a], stations[b])) for b in keys] for a in keys])
    W = 1 / (d * d + 400)
    np.fill_diagonal(W, 0)
    idw = np.full(X.shape[:2], np.nan, np.float32)
    med = np.full(X.shape[:2], np.nan, np.float32)
    for n in range(X.shape[0]):
        ok = M[n, :, 0] > 0
        for i in range(N):
            nb = ok.copy(); nb[i] = False
            if nb.sum() < 3:
                continue
            idx = np.argsort(np.where(nb, d[i], np.inf))[:5]
            idx = idx[nb[idx]]
            w, v = W[i, idx], X[n, idx, 0]
            idw[n, i] = (w * v).sum() / w.sum()
            o = np.argsort(v); cw = np.cumsum(w[o])
            med[n, i] = v[o][np.searchsorted(cw, cw[-1] / 2)]
    return idw, med


def _km(a: isd.Station, b: isd.Station) -> float:
    p = math.pi / 180
    return 6371 * math.hypot((b.lon - a.lon) * p * math.cos((a.lat + b.lat) * p / 2), (b.lat - a.lat) * p)


def hour_climatology(X: np.ndarray, M: np.ndarray, hours: np.ndarray, rows: np.ndarray) -> np.ndarray:
    """Median value per (station, hour-of-day, variable) using only `rows` (the training quarters)."""
    N = X.shape[1]
    C = np.zeros((N, 24, 2), np.float32)
    for j in range(N):
        for h in range(0, 24, 3):
            for v in range(2):
                sel = rows & (hours == h) & (M[:, j, v] > 0)
                vals = X[sel, j, v]
                C[j, h, v] = np.median(vals) if len(vals) else np.median(X[rows & (M[:, j, v] > 0), j, v]) if (rows & (M[:, j, v] > 0)).any() else 0
    return C


def train_fold(X, M, TF, train_idx, static, edge, mu, sd, epochs: int, seed: int) -> RealSTGNN:
    torch.manual_seed(seed)
    model = RealSTGNN(static, edge)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    Xs = torch.tensor(X / sd); Ms = torch.tensor(M); TFt = torch.tensor(TF)  # X is already an anomaly here
    idx = torch.tensor(train_idx)
    huber = nn.HuberLoss(reduction="none", delta=1.0)
    for ep in range(epochs):
        perm = idx[torch.randperm(len(idx))]
        for b in range(0, len(perm), 64):
            n = perm[b:b + 64]
            now, prev, m, tf = Xs[n], Xs[n - 1], Ms[n], TFt[n]
            pred = model(now, prev * Ms[n - 1], m, tf)
            loss = (huber(pred, now) * m).sum() / m.sum().clamp(min=1)
            rh_pred = pred[..., 1] * sd[1] + mu[1]                        # physics: RH ≤ 100 %
            loss = loss + 0.1 * torch.relu(rh_pred - 100).pow(2).mean() / sd[1] ** 2
            opt.zero_grad(); loss.backward(); opt.step()
    return model


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2023)
    ap.add_argument("--epochs", type=int, default=40)
    a = ap.parse_args()
    t_start = time.time()
    stations = isd.load(a.year)
    keys, times, X, M = tensors(stations)
    TF = time_features(times)
    static, edge = graph(stations, keys)
    months = np.array([t.month for t in times])
    usable = np.array([n > 0 and M[n, :, 0].sum() >= 4 for n in range(len(times))])

    hours = np.array([t.hour for t in times])
    pred = np.full(X.shape, np.nan, np.float32)
    clim_med = np.full(X.shape[:2], np.nan, np.float32)   # fair baseline: climatology + weighted-median anomaly
    for q, qm in enumerate(QUARTERS):
        held = np.isin(months, qm) & usable
        train = (~np.isin(months, qm)) & usable
        C = hour_climatology(X, M, hours, train)             # training quarters only: no leakage
        A = (X - C[:, hours].transpose(1, 0, 2)) * M          # anomalies (steps, N, 2)
        sd = np.array([math.sqrt((A[train, :, v] ** 2 * M[train, :, v]).sum() / M[train, :, v].sum()) for v in range(2)], np.float32)
        model = train_fold(A, M, TF, np.where(train)[0], static, edge, np.zeros(2, np.float32), sd, a.epochs, seed=q)
        model.eval()
        with torch.no_grad():
            n = np.where(held)[0]
            As = torch.tensor(A / sd)
            out = model(As[n], As[n - 1] * torch.tensor(M[n - 1]), torch.tensor(M[n]), torch.tensor(TF[n])).numpy()
            pred[n] = out * sd + C[:, hours[n]].transpose(1, 0, 2)
        _, med_a = baselines(A, M, stations, keys)
        clim_med[held] = med_a[held] + C[:, hours[held], 0].T
        print(f"quarter {q + 1}: trained on {train.sum()} steps, predicted {held.sum()} held-out steps")

    idw, med = baselines(X, M, stations, keys)
    ok = (M[..., 0] > 0) & ~np.isnan(pred[..., 0]) & ~np.isnan(idw) & ~np.isnan(med) & ~np.isnan(clim_med)
    err = {name: (est[ok] - X[..., 0][ok]) for name, est in (("st_gnn", pred[..., 0]), ("idw", idw), ("weighted_median", med),
                                                               ("climatology_plus_median", clim_med))}
    metrics = {name: {"rmse": round(float(np.sqrt((e ** 2).mean())), 3), "mae": round(float(np.abs(e).mean()), 3),
                      "p95_abs": round(float(np.percentile(np.abs(e), 95)), 3)} for name, e in err.items()}
    okr = (M[..., 1] > 0) & ~np.isnan(pred[..., 1])
    metrics["st_gnn_rh"] = {"rmse": round(float(np.sqrt(((pred[..., 1][okr] - X[..., 1][okr]) ** 2).mean())), 2)}

    # Out-of-fold expected station temperature (back from sea level), for the QC build.
    expected = {}
    for j, k in enumerate(keys):
        el = stations[k].elev
        expected[k] = {times[n].isoformat(): round(float(pred[n, j, 0] - LAPSE * el), 2)
                       for n in range(len(times)) if not np.isnan(pred[n, j, 0])}
    meta = {
        "name": "ST-GNN (real data)", "year": a.year, "stations": keys, "epochs": a.epochs,
        "scheme": "4-fold cross-fitting by calendar quarter; every prediction is out-of-fold",
        "evaluated_readings": int(ok.sum()), "metrics": metrics,
        "params": sum(p.numel() for p in RealSTGNN(static, edge).parameters()),
        "train_seconds": round(time.time() - t_start, 1),
    }
    OUT.write_text(json.dumps({**meta, "expected": expected}))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
