#!/usr/bin/env python3
"""Backup the production MongoDB and prune old backups.

Retention policy (2026-09-30, requested after finding the only existing
backup was a single manual one-off, 9 days stale, with no automation):
  - Keep EVERY backup made during the current calendar month.
  - For each PAST month, keep only the single most recent backup and
    delete the rest — one monthly snapshot per past month instead of an
    ever-growing pile, while the current month still has full daily-ish
    granularity in case a recent issue needs a specific day restored.

Usage (cron, daily):
    0 3 * * * MONGODB_URI=... python3 /path/to/backup_mongo.py >> /var/log/mongo-backup.log 2>&1

Requires `mongodump` on PATH (mongodb-database-tools package) and a
MONGODB_URI environment variable pointing at the database to back up —
reads it from the environment only, never logs or prints it.
"""
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", Path(__file__).resolve().parents[3] / "backups"))
_NAME_RE = re.compile(r"^backup_(\d{8})_(\d{6})\.archive\.gz$")


def run_backup() -> Path:
    mongodb_uri = os.environ.get("MONGODB_URI")
    if not mongodb_uri:
        print("MONGODB_URI not set — aborting", file=sys.stderr)
        sys.exit(1)

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = BACKUP_DIR / f"backup_{timestamp}.archive.gz"

    result = subprocess.run(
        ["mongodump", f"--uri={mongodb_uri}", f"--archive={out_file}", "--gzip"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        # mongodump's own stderr can echo back parts of the URI (password
        # excluded) — that's the tool's own standard behavior, not something
        # this script adds; nothing here prints mongodb_uri itself.
        print(f"mongodump failed (exit {result.returncode}):\n{result.stderr}", file=sys.stderr)
        sys.exit(1)

    size_mb = out_file.stat().st_size / 1_048_576
    print(f"Backup created: {out_file.name} ({size_mb:.1f} MB)")
    return out_file


def _parse_backup_dt(path: Path) -> datetime | None:
    m = _NAME_RE.match(path.name)
    if not m:
        return None
    return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")


def apply_retention(now: datetime | None = None) -> None:
    now = now or datetime.now()
    current_month = (now.year, now.month)

    by_month: dict[tuple[int, int], list[tuple[datetime, Path]]] = {}
    for f in BACKUP_DIR.glob("backup_*.archive.gz"):
        dt = _parse_backup_dt(f)
        if dt is None:
            continue
        by_month.setdefault((dt.year, dt.month), []).append((dt, f))

    for month_key, entries in by_month.items():
        if month_key == current_month:
            continue  # keep every backup made this month
        entries.sort(key=lambda pair: pair[0])
        for _, stale in entries[:-1]:  # keep only the most recent of that past month
            stale.unlink()
            print(f"Deleted old backup: {stale.name}")


if __name__ == "__main__":
    run_backup()
    apply_retention()
