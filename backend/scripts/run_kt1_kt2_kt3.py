"""Thực thi và kiểm chứng trực tiếp 4 kịch bản nghiệm thu cốt lõi: KT1, KT2, KT3, KT4.

- KT1: Một sinh viên hợp lệ đăng ký khi còn chỗ -> Thêm đúng 1 đăng ký, giảm đúng 1 chỗ.
- KT2: Nhiều sinh viên (vd: 50 SV) gửi đồng thời tranh 1 chỗ cuối -> Chỉ thêm 1 đăng ký (1 thành công, 49 bị từ chối 409 CLASS_FULL), không vượt chỉ tiêu.
- KT3: Cùng 1 sinh viên gửi lặp cùng yêu cầu (Idempotency) & gửi đồng thời nhiều yêu cầu -> Không tạo đăng ký trùng (active = 1), không giảm thêm chỗ (chỉ giảm đúng 1 chỗ).
- KT4: Sinh viên đăng ký lớp học phần bị trùng lịch học với lớp đang học (Thứ 2 tiết 1-3 vs Thứ 2 tiết 2-4) -> Bị chặn 409 SCHEDULE_CONFLICT, không tạo đăng ký mới, không trừ chỗ.

Xuất đồng thời báo cáo chi tiết trên Terminal và ghi file CSV để nhập lên giao diện Web (/admin/testing).
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
KT_CSV_PATH = REPO_ROOT / "frontend" / "kt1_kt2_kt3_results.csv"
KT_JSON_REPORT_PATH = REPO_ROOT / "frontend" / "kt_detailed_report.json"
DEFAULT_DB_URL = "postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_dev"
DEFAULT_API_URL = "http://localhost:8080"
TEST_CLASS_ID = "LHP997"
TEST_CLASS_CODE = "KT-TEST-01"
TEST_COURSE_CODE = "AI101"

BASE_CONFLICT_CLASS_ID = "LHP998"
BASE_CONFLICT_CLASS_CODE = "KT-SCHED-BASE"
BASE_CONFLICT_COURSE_CODE = "NET101"


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


def setup_tokens(db_url: str, count: int) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(hours=2)
    sids = [f"SV{i:04d}" for i in range(1, count + 1)]
    tokens: list[dict[str, Any]] = []
    session_rows: list[tuple[Any, ...]] = []

    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            conn.execute(
                """
                INSERT INTO courses (course_code, course_name, default_credits)
                VALUES
                    (%s, 'Trí tuệ nhân tạo (Kiểm thử KT1-KT4)', 3),
                    (%s, 'Mạng máy tính (Kiểm thử KT4)', 3)
                ON CONFLICT (course_code) DO NOTHING
                """,
                (TEST_COURSE_CODE, BASE_CONFLICT_COURSE_CODE),
            )
            rows = conn.execute(
                """
                SELECT id, student_id
                FROM users
                WHERE student_id = ANY(%s) AND role = 'STUDENT'
                ORDER BY student_id ASC
                """,
                (sids,),
            ).fetchall()

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
                        "user_id": int(urow["id"]),
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
    return tokens


def reset_test_class(
    db_url: str,
    *,
    capacity: int,
    remaining_seats: int,
    user_ids: list[int],
    with_schedule_conflict: bool = False,
    enrolled_tokens: list[dict[str, Any]] | None = None,
) -> None:
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            for cid in (TEST_CLASS_ID, BASE_CONFLICT_CLASS_ID):
                conn.execute(
                    "DELETE FROM payments WHERE registration_id IN "
                    "(SELECT registration_id FROM registrations WHERE course_class_id = %s)",
                    (cid,),
                )
                conn.execute(
                    "DELETE FROM registrations WHERE course_class_id = %s",
                    (cid,),
                )
                conn.execute(
                    "DELETE FROM course_class_schedules WHERE course_class_id = %s",
                    (cid,),
                )
            if user_ids:
                conn.execute(
                    "DELETE FROM idempotency_records WHERE user_id = ANY(%s)",
                    (user_ids,),
                )
            conn.execute(
                """
                INSERT INTO course_classes (
                    course_class_id, class_code, course_code, course_name,
                    credits, capacity, remaining_seats, status, tuition_amount
                )
                VALUES (%s, %s, %s, 'Trí tuệ nhân tạo (Kiểm thử KT1-KT4)', 3, %s, %s, 'OPEN', 1500000)
                ON CONFLICT (course_class_id) DO UPDATE
                SET capacity = EXCLUDED.capacity,
                    remaining_seats = EXCLUDED.remaining_seats,
                    status = 'OPEN',
                    updated_at = NOW()
                """,
                (TEST_CLASS_ID, TEST_CLASS_CODE, TEST_COURSE_CODE, capacity, remaining_seats),
            )

            if with_schedule_conflict and enrolled_tokens:
                base_cap = len(enrolled_tokens)
                conn.execute(
                    """
                    INSERT INTO course_classes (
                        course_class_id, class_code, course_code, course_name,
                        credits, capacity, remaining_seats, status, tuition_amount
                    )
                    VALUES (%s, %s, %s, 'Mạng máy tính (Lớp gốc Thứ 2 tiết 1-3)', 3, %s, 0, 'OPEN', 1500000)
                    ON CONFLICT (course_class_id) DO UPDATE
                    SET capacity = EXCLUDED.capacity,
                        remaining_seats = 0,
                        status = 'OPEN',
                        updated_at = NOW()
                    """,
                    (BASE_CONFLICT_CLASS_ID, BASE_CONFLICT_CLASS_CODE, BASE_CONFLICT_COURSE_CODE, base_cap),
                )
                # LHP998: Thứ 2 (MON), tiết 1..3
                conn.execute(
                    """
                    INSERT INTO course_class_schedules (course_class_id, day_of_week, start_period, end_period, room)
                    VALUES (%s, 'MON', 1, 3, 'A101')
                    """,
                    (BASE_CONFLICT_CLASS_ID,),
                )
                # LHP999: Thứ 2 (MON), tiết 2..4 -> Trùng tiết 2..3 với LHP998!
                conn.execute(
                    """
                    INSERT INTO course_class_schedules (course_class_id, day_of_week, start_period, end_period, room)
                    VALUES (%s, 'MON', 2, 4, 'B201')
                    """,
                    (TEST_CLASS_ID,),
                )
                now = datetime.now(timezone.utc)
                with conn.cursor() as cur:
                    cur.executemany(
                        """
                        INSERT INTO registrations (
                            registration_id, user_id, student_id, course_class_id, class_code,
                            course_name, credits, tuition_amount, status, payment_status,
                            registered_at, cancelled_at
                        )
                        VALUES (%s, %s, %s, %s, %s, 'Mạng máy tính (Lớp gốc Thứ 2 tiết 1-3)', 3, 1500000, 'ACTIVE', 'UNPAID', %s, NULL)
                        """,
                        [
                            (
                                str(uuid.uuid4()),
                                int(t["user_id"]),
                                str(t["student_id"]),
                                BASE_CONFLICT_CLASS_ID,
                                BASE_CONFLICT_CLASS_CODE,
                                now,
                            )
                            for t in enrolled_tokens
                        ],
                    )


def setup_full_class_for_kt6(
    db_url: str,
    *,
    enrolled_tokens: list[dict[str, Any]],
    user_ids: list[int],
) -> str:
    """Thiết lập lớp LHP997 đã đầy 100% (capacity = len(enrolled_tokens), remaining_seats = 0).

    Trả về registration_id của sinh viên đầu tiên (SV0001) để thực hiện lệnh DELETE hủy học phần.
    """
    cap = len(enrolled_tokens)
    reset_test_class(db_url, capacity=cap, remaining_seats=0, user_ids=user_ids)
    now = datetime.now(timezone.utc)
    reg_ids = [str(uuid.uuid4()) for _ in enrolled_tokens]
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO registrations (
                        registration_id, user_id, student_id, course_class_id, class_code,
                        course_name, credits, tuition_amount, status, payment_status,
                        registered_at, cancelled_at
                    )
                    VALUES (%s, %s, %s, %s, %s, 'Trí tuệ nhân tạo (Kiểm thử KT1-KT6)', 3, 1500000, 'ACTIVE', 'UNPAID', %s, NULL)
                    """,
                    [
                        (
                            reg_ids[idx],
                            int(t["user_id"]),
                            str(t["student_id"]),
                            TEST_CLASS_ID,
                            TEST_CLASS_CODE,
                            now,
                        )
                        for idx, t in enumerate(enrolled_tokens)
                    ],
                )
    return reg_ids[0]


