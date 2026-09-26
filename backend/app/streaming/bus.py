"""
Tier-2 ingestion bus. Kafka (or Redpanda, which speaks the Kafka API) in deployment; an in-memory
bus for tests and laptops without Docker. Select with BUS=kafka|memory and KAFKA_BOOTSTRAP=host:port.
"""
from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from typing import AsyncIterator

TOPIC_RAW = "aws.raw"          # station observations enriched with radar/satellite context
TOPIC_VERDICT = "aws.verdict"  # pipeline output


class MemoryBus:
    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue]] = defaultdict(list)

    async def start(self) -> None: ...
    async def stop(self) -> None: ...

    async def publish(self, topic: str, msg: dict) -> None:
        for q in self._queues[topic]:
            await q.put(msg)

    async def subscribe(self, topic: str) -> AsyncIterator[dict]:
        q: asyncio.Queue = asyncio.Queue()
        self._queues[topic].append(q)
        while True:
            yield await q.get()


class KafkaBus:
    def __init__(self, bootstrap: str) -> None:
        self.bootstrap = bootstrap
        self._producer = None

    async def start(self) -> None:
        from aiokafka import AIOKafkaProducer
        self._producer = AIOKafkaProducer(bootstrap_servers=self.bootstrap, value_serializer=lambda v: json.dumps(v).encode(),
                                          key_serializer=lambda k: k.encode() if k else None, linger_ms=20)
        await self._producer.start()

    async def stop(self) -> None:
        if self._producer:
            await self._producer.stop()

    async def publish(self, topic: str, msg: dict) -> None:
        # key by station so each station's readings stay ordered within a partition
        await self._producer.send_and_wait(topic, msg, key=msg.get("station"))

    async def subscribe(self, topic: str) -> AsyncIterator[dict]:
        from aiokafka import AIOKafkaConsumer
        consumer = AIOKafkaConsumer(topic, bootstrap_servers=self.bootstrap, group_id="weatherguard-qc",
                                    value_deserializer=lambda v: json.loads(v.decode()), auto_offset_reset="earliest")
        await consumer.start()
        try:
            async for rec in consumer:
                yield rec.value
        finally:
            await consumer.stop()


def make_bus():
    if os.getenv("BUS", "memory") == "kafka":
        return KafkaBus(os.getenv("KAFKA_BOOTSTRAP", "localhost:9092"))
    return MemoryBus()
