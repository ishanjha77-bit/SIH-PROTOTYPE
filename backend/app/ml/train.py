"""
Train the LSTM-autoencoder on fault-free simulated scenarios, calibrate its threshold, evaluate it on
the reference demo run, and export ONNX for edge (TinyML) deployment.

    python -m app.ml.train                 # default: 48 training scenarios, ~1–2 min on a laptop CPU
    python -m app.ml.train --scenarios 12  # quicker
"""
from __future__ import annotations

import argparse
import json
import random
import time

import numpy as np
import torch
from torch import nn

from ..engine.pipeline import FAULT_CLS, run
from ..engine.sim import N, Scenario, default_faults
from .gnn import GNNPredictor
from .model import CLIP, META, MODEL_DIR, WEIGHTS, LSTMAutoencoder, window_error

SPATIAL = None  # set in main(): ST-GNN if trained, else inverse-distance

WINDOW = 16  # 4 hours of 15-min steps
RECENT = 4


def scenario(seed: int) -> Scenario:
    rng = random.Random(seed)
    if rng.random() < 0.25:
        return Scenario(seed=seed, storm=False)
    sk = rng.uniform(60, 220)
    return Scenario(seed=seed, storm_k=sk, storm_speed=rng.uniform(0.035, 0.08), storm_rain=rng.uniform(25, 70),
                    storm_on=(int(sk - 10), int(sk - 2), int(sk + 57), int(sk + 72)))


def windows_from_run(seed: int) -> np.ndarray:
    E = run([], scenario(seed), spatial=SPATIAL)
    out = []
    for i in range(N):
        seq = [E.features[k][i] for k in range(len(E.features))]
        for k in range(WINDOW - 1, len(seq)):
            w = seq[k - WINDOW + 1:k + 1]
            if all(v is not None for v in w):
                out.append(w)
    return np.clip(np.array(out, dtype=np.float32), -CLIP, CLIP)


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    allv = np.concatenate([pos, neg])
    ranks = allv.argsort().argsort().astype(float) + 1
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", type=int, default=48)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--latent", type=int, default=8)
    ap.add_argument("--recalibrate", action="store_true", help="reuse saved weights, only recalibrate + evaluate")
    args = ap.parse_args()
    global SPATIAL
    SPATIAL = GNNPredictor.load()
    print("spatial predictor:", SPATIAL.name if SPATIAL else "idw")
    torch.manual_seed(7)
    np.random.seed(7)
    t0 = time.time()

    print(f"Generating {args.scenarios if not args.recalibrate else 0} fault-free training scenarios …")
    X = np.concatenate([windows_from_run(s) for s in range(1, (args.scenarios if not args.recalibrate else 2) + 1)])
    V = np.concatenate([windows_from_run(s) for s in range(1001, 1007)])
    print(f"  train windows {len(X):,}  val windows {len(V):,}  ({time.time() - t0:.0f}s)")

    model = LSTMAutoencoder(5, args.hidden, args.latent)
    opt = torch.optim.Adam(model.parameters(), lr=3e-3)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    Xt, Vt = torch.from_numpy(X), torch.from_numpy(V)
    loss_fn = nn.MSELoss()
    if args.recalibrate:
        model.load_state_dict(torch.load(WEIGHTS, map_location="cpu", weights_only=True))
        old = json.loads(META.read_text())
        args.scenarios, args.epochs = old["scenarios"], old["epochs"]
    for ep in range(0 if args.recalibrate else args.epochs):
        model.train()
        perm = torch.randperm(len(Xt))
        tot = 0.0
        for b in range(0, len(Xt), 512):
            xb = Xt[perm[b:b + 512]]
            opt.zero_grad()
            loss = loss_fn(model(xb), xb)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += loss.item() * len(xb)
        sched.step()
        model.eval()
        with torch.no_grad():
            vl = loss_fn(model(Vt), Vt).item()
        print(f"  epoch {ep + 1:2d}  train {tot / len(Xt):.4f}  val {vl:.4f}")

    model.eval()
    val_err = window_error(model, Vt, RECENT).numpy()
    threshold = float(np.quantile(val_err, 0.999))

    # ---- evaluate on the reference demo run (with injected faults) ----
    from .model import AEScorer
    scorer = AEScorer(model, WINDOW, threshold, RECENT)
    E = run(default_faults(), Scenario(), scorer, spatial=SPATIAL)
    pos, neg = [], []
    for k in range(len(E.OUT)):
        for i in range(N):
            d = E.OUT[k][i]
            if E.sim.RAW[k][i] is None:
                continue
            (pos if E.sim.TRUTH[k][i] else neg).append(d["score"])
    ae_auc = auc(np.array(pos), np.array(neg))
    fp_anom = sum(1 for k in range(len(E.OUT)) for i in range(N)
                  if E.OUT[k][i]["cls"] == "ANOMALY" and not E.sim.TRUTH[k][i])
    wg_fp = sum(1 for k in range(len(E.OUT)) for i in range(N)
                if E.OUT[k][i]["cls"] in FAULT_CLS and not E.sim.TRUTH[k][i])

    MODEL_DIR.mkdir(exist_ok=True)
    torch.save(model.state_dict(), WEIGHTS)
    n_params = sum(p.numel() for p in model.parameters())
    meta = {
        "name": "WeatherGuard LSTM-autoencoder", "version": "0.1.0", "window": WINDOW, "recent": RECENT,
        "n_features": 5, "hidden": args.hidden, "latent": args.latent, "threshold": threshold,
        "features": ["z_T", "z_RH", "z_P", "z_W", "rain_minus_radar"], "params": n_params,
        "train_windows": int(len(X)) if not args.recalibrate else json.loads(META.read_text())["train_windows"], "val_windows": int(len(V)), "scenarios": args.scenarios, "epochs": args.epochs,
        "val_loss": float(((model(Vt) - Vt) ** 2).mean().item()),
        "eval": {"roc_auc_fault_vs_normal": round(ae_auc, 4), "anomaly_false_positives": fp_anom, "pipeline_false_positives": wg_fp},
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "train_seconds": round(time.time() - t0, 1),
        "spatial": SPATIAL.name if SPATIAL else "idw",
    }
    # ---- ONNX export for edge / TinyML ----
    try:
        onnx_path = MODEL_DIR / "lstm_ae.onnx"
        torch.onnx.export(model, torch.zeros(1, WINDOW, 5), onnx_path, input_names=["window"], output_names=["reconstruction"],
                          dynamic_axes={"window": {0: "batch"}, "reconstruction": {0: "batch"}}, opset_version=17, dynamo=False)
        meta["onnx_bytes"] = onnx_path.stat().st_size
    except Exception as exc:  # onnx is optional
        meta["onnx_error"] = str(exc)[:200]
    META.write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta["eval"], indent=2))
    benchmarks(X, V, E)
    print(f"Saved {WEIGHTS.name} ({n_params:,} params), threshold {threshold:.4f}, total {time.time() - t0:.0f}s")