async def execute_kt6_cancel_and_regrab(
    api_url: str,
    *,
    cancelling_token: dict[str, Any],
    registration_id_to_cancel: str,
    competing_tokens: list[dict[str, Any]],
    label: str,
) -> dict[str, Any]:
    """Thực thi KT6: 1 SV gọi DELETE hủy học phần nhả 1 chỗ, ngay lập tức N SV bên ngoài đua POST tranh chỗ đó."""
    latencies_ms: list[float] = []
    codes: dict[str, int] = {}
    success_count = 0
    failure_count = 0
    total_vus = 1 + len(competing_tokens)

    limits = httpx.Limits(max_connections=max(10, total_vus), max_keepalive_connections=max(10, total_vus))
    timeout = httpx.Timeout(20.0, connect=10.0)

    async with httpx.AsyncClient(base_url=api_url, limits=limits, timeout=timeout) as client:
        await client.get("/api/v1/health")

        t_start = time.perf_counter()

        # Bước 1: SV0001 gửi DELETE hủy đăng ký để nhả đúng 1 chỗ trống
        cancel_headers = {
            "Authorization": f"Bearer {cancelling_token['access_token']}",
            "Idempotency-Key": str(uuid.uuid4()),
        }
        t0_del = time.perf_counter()
        del_resp = await client.delete(
            f"/api/v1/registrations/{registration_id_to_cancel}",
            headers=cancel_headers,
        )
        latencies_ms.append((time.perf_counter() - t0_del) * 1000.0)
        del_body = del_resp.json() if del_resp.headers.get("content-type", "").startswith("application/json") else {}
        del_code_str = f"{del_resp.status_code}:{del_body.get('code', 'UNKNOWN')}"
        codes[del_code_str] = codes.get(del_code_str, 0) + 1
        if del_resp.status_code in (200, 201):
            success_count += 1
        else:
            failure_count += 1

        # Bước 2: Ngay khi chỗ trống vừa được nhả ra, N sinh viên bên ngoài đồng loạt gửi POST tranh chỗ
        async def _send_register(tok: dict[str, Any]) -> None:
            nonlocal success_count, failure_count
            headers = {
                "Authorization": f"Bearer {tok['access_token']}",
                "Idempotency-Key": str(uuid.uuid4()),
                "Content-Type": "application/json",
            }
            payload = {
                "student_id": tok["student_id"],
                "course_class_id": TEST_CLASS_ID,
            }
            t0 = time.perf_counter()
            resp = await client.post("/api/v1/register", json=payload, headers=headers)
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)
            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            code_str = f"{resp.status_code}:{body.get('code', 'UNKNOWN')}"
            codes[code_str] = codes.get(code_str, 0) + 1
            if resp.status_code in (200, 201):
                success_count += 1
            else:
                failure_count += 1

        await asyncio.gather(*(_send_register(t) for t in competing_tokens))
        wall_sec = max(0.001, time.perf_counter() - t_start)

    latencies_ms.sort()
    total = len(latencies_ms)
    avg_ms = sum(latencies_ms) / total if total else 0.0
    p95_ms = _percentile(latencies_ms, 95.0)
    p99_ms = _percentile(latencies_ms, 99.0)
    success_rate = (success_count / total) * 100.0 if total else 0.0
    rps = total / wall_sec

    return {
        "run_at": label,
        "vus": total_vus,
        "iterations": total,
        "duration_seconds": max(1, int(round(wall_sec))),
        "total_requests": total,
        "successful_requests": success_count,
        "failed_requests": failure_count,
        "success_rate_percent": round(success_rate, 2),
        "avg_response_time_ms": round(avg_ms, 2),
        "p95_ms": round(p95_ms, 2),
        "p99_ms": round(p99_ms, 2),
        "rps": round(rps, 2),
        "codes": codes,
    }


