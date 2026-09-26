"""
Export both models to ONNX so the server (and edge devices) can run them with ONNX Runtime — no PyTorch.

    python -m app.ml.export_onnx

Writes models/st_gnn.onnx, models/lstm_ae.onnx and an int8-quantised models/lstm_ae.int8.onnx
(dynamic quantisation, for the TinyML / RTU size budget), and checks each against PyTorch.
"""
from __future__ import annotations

import json

import numpy as np
import torch
from torch import nn

from ..engine.sim import N
from .gnn import GNNPredictor
from .gnn import META as GNN_META
from .model import META as AE_META
from .model import MODEL_DIR, AEScorer


class _GNNOut(nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x_now, x_prev, mask):
        return self.m(x_now, x_prev, mask)[0]


def main() -> None:
    import onnxruntime as ort

    g = GNNPredictor.load()
    ae = AEScorer.load()
    assert g and ae, "train first: python -m app.ml.train_gnn && python -m app.ml.train"

    # ---- ST-GNN ----
    path = MODEL_DIR / "st_gnn.onnx"
    x = torch.randn(1, N, 4)
    m = (torch.rand(1, N, 4) > 0.2).float()
    torch.onnx.export(_GNNOut(g.model), (x, x, m), path, input_names=["x_now", "x_prev", "mask"], output_names=["expected"],
                      opset_version=17, dynamo=False)
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    ref = g.model(x, x, m)[0].detach().numpy()
    got = sess.run(None, {"x_now": x.numpy(), "x_prev": x.numpy(), "mask": m.numpy()})[0]
    gnn_err = float(np.abs(ref - got).max())

    # ---- LSTM-AE (fp32 + int8) ----
    ae_path = MODEL_DIR / "lstm_ae.onnx"
    torch.onnx.export(ae.model, torch.zeros(1, ae.window, 5), ae_path, input_names=["window"], output_names=["reconstruction"],
                      dynamic_axes={"window": {0: "batch"}, "reconstruction": {0: "batch"}}, opset_version=17, dynamo=False)
    q_path = MODEL_DIR / "lstm_ae.int8.onnx"
    from onnxruntime.quantization import QuantType, quantize_dynamic
    quantize_dynamic(str(ae_path), str(q_path), weight_type=QuantType.QInt8)
    w = np.random.default_rng(0).normal(size=(256, ae.window, 5)).astype(np.float32)
    fp = ort.InferenceSession(str(ae_path), providers=["CPUExecutionProvider"]).run(None, {"window": w})[0]
    q8 = ort.InferenceSession(str(q_path), providers=["CPUExecutionProvider"]).run(None, {"window": w})[0]
    e_fp = ((fp[:, -4:] - w[:, -4:]) ** 2).mean(axis=(1, 2))
    e_q8 = ((q8[:, -4:] - w[:, -4:]) ** 2).mean(axis=(1, 2))
    corr = float(np.corrcoef(e_fp, e_q8)[0, 1])

    for meta_path, extra in ((GNN_META, {"onnx_bytes": path.stat().st_size, "onnx_max_abs_error": gnn_err}),
                             (AE_META, {"onnx_bytes": ae_path.stat().st_size, "int8_onnx_bytes": q_path.stat().st_size,
                                        "int8_score_correlation": round(corr, 4)})):
        meta = json.loads(meta_path.read_text())
        meta.update(extra)
        meta_path.write_text(json.dumps(meta, indent=2))
    print(f"st_gnn.onnx {path.stat().st_size / 1024:.0f} KB (max abs err {gnn_err:.2e}) · lstm_ae.onnx {ae_path.stat().st_size / 1024:.0f} KB · "
          f"int8 {q_path.stat().st_size / 1024:.0f} KB (score corr {corr:.4f})")


if __name__ == "__main__":
    main()
