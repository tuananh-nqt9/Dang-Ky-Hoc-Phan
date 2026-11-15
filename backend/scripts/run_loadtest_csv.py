"""Run real HTTP load tests across multiple VU levels (10..3000) and export CSV for Frontend Testing UI.

Uses 3,000 real student accounts (SV0001..SV3000) against POST /api/v1/register on a dedicated
benchmark course class (LHP999) so existing UI classes (LHP001..LHP003) remain untouched.
Verifies database seat invariants after every single run and cleans up temporary test rows on exit.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import math
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import psycopg
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV_PATH = REPO_ROOT / "frontend" / "sample-load-test-results.csv"
PUBLIC_CSV_PATH = REPO_ROOT / "frontend" / "public" / "sample-load-test-results.csv"
LOADTEST_JSON_REPORT_PATH = REPO_ROOT / "frontend" / "loadtest_detailed_report.json"
DEFAULT_DB_URL = "postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_dev"
DEFAULT_API_URL = "http://localhost:8080"
BENCHMARK_CLASS_ID = "LHP999"
BENCHMARK_CLASS_CODE = "LOADTEST-01"
BENCHMARK_COURSE_CODE = "AI101"


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _percentile(sorted_values: list[float], pct: float) -> float:
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (pct / 100.0) * (len(sorted_values) - 1)
    low = int(math.floor(rank))
    high = int(math.ceil(rank))
    if low == high:
        return sorted_values[low]
    weight = rank - low
    return sorted_values[low] * (1.0 - weight) + sorted_values[high] * weight


def prepare_benchmark_environment(
    db_url: str,
    max_users: int,
    class_capacity: int,
) -> list[dict[str, str]]:
    """Ensure SV0001..SV{max_users} have active session tokens and create LHP999."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=4)
    target_sids = [f"SV{i:04d}" for i in range(1, max_users + 1)]
    tokens: list[dict[str, str]] = []
    session_rows: list[tuple[Any, ...]] = []

    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            conn.execute(
                """
                INSERT INTO courses (course_code, course_name, default_credits)
                VALUES (%s, 'Trí tuệ nhân tạo (Kiểm thử tải)', 3)
                ON CONFLICT (course_code) DO NOTHING
                """,
                (BENCHMARK_COURSE_CODE,),
            )

            rows = conn.execute(
                """
                SELECT id, student_id
                FROM users
                WHERE student_id = ANY(%s) AND role = 'STUDENT'
                ORDER BY student_id ASC
                """,
                (target_sids,),
            ).fetchall()

            if len(rows) < max_users:
                raise RuntimeError(
                    f"Trong DB hiện chỉ có {len(rows)}/{max_users} sinh viên. "
                    "Hãy chạy seed trước!"
                )

            for urow in rows:
                raw_access = secrets.token_urlsafe(32)
                raw_refresh = secrets.token_urlsafe(32)
                session_id = str(uuid.uuid4())
                session_rows.append(
                    (
                        session_id,
                        int(urow["id"]),
                        _hash_token(raw_access),
                        _hash_token(raw_refresh),
                        exp,
                        exp,
                        exp,
                        now,
                        now,
                    )
                )
                tokens.append(
                    {
                        "session_id": session_id,
                        "student_id": str(urow["student_id"]),
                        "access_token": raw_access,
                    }
                )

            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO sessions (
                        session_id, user_id, access_token_hash, refresh_token_hash,
                        access_expires_at, refresh_expires_at, absolute_expires_at,
                        revoked_at, created_at, rotated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s, %s)
                    """,
                    session_rows,
                )

            # Upsert dedicated benchmark class LHP999 without schedule conflicts or prerequisites
            conn.execute(
                "DELETE FROM payments WHERE registration_id IN "
                "(SELECT registration_id FROM registrations WHERE course_class_id = %s)",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                "DELETE FROM registrations WHERE course_class_id = %s",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                """
                INSERT INTO course_classes (
                    course_class_id, class_code, course_code, course_name,
                    credits, capacity, remaining_seats, status, tuition_amount
                )
                VALUES (%s, %s, %s, 'Trí tuệ nhân tạo (Kiểm thử tải)', 3, %s, %s, 'OPEN', 1500000)
                ON CONFLICT (course_class_id) DO UPDATE
                SET capacity = EXCLUDED.capacity,
                    remaining_seats = EXCLUDED.remaining_seats,
                    status = 'OPEN',
                    updated_at = NOW()
                """,
                (
                    BENCHMARK_CLASS_ID,
                    BENCHMARK_CLASS_CODE,
                    BENCHMARK_COURSE_CODE,
                    class_capacity,
                    class_capacity,
                ),
            )

    return tokens


def reset_benchmark_class(db_url: str, class_capacity: int) -> None:
    """Reset LHP999 registrations and restore full capacity before each VU level run."""
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            conn.execute(
                "DELETE FROM payments WHERE registration_id IN "
                "(SELECT registration_id FROM registrations WHERE course_class_id = %s)",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                "DELETE FROM registrations WHERE course_class_id = %s",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                "UPDATE course_classes SET capacity = %s, remaining_seats = %s, status = 'OPEN', updated_at = NOW() "
                "WHERE course_class_id = %s",
                (class_capacity, class_capacity, BENCHMARK_CLASS_ID),
            )


def verify_benchmark_class_invariant(db_url: str) -> tuple[bool, int, int, int]:
    """Verify remaining_seats + active_registrations == capacity for LHP999."""
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        row = conn.execute(
            """
            SELECT
                cc.capacity,
                cc.remaining_seats,
                COUNT(r.registration_id) AS active_count
            FROM course_classes cc
            LEFT JOIN registrations r
                ON r.course_class_id = cc.course_class_id
               AND r.status = 'ACTIVE'
            WHERE cc.course_class_id = %s
            GROUP BY cc.capacity, cc.remaining_seats
            """,
            (BENCHMARK_CLASS_ID,),
        ).fetchone()
        if not row:
            return False, 0, 0, 0
        cap = int(row["capacity"])
        rem = int(row["remaining_seats"])
        act = int(row["active_count"])
        ok = (rem >= 0) and (act <= cap) and (rem + act == cap)
        return ok, cap, rem, act


def cleanup_benchmark_environment(db_url: str, session_ids: list[str]) -> None:
    """Remove LHP999 and temporary load-test sessions so UI data remains untouched."""
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            conn.execute(
                "DELETE FROM payments WHERE registration_id IN "
                "(SELECT registration_id FROM registrations WHERE course_class_id = %s)",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                "DELETE FROM registrations WHERE course_class_id = %s",
                (BENCHMARK_CLASS_ID,),
            )
            conn.execute(
                "DELETE FROM course_classes WHERE course_class_id = %s",
                (BENCHMARK_CLASS_ID,),
            )
            if session_ids:
                conn.execute(
                    "DELETE FROM sessions WHERE session_id = ANY(%s::uuid[])",
                    (session_ids,),
                )


async def run_single_level(
    api_url: str,
    tokens: list[dict[str, str]],
    vus: int,
    max_in_flight: int = 200,
) -> dict[str, Any]:
    """Fire `vus` concurrent registration requests and collect latency metrics."""
    selected_tokens = tokens[:vus]
    latencies_ms: list[float] = []
    status_counts: dict[int, int] = {}
    codes: dict[str, int] = {}
    success_count = 0
    failure_count = 0

    # Limit simultaneous OS socket saturation while preserving high server concurrency
    concurrency_cap = min(vus, max_in_flight)
    semaphore = asyncio.Semaphore(concurrency_cap)

    limits = httpx.Limits(
        max_connections=concurrency_cap,
        max_keepalive_connections=concurrency_cap,
    )
    timeout = httpx.Timeout(30.0, connect=10.0)

    async with httpx.AsyncClient(base_url=api_url, limits=limits, timeout=timeout) as client:
        # Warm up connection pool
        await client.get("/api/v1/health")

        async def _worker(item: dict[str, str]) -> None:
            nonlocal success_count, failure_count
            headers = {
                "Authorization": f"Bearer {item['access_token']}",
                "Idempotency-Key": str(uuid.uuid4()),
                "Content-Type": "application/json",
            }
            payload = {
                "student_id": item["student_id"],
                "course_class_id": BENCHMARK_CLASS_ID,
            }
            async with semaphore:
                t0 = time.perf_counter()
                try:
                    resp = await client.post("/api/v1/register", json=payload, headers=headers)
                    elapsed_ms = (time.perf_counter() - t0) * 1000.0
                    latencies_ms.append(elapsed_ms)
                    status_counts[resp.status_code] = status_counts.get(resp.status_code, 0) + 1
                    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                    code_str = f"{resp.status_code}:{body.get('code', 'UNKNOWN')}"
                    codes[code_str] = codes.get(code_str, 0) + 1
                    if resp.status_code in (200, 201):
                        success_count += 1
                    else:
                        failure_count += 1
                except Exception:
                    elapsed_ms = (time.perf_counter() - t0) * 1000.0
                    latencies_ms.append(elapsed_ms)
                    status_counts[0] = status_counts.get(0, 0) + 1
                    codes["0:NETWORK_ERROR"] = codes.get("0:NETWORK_ERROR", 0) + 1
                    failure_count += 1

        wall_start = time.perf_counter()
        await asyncio.gather(*(_worker(item) for item in selected_tokens))
        wall_elapsed = max(0.001, time.perf_counter() - wall_start)

    latencies_ms.sort()
    total_reqs = len(selected_tokens)
    avg_ms = sum(latencies_ms) / len(latencies_ms) if latencies_ms else 0.0
    p95_ms = _percentile(latencies_ms, 95.0)
    p99_ms = _percentile(latencies_ms, 99.0)
    success_rate = (success_count / total_reqs) * 100.0 if total_reqs else 0.0
    rps = total_reqs / wall_elapsed

    now_local = datetime.now(timezone(timedelta(hours=7)))
    run_label = f"{vus} VUs ({now_local.strftime('%H:%M:%S')})"

    return {
        "run_at": run_label,
        "vus": vus,
        "iterations": total_reqs,
        "duration_seconds": max(1, int(round(wall_elapsed))),
        "total_requests": total_reqs,
        "successful_requests": success_count,
        "failed_requests": failure_count,
        "success_rate_percent": round(success_rate, 2),
        "avg_response_time_ms": round(avg_ms, 2),
        "p95_ms": round(p95_ms, 2),
        "p99_ms": round(p99_ms, 2),
        "rps": round(rps, 2),
        "status_counts": status_counts,
        "codes": codes,
        "wall_seconds": round(wall_elapsed, 2),
    }


def write_csv_results(rows: list[dict[str, Any]], output_paths: list[Path]) -> None:
    fieldnames = [
        "run_at",
        "vus",
        "iterations",
        "duration_seconds",
        "total_requests",
        "successful_requests",
        "failed_requests",
        "success_rate_percent",
        "avg_response_time_ms",
        "p95_ms",
        "p99_ms",
        "rps",
    ]
    for path in output_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for row in rows:
                writer.writerow({k: row[k] for k in fieldnames})


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Chạy đo tải thật các mức VUs (10..3000) vào Backend và xuất CSV cho giao diện."
    )
    parser.add_argument(
        "--levels",
        default="10,50,100,500,1000,2000,3000",
        help="Danh sách các mức VUs phân tách bằng dấu phẩy.",
    )
    parser.add_argument(
        "--capacity",
        type=int,
        default=3000,
        help="Sức chứa lớp kiểm thử tải (mặc định 3000 chỗ).",
    )
    parser.add_argument("--db-url", default=DEFAULT_DB_URL)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    args = parser.parse_args()

    levels = [int(x.strip()) for x in args.levels.split(",") if x.strip()]
    max_users = max(levels)

    print(f"[1/4] Đang chuẩn bị {max_users} phiên đăng nhập thật (SV0001..SV{max_users:04d})...")
    tokens = prepare_benchmark_environment(
        args.db_url,
        max_users=max_users,
        class_capacity=args.capacity,
    )
    session_ids = [t["session_id"] for t in tokens]

    results: list[dict[str, Any]] = []
    scenarios_report: list[dict[str, Any]] = []
    try:
        print(f"[2/4] Bắt đầu bắn tải thật vào {args.api_url}/api/v1/register cho các mức: {levels}")
        for vus in levels:
            reset_benchmark_class(args.db_url, class_capacity=args.capacity)
            metrics = asyncio.run(run_single_level(args.api_url, tokens, vus=vus))
            inv_ok, cap, rem, act = verify_benchmark_class_invariant(args.db_url)
            results.append(metrics)
            scenarios_report.append(
                {
                    "id": f"{vus} VUs",
                    "title": f"Mức tải {vus} VUs đồng thời",
                    "description": f"{vus} SV gửi POST /api/v1/register vào lớp sức chứa {cap} chỗ",
                    "passed": bool(inv_ok),
                    "conclusion": f"Invariant PASS: remaining ({rem}) + active ({act}) == capacity ({cap})" if inv_ok else f"Invariant FAIL: rem={rem}, act={act}, cap={cap}",
                    "before": {"capacity": cap, "remaining_seats": cap, "active_registrations": 0},
                    "after": {"capacity": cap, "remaining_seats": rem, "active_registrations": act},
                    "codes": metrics["codes"],
                    "metrics": {k: v for k, v in metrics.items() if k not in ("codes", "status_counts")},
                }
            )
            print(
                f"  -> Mức {vus:4d} VUs | Thành công: {metrics['successful_requests']:4d}/{metrics['total_requests']:4d} "
                f"({metrics['success_rate_percent']:6.2f}%) | Avg: {metrics['avg_response_time_ms']:7.2f} ms | "
                f"P95: {metrics['p95_ms']:7.2f} ms | P99: {metrics['p99_ms']:7.2f} ms | "
                f"RPS: {metrics['rps']:6.2f} | Invariant(rem={rem}+act={act}=={cap}): {'PASS' if inv_ok else 'FAIL'} | "
                f"HTTP: {metrics['codes']}"
            )

        print("[3/4] Đang ghi kết quả ra file CSV & JSON...")
        write_csv_results(results, [DEFAULT_CSV_PATH, PUBLIC_CSV_PATH])
        aggregated_codes: dict[str, int] = {}
        for sc in scenarios_report:
            for code_key, cnt in sc["codes"].items():
                aggregated_codes[code_key] = aggregated_codes.get(code_key, 0) + int(cnt)
        report_payload = {
            "report_type": "loadtest",
            "generated_at": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S"),
            "scenarios": scenarios_report,
            "aggregated_codes": aggregated_codes,
        }
        LOADTEST_JSON_REPORT_PATH.write_text(json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  -> Đã cập nhật: {DEFAULT_CSV_PATH}")
        print(f"  -> Đã cập nhật: {LOADTEST_JSON_REPORT_PATH}")
    finally:
        print("[4/4] Đang dọn dẹp dữ liệu tạm (giữ nguyên dữ liệu UI LHP001..LHP003)...")
        cleanup_benchmark_environment(args.db_url, session_ids)
        print("[HOÀN TẤT] Bạn có thể bấm 'Nhập CSV' trên trang /admin/testing để xem biểu đồ ngay!")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