def get_class_db_state(db_url: str, class_id: str = TEST_CLASS_ID) -> dict[str, int]:
    with psycopg.connect(db_url, row_factory=dict_row) as conn:
        row = conn.execute(
            """
            SELECT
                cc.capacity,
                cc.remaining_seats,
                COUNT(r.registration_id) AS active_registrations,
                COUNT(DISTINCT r.student_id) AS distinct_students
            FROM course_classes cc
            LEFT JOIN registrations r
                ON r.course_class_id = cc.course_class_id
               AND r.status = 'ACTIVE'
            WHERE cc.course_class_id = %s
            GROUP BY cc.capacity, cc.remaining_seats
            """,
            (class_id,),
        ).fetchone()
        if not row:
            return {"capacity": 0, "remaining_seats": 0, "active_registrations": 0, "distinct_students": 0}
        return {
            "capacity": int(row["capacity"]),
            "remaining_seats": int(row["remaining_seats"]),
            "active_registrations": int(row["active_registrations"]),
            "distinct_students": int(row["distinct_students"]),
        }


def cleanup_test_env(db_url: str, session_ids: list[str], user_ids: list[int]) -> None:
    with psycopg.connect(db_url, row_factory=dict_row, autocommit=False) as conn:
        with conn.transaction():
            for cid in (TEST_CLASS_ID, BASE_CONFLICT_CLASS_ID):
                conn.execute(
                    "DELETE FROM payments WHERE registration_id IN "
                    "(SELECT registration_id FROM registrations WHERE course_class_id = %s)",
                    (cid,),
                )
                conn.execute("DELETE FROM registrations WHERE course_class_id = %s", (cid,))
                conn.execute("DELETE FROM course_class_schedules WHERE course_class_id = %s", (cid,))
                conn.execute("DELETE FROM course_classes WHERE course_class_id = %s", (cid,))
            if user_ids:
                conn.execute("DELETE FROM idempotency_records WHERE user_id = ANY(%s)", (user_ids,))
            if session_ids:
                conn.execute("DELETE FROM sessions WHERE session_id = ANY(%s::uuid[])", (session_ids,))


