#!/usr/bin/env python3
"""Simulate several concurrent dashboard users hitting the real backend, to
answer "will this fall over with more agents logged in at once?" with real
numbers instead of a guess.

Targets http://localhost:8000 by default (the LOCAL backend, tunneled to the
real production MongoDB) rather than the public domain — this measures
whether the backend/DB itself is the bottleneck, without putting any load on
the live public-facing deployment or anything in front of it (Coolify/
Cloudflare/etc). Only hits read-only, side-effect-free endpoints — never a
send/write route.

Usage:
    # 1. Get a real session token: log into the app in your browser, open
    #    devtools -> Application -> Local Storage -> user_token.
    # 2. Make sure the local backend is running (uvicorn on :8000) and the
    #    Mongo SSH tunnel is up.
    USER_TOKEN=<paste it> python load_test.py --users 20 --duration 30
"""
import argparse
import concurrent.futures
import os
import sys
import threading
import time

import requests

ENDPOINTS = [
    "/api/companies/meta",
    "/api/companies?page=1&page_size=20",
    "/api/conversations",
    "/api/conversations/last-activity",
    "/api/analytics?page=1&page_size=20",
]


def _worker(base_url: str, token: str, stop_at: float, results: list, lock: threading.Lock):
    session = requests.Session()
    session.headers["x-user-token"] = token
    local = []
    i = 0
    while time.monotonic() < stop_at:
        path = ENDPOINTS[i % len(ENDPOINTS)]
        i += 1
        t0 = time.monotonic()
        try:
            r = session.get(base_url + path, timeout=15)
            local.append((path, r.status_code, time.monotonic() - t0))
        except Exception:
            local.append((path, "ERROR", time.monotonic() - t0))
    with lock:
        results.extend(local)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--users", type=int, default=20, help="concurrent simulated users (default 20)")
    ap.add_argument("--duration", type=int, default=30, help="seconds to run (default 30)")
    ap.add_argument("--base-url", default="http://localhost:8000")
    args = ap.parse_args()

    token = os.environ.get("USER_TOKEN")
    if not token:
        print("Set USER_TOKEN to a real session token first (see this script's docstring).", file=sys.stderr)
        sys.exit(1)

    results: list = []
    lock = threading.Lock()
    stop_at = time.monotonic() + args.duration

    print(f"Simulating {args.users} concurrent users for {args.duration}s against {args.base_url} ...\n")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.users) as ex:
        futures = [ex.submit(_worker, args.base_url, token, stop_at, results, lock) for _ in range(args.users)]
        concurrent.futures.wait(futures)

    by_path: dict = {}
    for path, status, elapsed in results:
        b = by_path.setdefault(path, {"count": 0, "errors": 0, "times": []})
        b["count"] += 1
        b["times"].append(elapsed)
        if status != 200:
            b["errors"] += 1

    total_errors = sum(v["errors"] for v in by_path.values())
    print(f"Total requests: {len(results)}  |  Total errors: {total_errors}\n")
    print(f"{'Endpoint':<42}{'Count':>7}{'Errors':>8}{'p50(s)':>9}{'p95(s)':>9}{'max(s)':>9}")
    for path, v in by_path.items():
        times = sorted(v["times"])
        p50 = times[len(times) // 2] if times else 0
        p95 = times[int(len(times) * 0.95)] if times else 0
        mx = max(times) if times else 0
        print(f"{path:<42}{v['count']:>7}{v['errors']:>8}{p50:>9.3f}{p95:>9.3f}{mx:>9.3f}")

    if total_errors:
        print(f"\n{total_errors} request(s) failed — see status codes above 200 or ERROR entries.")
    else:
        print("\nNo failed requests.")


if __name__ == "__main__":
    main()