def benchmarks(X: np.ndarray, V: np.ndarray, E) -> None:
    """Compare against the classical detectors cited in the deck (Isolation Forest, LOF, One-Class SVM),
    trained on the same features and calibrated to the same 99.9th-percentile false-alarm budget."""
    from sklearn.ensemble import IsolationForest
    from sklearn.neighbors import LocalOutlierFactor
    from sklearn.svm import OneClassSVM

    rng = np.random.default_rng(3)
    Xo, Vo = X[:, -1, :], V[:, -1, :]  # per-observation feature vectors
    models = {
        "Isolation Forest": IsolationForest(n_estimators=200, random_state=0).fit(Xo[rng.choice(len(Xo), 30000, replace=False)]),
        "Local Outlier Factor": LocalOutlierFactor(n_neighbors=35, novelty=True).fit(Xo[rng.choice(len(Xo), 15000, replace=False)]),
        "One-Class SVM": OneClassSVM(nu=0.01, gamma="scale").fit(Xo[rng.choice(len(Xo), 5000, replace=False)]),
    }
    rows, obs = [], []
    for k in range(len(E.OUT)):
        for i in range(N):
            if E.sim.RAW[k][i] is None or E.features[k][i] is None:
                continue
            obs.append((np.clip(E.features[k][i], -CLIP, CLIP), bool(E.sim.TRUTH[k][i]), E.sim.TRUE[k][i]["stormy"], E.OUT[k][i], E.LEG[k][i]["flag"]))
    F = np.array([o[0] for o in obs], dtype=np.float32)
    truth = np.array([o[1] for o in obs])
    stormy = np.array([o[2] and not o[1] for o in obs])

    def row(name, flags, kind):
        tp = int((flags & truth).sum()); fp = int((flags & ~truth).sum()); fn = int((~flags & truth).sum())
        rows.append({"method": name, "kind": kind, "recall": round(tp / max(1, tp + fn), 4), "precision": round(tp / max(1, tp + fp), 4),
                     "false_alarms": fp, "storm_rejected": int((flags & stormy).sum())})

    for name, m in models.items():
        thr = np.quantile(-m.decision_function(Vo), 0.999)
        row(name, -m.decision_function(F) > thr, "classical ML")
    row("LSTM-autoencoder alone", np.array([o[3]["score"] > 6.5 for o in obs]), "deep learning")
    row("Legacy rule-based QC", np.array([o[4] for o in obs]), "rules")
    row("WeatherGuard (full pipeline)", np.array([o[3]["cls"] in FAULT_CLS for o in obs]), "physics + AI")
    (MODEL_DIR / "benchmarks.json").write_text(json.dumps({"observations": len(obs), "faulty": int(truth.sum()), "storm": int(stormy.sum()), "rows": rows}, indent=2))
    for r in rows:
        print(f"  {r['method']:30s} recall {r['recall']:.3f}  precision {r['precision']:.3f}  FA {r['false_alarms']:4d}  storm rejected {r['storm_rejected']}")


if __name__ == "__main__":
    main()
