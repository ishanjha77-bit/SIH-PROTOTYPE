"""
Observation store. TimescaleDB (PostgreSQL + hypertables) in deployment; SQLite locally.
Select with STORE=timescale|sqlite and DATABASE_URL=postgresql://user:pass@host:5432/db.
"""
from __future__ import annotations

import json
import os
import sqlite3

COLUMNS = ("time", "station", "class", "qc_raw", "qc_clean", "confidence", "burst_mode",
           "T_raw", "T", "RH_raw", "RH", "P_raw", "P", "W_raw", "W", "S_raw", "S", "R_raw", "R")

DDL_PG = """
CREATE TABLE IF NOT EXISTS observations (
  time TIMESTAMPTZ NOT NULL, station TEXT NOT NULL, class TEXT NOT NULL,
  qc_raw SMALLINT, qc_clean SMALLINT, confidence REAL, burst_mode BOOLEAN,
  "T_raw" REAL, "T" REAL, "RH_raw" REAL, "RH" REAL, "P_raw" REAL, "P" REAL,
  "W_raw" REAL, "W" REAL, "S_raw" REAL, "S" REAL, "R_raw" REAL, "R" REAL,
  gates JSONB, PRIMARY KEY (station, time)
);
SELECT create_hypertable('observations', 'time', if_not_exists => TRUE);
"""


class SqliteStore:
    def __init__(self, path: str = "weatherguard.db") -> None:
        self.db = sqlite3.connect(path)
        cols = ", ".join(f'"{c}"' for c in COLUMNS)
        self.db.execute(f"CREATE TABLE IF NOT EXISTS observations ({cols}, gates TEXT, PRIMARY KEY (station, time))")

    def write(self, recs: list[dict]) -> None:
        cols = ", ".join(f'"{c}"' for c in COLUMNS)
        q = f"INSERT OR REPLACE INTO observations ({cols}, gates) VALUES ({', '.join('?' * (len(COLUMNS) + 1))})"
        self.db.executemany(q, [tuple(r.get(c) for c in COLUMNS) + (json.dumps(r.get("gates", [])),) for r in recs])
        self.db.commit()

    def count(self) -> int:
        return self.db.execute("SELECT COUNT(*) FROM observations").fetchone()[0]


class TimescaleStore:
    def __init__(self, url: str) -> None:
        import psycopg
        self.conn = psycopg.connect(url, autocommit=True)
        with self.conn.cursor() as cur:
            cur.execute(DDL_PG)

    def write(self, recs: list[dict]) -> None:
        cols = ", ".join(f'"{c}"' if c[0].isupper() else c for c in COLUMNS)
        upd = ", ".join(f'{c} = EXCLUDED.{c}' for c in (f'"{x}"' if x[0].isupper() else x for x in COLUMNS[2:]))
        q = f"INSERT INTO observations ({cols}, gates) VALUES ({', '.join(['%s'] * (len(COLUMNS) + 1))}) ON CONFLICT (station, time) DO UPDATE SET {upd}, gates = EXCLUDED.gates"
        with self.conn.cursor() as cur:
            cur.executemany(q, [tuple(r.get(c) for c in COLUMNS) + (json.dumps(r.get("gates", [])),) for r in recs])

    def count(self) -> int:
        with self.conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM observations")
            return cur.fetchone()[0]


def make_store():
    if os.getenv("STORE", "sqlite") == "timescale":
        return TimescaleStore(os.getenv("DATABASE_URL", "postgresql://weatherguard:weatherguard@localhost:5432/weatherguard"))
    return SqliteStore(os.getenv("SQLITE_PATH", "weatherguard.db"))
