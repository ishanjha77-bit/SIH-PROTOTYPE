"""
Train the ST-GNN spatial predictor with a physics-informed loss.

    python -m app.ml.train_gnn          # ~1 min on a laptop CPU
Then retrain the autoencoder on ST-GNN residuals:
    python -m app.ml.train
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch
from torch import nn

from ..engine.sim import LAPSE, N, STATIONS, TRAIN_K, W, simulate
from .gnn import ELEV, META, MODEL_DIR, STGNN, WEIGHTS, es_torch, to_sealevel
from .train import scenario


def run_arrays(seed: int) -> np.ndarray:
    sim = simulate([], scenario(seed))
    return np.array([[to_sealevel(o, i) for i, o in enumerate(row)] for row in sim.RAW], dtype=np.float32)  # (K, N, 4)


def idw_rmse(A: np.ndarray) -> np.ndarray:
    """Baseline: inverse-distance neighbour mean + per-station bias learned in the first 9 h (what the pipeline used)."""
    Wm = np.array(W)
    est = np.einsum("ij,kjv->kiv", Wm, A) / Wm.sum(1)[None, :, None]
    bias = (A[:TRAIN_K] - est[:TRAIN_K]).mean(0)
    err = A[TRAIN_K:] - (est[TRAIN_K:] + bias)
    return np.sqrt((err ** 2).mean(axis=(0, 1)))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenarios", type=int, default=48)
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--hidden", type=int, default=64)
    ap.add_argument("--heads", type=int, default=4)
    ap.add_argument("--physics", type=float, default=1.0, help="weight of the physics-informed loss terms")
    args = ap.parse_args()
    torch.manual_seed(11)
    t0 = time.time()

    train = [run_arrays(s) for s in range(1, args.scenarios + 1)]
    val = [run_arrays(s) for s in range(1001, 1007)]
    allx = np.concatenate(train).reshape(-1, 4)
    mu, sd = allx.mean(0), allx.std(0)

    def pairs(arrs):
        now = np.concatenate([a[1:] for a in arrs])
        prev = np.concatenate([a[:-1] for a in arrs])
        return torch.from_numpy((now - mu) / sd), torch.from_numpy((prev - mu) / sd), torch.from_numpy(now)
    Xn, Xp, Xraw = pairs(train)
    Vn, Vp, Vraw = pairs(val)
    print(f"graphs: train {len(Xn):,}  val {len(Vn):,}  ({time.time() - t0:.0f}s)")

    model = STGNN(args.hidden, args.heads)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.epochs)
    mu_t, sd_t = torch.from_numpy(mu), torch.from_numpy(sd)

    def physics_loss(pred, raw_now, mask, alpha):
        p = pred * sd_t + mu_t
        T = p[..., 0] - LAPSE * ELEV
        RH = p[..., 1]
        es = es_torch(T)
        e = RH.clamp(min=0) / 100 * es
        sat = torch.relu(e - es) ** 2                                      # Clausius–Clapeyron saturation bound
        Tn = raw_now[..., 0] - LAPSE * ELEV
        e_nb_all = raw_now[..., 1] / 100 * es_torch(Tn)                     # neighbours' vapour pressure
        a = alpha.mean(-1)                                                  # (B, N, N) attention over sources
        e_nb = (a * (e_nb_all * (mask[..., 1] > 0)).unsqueeze(1)).sum(-1)
        cont = (e - e_nb) ** 2 / 100                                        # moisture continuity
        wind = torch.relu(-p[..., 3]) ** 2
        return (sat + cont + wind).mean()

    for ep in range(args.epochs):
        model.train()
        perm = torch.randperm(len(Xn))
        tot = phys = 0.0
        for b in range(0, len(Xn), 64):
            idx = perm[b:b + 64]
            xn, xp, raw = Xn[idx], Xp[idx], Xraw[idx]
            B = len(idx)
            mask = (torch.rand(B, N, 4) > 0.15).float() * (torch.rand(B, N, 1) > 0.1).float()  # random sensor/station dropout
            pred, alpha = model(xn, xp, mask)
            mse = ((pred - xn) ** 2).mean()
            pl = physics_loss(pred, raw, mask, alpha)
            loss = mse + args.physics * pl
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += mse.item() * B
            phys += pl.item() * B
        sched.step()
        model.eval()
        with torch.no_grad():
            vp, _ = model(Vn, Vp, torch.ones_like(Vn))
            vl = ((vp - Vn) ** 2).mean().item()
        print(f"  epoch {ep + 1:2d}  mse {tot / len(Xn):.4f}  physics {phys / len(Xn):.4f}  val {vl:.4f}")

    model.eval()
    with torch.no_grad():
        vp, _ = model(Vn, Vp, torch.ones_like(Vn))
    pv = vp.numpy() * sd + mu
    gnn_rmse = np.sqrt(((pv - Vraw.numpy()) ** 2).mean(axis=(0, 1)))
    base_rmse = np.mean([idw_rmse(a) for a in val], axis=0)
    T = pv[..., 0] - LAPSE * ELEV.numpy()
    es = 6.112 * np.exp(2.501e6 / 461.5 * (1 / 273.15 - 1 / (T + 273.15)))
    violations = float(((pv[..., 1] / 100 * es) > es * 1.005).mean())

    MODEL_DIR.mkdir(exist_ok=True)
    torch.save(model.state_dict(), WEIGHTS)
    meta = {
        "name": "WeatherGuard ST-GNN", "version": "0.1.0", "hidden": args.hidden, "heads": args.heads,
        "mu": mu.tolist(), "sd": sd.tolist(), "params": sum(p.numel() for p in model.parameters()),
        "scenarios": args.scenarios, "epochs": args.epochs, "physics_weight": args.physics,
        "rmse": {v: {"st_gnn": round(float(g), 3), "idw": round(float(b), 3)} for v, g, b in zip(("T", "RH", "P", "W"), gnn_rmse, base_rmse)},
        "physics_violations": violations,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "train_seconds": round(time.time() - t0, 1),
    }
    META.write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta["rmse"], indent=2), "violations", violations)


if __name__ == "__main__":
    main()
