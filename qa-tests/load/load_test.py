"""
Chhath Radio — Load / Stress Test
===================================
Uses Python's concurrent.futures to simulate N concurrent users hitting
the API. Records latency percentiles, error rates, and throughput.

Usage:
    python qa-tests/load/load_test.py [--url URL] [--users N] [--duration S]

Examples:
    # 50 concurrent users for 30 seconds
    python qa-tests/load/load_test.py --users 50 --duration 30

    # 500 users against production
    python qa-tests/load/load_test.py --url https://api.chhathradio.com --users 500 --duration 60

Requirements:
    pip install requests

Outcome is saved to qa-tests/outcomes/load_TIMESTAMP.json
"""

import argparse
import json
import os
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

# ─── Endpoints to test ────────────────────────────────────────────────────────

ENDPOINTS = [
    ("GET", "/health",              None),
    ("GET", "/api/songs",           None),
    ("GET", "/api/radio/queue",     None),
    ("GET", "/api/presence/count",  None),
    ("GET", "/api/facts",           None),
]

# ─── Worker ───────────────────────────────────────────────────────────────────

def worker(base_url: str, stop_event: threading.Event, results: list, lock: threading.Lock):
    session = requests.Session()
    while not stop_event.is_set():
        for method, path, body in ENDPOINTS:
            if stop_event.is_set():
                break
            url = f"{base_url}{path}"
            start = time.perf_counter()
            try:
                r = session.request(method, url, json=body, timeout=10)
                elapsed_ms = (time.perf_counter() - start) * 1000
                with lock:
                    results.append({
                        "endpoint": path,
                        "status": r.status_code,
                        "latency_ms": elapsed_ms,
                        "ok": r.status_code < 400,
                    })
            except Exception as exc:
                elapsed_ms = (time.perf_counter() - start) * 1000
                with lock:
                    results.append({
                        "endpoint": path,
                        "status": 0,
                        "latency_ms": elapsed_ms,
                        "ok": False,
                        "error": str(exc),
                    })

# ─── Main ─────────────────────────────────────────────────────────────────────

def run_load_test(base_url: str, num_users: int, duration_s: int) -> dict:
    print(f"\n🪔  Chhath Radio — Load Test")
    print(f"   URL:      {base_url}")
    print(f"   Users:    {num_users} concurrent")
    print(f"   Duration: {duration_s}s")
    print()

    results = []
    lock = threading.Lock()
    stop_event = threading.Event()

    start_time = time.time()

    with ThreadPoolExecutor(max_workers=num_users) as executor:
        futures = [
            executor.submit(worker, base_url, stop_event, results, lock)
            for _ in range(num_users)
        ]

        # Progress bar
        while time.time() - start_time < duration_s:
            elapsed = time.time() - start_time
            pct = int((elapsed / duration_s) * 40)
            bar = "█" * pct + "░" * (40 - pct)
            req_count = len(results)
            print(f"\r  [{bar}] {elapsed:.0f}s / {duration_s}s  |  {req_count} requests", end="", flush=True)
            time.sleep(0.5)

        stop_event.set()
        print()

    total_time = time.time() - start_time

    # ── Analyse results ───────────────────────────────────────────────────────

    if not results:
        print("  ✗  No results collected.")
        return {}

    latencies = [r["latency_ms"] for r in results]
    errors = [r for r in results if not r["ok"]]
    total = len(results)
    error_count = len(errors)
    success_count = total - error_count

    latencies_sorted = sorted(latencies)
    p50 = statistics.median(latencies_sorted)
    p95 = latencies_sorted[int(len(latencies_sorted) * 0.95)]
    p99 = latencies_sorted[int(len(latencies_sorted) * 0.99)]
    throughput = total / total_time

    # Per-endpoint breakdown
    endpoints_seen = set(r["endpoint"] for r in results)
    endpoint_stats = {}
    for ep in endpoints_seen:
        ep_results = [r for r in results if r["endpoint"] == ep]
        ep_latencies = sorted(r["latency_ms"] for r in ep_results)
        ep_errors = sum(1 for r in ep_results if not r["ok"])
        endpoint_stats[ep] = {
            "requests": len(ep_results),
            "errors": ep_errors,
            "p50_ms": round(statistics.median(ep_latencies), 1),
            "p95_ms": round(ep_latencies[int(len(ep_latencies) * 0.95)], 1),
        }

    # ── Print summary ─────────────────────────────────────────────────────────

    print(f"\n  ─────────────────────────────────────────────")
    print(f"  Total requests:  {total}")
    print(f"  Successful:      {success_count} ({100*success_count/total:.1f}%)")
    print(f"  Errors:          {error_count} ({100*error_count/total:.1f}%)")
    print(f"  Throughput:      {throughput:.1f} req/s")
    print(f"  Latency P50:     {p50:.1f} ms")
    print(f"  Latency P95:     {p95:.1f} ms")
    print(f"  Latency P99:     {p99:.1f} ms")
    print(f"  ─────────────────────────────────────────────")
    print(f"\n  Per-endpoint breakdown:")
    for ep, stats in sorted(endpoint_stats.items()):
        status = "✓" if stats["errors"] == 0 else "✗"
        print(f"    {status}  {ep:<30} P50={stats['p50_ms']}ms  P95={stats['p95_ms']}ms  errors={stats['errors']}")

    # ── SLO check ─────────────────────────────────────────────────────────────

    SLO_P50_MS = 100
    SLO_P99_MS = 500
    SLO_ERROR_RATE = 0.01  # 1%

    slo_pass = (
        p50 <= SLO_P50_MS
        and p99 <= SLO_P99_MS
        and (error_count / total) <= SLO_ERROR_RATE
    )

    print(f"\n  SLO Check (P50<{SLO_P50_MS}ms, P99<{SLO_P99_MS}ms, errors<{SLO_ERROR_RATE*100:.0f}%):")
    print(f"    {'✓ PASS' if slo_pass else '✗ FAIL'}")

    # ── Save outcome ──────────────────────────────────────────────────────────

    outcome = {
        "timestamp": datetime.now().isoformat(),
        "base_url": base_url,
        "num_users": num_users,
        "duration_s": duration_s,
        "total_requests": total,
        "success_count": success_count,
        "error_count": error_count,
        "throughput_rps": round(throughput, 2),
        "latency_p50_ms": round(p50, 2),
        "latency_p95_ms": round(p95, 2),
        "latency_p99_ms": round(p99, 2),
        "slo_pass": slo_pass,
        "endpoint_stats": endpoint_stats,
    }

    os.makedirs("qa-tests/outcomes", exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = f"qa-tests/outcomes/load_{ts}.json"
    with open(out_file, "w") as f:
        json.dump(outcome, f, indent=2)
    print(f"\n  Results saved to: {out_file}")

    return outcome


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Chhath Radio Load Test")
    parser.add_argument("--url", default="http://localhost:8000", help="Base API URL")
    parser.add_argument("--users", type=int, default=50, help="Concurrent users")
    parser.add_argument("--duration", type=int, default=30, help="Test duration (seconds)")
    args = parser.parse_args()

    outcome = run_load_test(args.url, args.users, args.duration)
    sys.exit(0 if outcome.get("slo_pass") else 1)