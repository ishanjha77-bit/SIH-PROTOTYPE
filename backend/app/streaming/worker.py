"""
Streaming QC worker and station producer.

  producer : every station publishes each 15-minute observation (+ gateway-attached radar/INSAT context)
             to the `aws.raw` topic, the way RTUs would via the MQTT/HTTPS gateway.
  worker   : consumes `aws.raw`, and once all stations for a step have arrived (or a timeout passes)
             runs the five-gate pipeline, writes clean observations with QC flags to the store
             (TimescaleDB) and publishes verdicts to `aws.verdict`.

    BUS=kafka KAFKA_BOOTSTRAP=localhost:9092 STORE=timescale python -m app.streaming.worker --role worker
    BUS=kafka KAFKA_BOOTSTRAP=localhost:9092 python -m app.streaming.worker --role producer --speed 2
    python -m app.streaming.worker --role both --steps 60        # in-memory bus + SQLite, no Docker needed
"""
from __future__ import annotations

import argparse
import asyncio
import time
from typing import Optional

from ..engine.pipeline import evaluate
from ..engine.products import records
from ..engine.sim import INDEX, N, STATIONS, STEPS, TRAIN_K, Scenario, SimResult, default_faults, simulate
from .bus import TOPIC_RAW, TOPIC_VERDICT, make_bus
from .store import make_store


def load_models():
    from ..ml.runtime import load_models as _load
    scorer, spatial, _ = _load()
    return scorer, spatial


async def produce(bus, steps: int, speed: float) -> None:
    sim = simulate(default_faults(), Scenario(), steps)
    for k in range(steps):
        for i, s in enumerate(STATIONS):
            t = sim.TRUE[k][i]
            await bus.publish(TOPIC_RAW, {
                "station": s.id, "k": k, "obs": sim.RAW[k][i],  # None = station silent this step
                "context": {"dbz": t["dbz"], "ctt": t["ctt"], "cs": t["cs"]},
            })
        if speed > 0:
            await asyncio.sleep(1 / speed)


class QCWorker:
    def __init__(self, bus, store, scorer=None, spatial=None) -> None:
        self.bus, self.store, self.scorer, self.spatial = bus, store, scorer, spatial
        self.RAW: list[list[Optional[dict]]] = []
        self.TRUE: list[list[dict]] = []
        self.pending: dict[int, dict[int, dict]] = {}
        self.done = -1
        self.latency_ms: list[float] = []

    def _ingest(self, msg: dict) -> None:
        self.pending.setdefault(msg["k"], {})[INDEX[msg["station"]]] = msg

    def _ready(self, k: int) -> bool:
        return len(self.pending.get(k, {})) == N

    async def _process(self, k: int) -> None:
        t0 = time.perf_counter()
        msgs = self.pending.pop(k)
        self.RAW.append([msgs[i]["obs"] for i in range(N)])
        self.TRUE.append([{**msgs[i]["context"], "stormy": False} for i in range(N)])
        # re-evaluate the stream so far (causal: step k only uses steps ≤ k); O(k) but ~ms per step
        self.done = k
        if k < TRAIN_K - 1:
            return  # warm-up: the first 9 h teach the pipeline each station's normal behaviour
        S = SimResult([], self.TRUE, self.RAW, [[[] for _ in range(N)] for _ in self.RAW])
        E = evaluate(S, self.scorer, self.spatial)
        k_min = 0 if k == TRAIN_K - 1 else k  # flush the warm-up backlog once
        recs = records(E, k, k_min=k_min)
        for n, r in enumerate(recs):
            r["gates"] = E.OUT[k_min + n // N][n % N]["gates"]
        self.store.write(recs)
        await self.bus.publish(TOPIC_VERDICT, {"k": k, "verdicts": [{"station": r["station"], "class": r["class"], "qc": r["qc_clean"], "confidence": r["confidence"]} for r in recs[-N:]]})
        self.latency_ms.append((time.perf_counter() - t0) * 1000)

    async def run(self, steps: int) -> None:
        async for msg in self.bus.subscribe(TOPIC_RAW):
            self._ingest(msg)
            while self._ready(self.done + 1):
                await self._process(self.done + 1)
            if self.done >= steps - 1:
                return


async def main_async(role: str, steps: int, speed: float) -> None:
    bus = make_bus()
    await bus.start()
    try:
        if role == "producer":
            await produce(bus, steps, speed)
            return
        store = make_store()
        scorer, spatial = load_models()
        worker = QCWorker(bus, store, scorer, spatial)
        if role == "both":
            task = asyncio.create_task(worker.run(steps))
            await asyncio.sleep(0)
            await produce(bus, steps, speed)
            await task
        else:
            await worker.run(steps)
        lat = sorted(worker.latency_ms)
        print(f"processed {worker.done + 1} steps · {store.count()} rows stored · median latency {lat[len(lat) // 2]:.0f} ms/step")
    finally:
        await bus.stop()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--role", choices=["producer", "worker", "both"], default="both")
    ap.add_argument("--steps", type=int, default=STEPS)
    ap.add_argument("--speed", type=float, default=0, help="steps per second for the producer (0 = as fast as possible)")
    a = ap.parse_args()
    asyncio.run(main_async(a.role, a.steps, a.speed))


if __name__ == "__main__":
    main()