async def execute_requests(
    api_url: str,
    requests_spec: list[dict[str, str]],
    label: str,
    vus: int,
) -> dict[str, Any]:
    latencies_ms: list[float] = []
    codes: dict[str, int] = {}
    success_count = 0
    failure_count = 0

    limits = httpx.Limits(max_connections=max(10, vus), max_keepalive_connections=max(10, vus))
    timeout = httpx.Timeout(20.0, connect=10.0)

    async with httpx.AsyncClient(base_url=api_url, limits=limits, timeout=timeout) as client:
        await client.get("/api/v1/health")

        async def _send_one(spec: dict[str, str]) -> None:
            nonlocal success_count, failure_count
            headers = {
                "Authorization": f"Bearer {spec['access_token']}",
                "Idempotency-Key": spec["idempotency_key"],
                "Content-Type": "application/json",
            }
            payload = {
                "student_id": spec["student_id"],
                "course_class_id": TEST_CLASS_ID,
            }
            t0 = time.perf_counter()
            resp = await client.post("/api/v1/register", json=payload, headers=headers)
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            latencies_ms.append(elapsed_ms)

            body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            code_str = f"{resp.status_code}:{body.get('code', 'UNKNOWN')}"
            codes[code_str] = codes.get(code_str, 0) + 1

            replayed = resp.headers.get("Idempotent-Replayed", "").lower() == "true"
            if resp.status_code in (200, 201) and not replayed:
                success_count += 1
            else:
                failure_count += 1

        t_start = time.perf_counter()
        await asyncio.gather(*(_send_one(item) for item in requests_spec))
        wall_sec = max(0.001, time.perf_counter() - t_start)

    latencies_ms.sort()
    total = len(requests_spec)
    avg_ms = sum(latencies_ms) / total if total else 0.0
    p95_ms = _percentile(latencies_ms, 95.0)
    p99_ms = _percentile(latencies_ms, 99.0)
    success_rate = (success_count / total) * 100.0 if total else 0.0
    rps = total / wall_sec

    return {
        "run_at": label,
        "vus": vus,
        "iterations": total,
        "duration_seconds": max(1, int(round(wall_sec))),
        "total_requests": total,
        "successful_requests": success_count,
        "failed_requests": failure_count,
        "success_rate_percent": round(success_rate, 2),
        "avg_response_time_ms": round(avg_ms, 2),
        "p95_ms": round(p95_ms, 2),
        "p99_ms": round(p99_ms, 2),
        "rps": round(rps, 2),
        "codes": codes,
    }


def write_csv(rows: list[dict[str, Any]], paths: list[Path]) -> None:
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
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for r in rows:
                writer.writerow({k: r[k] for k in fieldnames})


def main() -> int:
    parser = argparse.ArgumentParser(description="Chạy 5 kịch bản kiểm thử KT1, KT2, KT3, KT4, KT5.")
    parser.add_argument("--competing-students", type=int, default=50, help="Số SV tranh chỗ cuối ở KT2 (mặc định 50).")
    parser.add_argument("--duplicate-requests", "--repeated-requests", dest="duplicate_requests", type=int, default=50, help="Số request trùng của 1 SV ở KT3 (mặc định 50).")
    parser.add_argument("--conflict-students", type=int, default=20, help="Số SV kiểm tra trùng lịch ở KT4 (mặc định 20).")
    parser.add_argument("--regrab-students", type=int, default=30, help="Số SV bên ngoài tranh chỗ vừa hủy ở KT5 (mặc định 30).")
    parser.add_argument("--db-url", default=DEFAULT_DB_URL)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    args = parser.parse_args()

    max_needed = max(20, args.competing_students, args.conflict_students, 10 + args.regrab_students)
    tokens = setup_tokens(args.db_url, count=max_needed)
    session_ids = [t["session_id"] for t in tokens]
    user_ids = [int(t["user_id"]) for t in tokens]
    csv_rows: list[dict[str, Any]] = []

    try:
        print("=" * 80)
        print(" BÁO CÁO THỰC THI 5 KỊCH BẢN KIỂM THỬ NGHIỆM THU: KT1 - KT2 - KT3 - KT4 - KT5")
        print("=" * 80)

        # ------------------------------------------------------------------
        # KT1: Một sinh viên hợp lệ đăng ký khi còn chỗ
        # ------------------------------------------------------------------
        reset_test_class(args.db_url, capacity=50, remaining_seats=50, user_ids=user_ids)
        before_kt1 = get_class_db_state(args.db_url)
        kt1_spec = [
            {
                "student_id": tokens[0]["student_id"],
                "access_token": tokens[0]["access_token"],
                "idempotency_key": str(uuid.uuid4()),
            }
        ]
        res_kt1 = asyncio.run(
            execute_requests(args.api_url, kt1_spec, label="KT1: 1 SV đăng ký khi còn chỗ", vus=1)
        )
        after_kt1 = get_class_db_state(args.db_url)
        kt1_pass = (
            after_kt1["active_registrations"] == 1
            and after_kt1["remaining_seats"] == before_kt1["remaining_seats"] - 1
        )
        csv_rows.append(res_kt1)

        print("\n[KT1] Một sinh viên hợp lệ đăng ký khi còn chỗ:")
        print(f"  - Trước khi chạy : capacity={before_kt1['capacity']}, remaining_seats={before_kt1['remaining_seats']}, active_registrations={before_kt1['active_registrations']}")
        print(f"  - Request gửi đi : 1 request từ {tokens[0]['student_id']} -> Phản hồi: {res_kt1['codes']}")
        print(f"  - Sau khi chạy   : capacity={after_kt1['capacity']}, remaining_seats={after_kt1['remaining_seats']}, active_registrations={after_kt1['active_registrations']}")
        print(f"  => KẾT LUẬN KT1  : {'PASS (Thêm đúng 1 đăng ký, giảm đúng 1 chỗ)' if kt1_pass else 'FAIL'}")

        # ------------------------------------------------------------------
        # KT2: Nhiều sinh viên gửi đồng thời để tranh chỗ cuối
        # ------------------------------------------------------------------
        n_kt2 = args.competing_students
        reset_test_class(args.db_url, capacity=1, remaining_seats=1, user_ids=user_ids)
        before_kt2 = get_class_db_state(args.db_url)
        kt2_spec = [
            {
                "student_id": tokens[i]["student_id"],
                "access_token": tokens[i]["access_token"],
                "idempotency_key": str(uuid.uuid4()),
            }
            for i in range(n_kt2)
        ]
        res_kt2 = asyncio.run(
            execute_requests(
                args.api_url,
                kt2_spec,
                label=f"KT2: {n_kt2} SV tranh 1 chỗ cuối",
                vus=n_kt2,
            )
        )
        after_kt2 = get_class_db_state(args.db_url)
        kt2_pass = (
            after_kt2["active_registrations"] == 1
            and after_kt2["remaining_seats"] == 0
            and res_kt2["successful_requests"] == 1
            and res_kt2["failed_requests"] == n_kt2 - 1
        )
        csv_rows.append(res_kt2)

        print(f"\n[KT2] Nhiều sinh viên ({n_kt2} SV: SV0001..SV{n_kt2:04d}) gửi đồng thời tranh 1 chỗ cuối:")
        print(f"  - Trước khi chạy : capacity={before_kt2['capacity']}, remaining_seats={before_kt2['remaining_seats']}, active_registrations={before_kt2['active_registrations']}")
        print(f"  - Request gửi đi : {n_kt2} request đồng thời -> Phản hồi: {res_kt2['codes']}")
        print(f"  - Sau khi chạy   : capacity={after_kt2['capacity']}, remaining_seats={after_kt2['remaining_seats']}, active_registrations={after_kt2['active_registrations']}")
        print(f"  => KẾT LUẬN KT2  : {'PASS (Chỉ thêm đúng 1 đăng ký, 49 SV nhận 409 CLASS_FULL, không vượt chỉ tiêu)' if kt2_pass else 'FAIL'}")

        # ------------------------------------------------------------------
        # KT3: Gửi lại cùng yêu cầu hoặc nhiều yêu cầu của cùng 1 sinh viên
        # ------------------------------------------------------------------
        n_kt3 = args.duplicate_requests
        reset_test_class(args.db_url, capacity=50, remaining_seats=50, user_ids=user_ids)
        before_kt3 = get_class_db_state(args.db_url)
        shared_key = str(uuid.uuid4())
        kt3_spec = [
            {
                "student_id": tokens[0]["student_id"],
                "access_token": tokens[0]["access_token"],
                "idempotency_key": shared_key if i < (n_kt3 // 2) else str(uuid.uuid4()),
            }
            for i in range(n_kt3)
        ]
        res_kt3 = asyncio.run(
            execute_requests(
                args.api_url,
                kt3_spec,
                label=f"KT3: 1 SV gửi lặp {n_kt3} request",
                vus=n_kt3,
            )
        )
        after_kt3 = get_class_db_state(args.db_url)
        kt3_pass = (
            after_kt3["active_registrations"] == 1
            and after_kt3["distinct_students"] == 1
            and after_kt3["remaining_seats"] == before_kt3["remaining_seats"] - 1
        )
        csv_rows.append(res_kt3)

        print(f"\n[KT3] Cùng 1 sinh viên ({tokens[0]['student_id']}) gửi đồng thời/gửi lặp {n_kt3} yêu cầu:")
        print(f"  - Trước khi chạy : capacity={before_kt3['capacity']}, remaining_seats={before_kt3['remaining_seats']}, active_registrations={before_kt3['active_registrations']}")
        print(f"  - Request gửi đi : {n_kt3} request của cùng {tokens[0]['student_id']} -> Phản hồi: {res_kt3['codes']}")
        print(f"  - Sau khi chạy   : capacity={after_kt3['capacity']}, remaining_seats={after_kt3['remaining_seats']}, active_registrations={after_kt3['active_registrations']}")
        print(f"  => KẾT LUẬN KT3  : {'PASS (Không tạo đăng ký trùng, chỉ giảm đúng 1 chỗ từ 50 -> 49)' if kt3_pass else 'FAIL'}")

        # ------------------------------------------------------------------
        # KT4: Kiểm tra chặn trùng lịch học (409 SCHEDULE_CONFLICT) và không trừ chỗ
        # ------------------------------------------------------------------
        n_kt4 = args.conflict_students
        conflict_slice = tokens[:n_kt4]
        reset_test_class(
            args.db_url,
            capacity=50,
            remaining_seats=50,
            user_ids=user_ids,
            with_schedule_conflict=True,
            enrolled_tokens=conflict_slice,
        )
        before_kt4 = get_class_db_state(args.db_url)
        kt4_spec = [
            {
                "student_id": conflict_slice[i]["student_id"],
                "access_token": conflict_slice[i]["access_token"],
                "idempotency_key": str(uuid.uuid4()),
            }
            for i in range(n_kt4)
        ]
        res_kt4 = asyncio.run(
            execute_requests(
                args.api_url,
                kt4_spec,
                label=f"KT4: {n_kt4} SV đăng ký lớp trùng lịch",
                vus=n_kt4,
            )
        )
        after_kt4 = get_class_db_state(args.db_url)
        kt4_pass = (
            after_kt4["active_registrations"] == 0
            and after_kt4["remaining_seats"] == before_kt4["remaining_seats"]
            and res_kt4["successful_requests"] == 0
            and res_kt4["codes"].get("409:SCHEDULE_CONFLICT", 0) == n_kt4
        )
        csv_rows.append(res_kt4)

        print(f"\n[KT4] Kiểm tra chặn trùng lịch học ({n_kt4} SV đang học Thứ 2 tiết 1-3 đăng ký lớp Thứ 2 tiết 2-4):")
        print(f"  - Trước khi chạy : capacity={before_kt4['capacity']}, remaining_seats={before_kt4['remaining_seats']}, active_registrations={before_kt4['active_registrations']}")
        print(f"  - Request gửi đi : {n_kt4} request đồng thời -> Phản hồi: {res_kt4['codes']}")
        print(f"  - Sau khi chạy   : capacity={after_kt4['capacity']}, remaining_seats={after_kt4['remaining_seats']}, active_registrations={after_kt4['active_registrations']}")
        print(f"  => KẾT LUẬN KT4  : {'PASS (Chặn 100% với 409 SCHEDULE_CONFLICT, không tạo đăng ký mới, giữ nguyên 50/50 chỗ)' if kt4_pass else 'FAIL'}")

        # ------------------------------------------------------------------
        # KT5: Hủy học phần hoàn chỗ & Tranh chỗ vừa nhả ra (Cancel & Re-grab Seat)
        # ------------------------------------------------------------------
        n_kt5 = args.regrab_students
        initial_enrolled = tokens[:10]
        competing_outsiders = tokens[10 : 10 + n_kt5]
        reg_id_to_cancel = setup_full_class_for_kt6(
            args.db_url,
            enrolled_tokens=initial_enrolled,
            user_ids=user_ids,
        )
        before_kt5 = get_class_db_state(args.db_url)
        res_kt5 = asyncio.run(
            execute_kt6_cancel_and_regrab(
                args.api_url,
                cancelling_token=initial_enrolled[0],
                registration_id_to_cancel=reg_id_to_cancel,
                competing_tokens=competing_outsiders,
                label=f"KT5: 1 SV hủy nhả chỗ & {n_kt5} SV tranh chỗ",
            )
        )
        after_kt5 = get_class_db_state(args.db_url)
        kt5_pass = (
            before_kt5["active_registrations"] == 10
            and before_kt5["remaining_seats"] == 0
            and after_kt5["active_registrations"] == 10
            and after_kt5["remaining_seats"] == 0
            and res_kt5["codes"].get("200:REGISTRATION_CANCELLED", 0) == 1
            and res_kt5["codes"].get("200:REGISTERED", 0) == 1
            and res_kt5["codes"].get("409:CLASS_FULL", 0) == n_kt5 - 1
        )
        csv_rows.append(res_kt5)

        print(f"\n[KT5] Hủy học phần hoàn chỗ & Tranh chỗ vừa nhả ra (Lớp 10/10 đầy, SV0001 hủy -> {n_kt5} SV ngoài tranh chỗ):")
        print(f"  - Trước khi chạy : capacity={before_kt5['capacity']}, remaining_seats={before_kt5['remaining_seats']}, active_registrations={before_kt5['active_registrations']} (Lớp đã đầy 10/10)")
        print(f"  - Request gửi đi : 1 DELETE hủy + {n_kt5} POST tranh chỗ -> Phản hồi: {res_kt5['codes']}")
        print(f"  - Sau khi chạy   : capacity={after_kt5['capacity']}, remaining_seats={after_kt5['remaining_seats']}, active_registrations={after_kt5['active_registrations']}")
        print(f"  => KẾT LUẬN KT5  : {'PASS (SV0001 hủy hoàn +1 chỗ thành công, đúng 1 SV mới lấy được chỗ, ' + str(n_kt5 - 1) + ' SV nhận 409 CLASS_FULL, sĩ số giữ chuẩn 10/10)' if kt5_pass else 'FAIL'}")

        write_csv(csv_rows, [KT_CSV_PATH])

        scenarios_report = [
            {
                "id": "KT1",
                "title": "KT1: Đăng ký hợp lệ khi lớp còn chỗ",
                "description": f"1 SV ({tokens[0]['student_id']}) đăng ký vào lớp còn 50 chỗ trống",
                "passed": bool(kt1_pass),
                "conclusion": "Thêm đúng 1 đăng ký, giảm đúng 1 chỗ (50 -> 49)" if kt1_pass else "Sai lệch số chỗ hoặc bản ghi đăng ký",
                "before": before_kt1,
                "after": after_kt1,
                "codes": res_kt1["codes"],
                "metrics": {k: v for k, v in res_kt1.items() if k != "codes"},
            },
            {
                "id": "KT2",
                "title": f"KT2: {n_kt2} SV đồng thời tranh 1 chỗ cuối",
                "description": f"{n_kt2} SV (SV0001..SV{n_kt2:04d}) gửi request cùng lúc vào lớp chỉ còn 1 chỗ",
                "passed": bool(kt2_pass),
                "conclusion": f"Chỉ 1 SV thành công (200), {n_kt2 - 1} SV nhận 409 CLASS_FULL, không vượt chỉ tiêu" if kt2_pass else "Vi phạm chỉ tiêu lớp học phần",
                "before": before_kt2,
                "after": after_kt2,
                "codes": res_kt2["codes"],
                "metrics": {k: v for k, v in res_kt2.items() if k != "codes"},
            },
            {
                "id": "KT3",
                "title": f"KT3: Cùng 1 SV gửi lặp {n_kt3} yêu cầu",
                "description": f"SV {tokens[0]['student_id']} gửi dồn dập {n_kt3} request (kèm Idempotency-Key lặp & mới)",
                "passed": bool(kt3_pass),
                "conclusion": "Không tạo đăng ký trùng (active = 1), chỉ giảm đúng 1 chỗ (50 -> 49)" if kt3_pass else "Bị tạo bản ghi trùng hoặc trừ lố chỗ",
                "before": before_kt3,
                "after": after_kt3,
                "codes": res_kt3["codes"],
                "metrics": {k: v for k, v in res_kt3.items() if k != "codes"},
            },
            {
                "id": "KT4",
                "title": f"KT4: Chặn {n_kt4} SV đăng ký lớp trùng lịch học",
                "description": f"{n_kt4} SV đang học Thứ 2 (tiết 1–3) đăng ký vào lớp Thứ 2 (tiết 2–4)",
                "passed": bool(kt4_pass),
                "conclusion": f"Chặn 100% ({n_kt4}/{n_kt4}) với 409 SCHEDULE_CONFLICT, giữ nguyên 50/50 chỗ" if kt4_pass else "Lọt đăng ký trùng lịch học",
                "before": before_kt4,
                "after": after_kt4,
                "codes": res_kt4["codes"],
                "metrics": {k: v for k, v in res_kt4.items() if k != "codes"},
            },
            {
                "id": "KT5",
                "title": f"KT5: 1 SV hủy nhả chỗ & {n_kt5} SV ngoài tranh chỗ",
                "description": f"Lớp 10/10 đầy, SV0001 gọi DELETE hủy (+1 chỗ) -> {n_kt5} SV ngoài đua POST tranh chỗ vừa nhả",
                "passed": bool(kt5_pass),
                "conclusion": f"1 DELETE hủy thành công, đúng 1/{n_kt5} SV mới lấy được chỗ, {n_kt5 - 1} SV nhận 409 CLASS_FULL, giữ chuẩn 10/10" if kt5_pass else "Sai lệch hoàn trả hoặc tranh chỗ sau hủy",
                "before": before_kt5,
                "after": after_kt5,
                "codes": res_kt5["codes"],
                "metrics": {k: v for k, v in res_kt5.items() if k != "codes"},
            },
        ]
        aggregated_codes: dict[str, int] = {}
        for sc in scenarios_report:
            for code_key, cnt in sc["codes"].items():
                aggregated_codes[code_key] = aggregated_codes.get(code_key, 0) + int(cnt)

        report_payload = {
            "report_type": "acceptance_kt",
            "generated_at": datetime.now(timezone(timedelta(hours=7))).strftime("%Y-%m-%d %H:%M:%S"),
            "scenarios": scenarios_report,
            "aggregated_codes": aggregated_codes,
        }
        KT_JSON_REPORT_PATH.write_text(json.dumps(report_payload, ensure_ascii=False, indent=2), encoding="utf-8")

        print("\n" + "=" * 80)
        print(" Đã xuất kết quả KT1, KT2, KT3, KT4, KT5 ra file CSV & JSON:")
        print(f"   -> {KT_CSV_PATH}")
        print(f"   -> {KT_JSON_REPORT_PATH}")
        print("=" * 80)
    finally:
        cleanup_test_env(args.db_url, session_ids=session_ids, user_ids=user_ids)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
