# Tài liệu Hướng dẫn Chi tiết Backend — Hệ thống Đăng ký Học phần Trực tuyến

← Quay lại tài liệu tổng quan dự án: [../README.md](../README.md)

Tài liệu này hướng dẫn chi tiết cách cài đặt, cấu hình, vận hành, sử dụng API và kiểm thử dịch vụ Backend cùng Cơ sở dữ liệu PostgreSQL 16 của **Hệ thống Đăng ký Học phần Trực tuyến**.

> **Lưu ý về phạm vi mô phỏng & dữ liệu phòng lab**:
> 1. Nghiệp vụ thanh toán (`POST /api/v1/payments`) và hoàn tiền khi hủy đăng ký (`DELETE /api/v1/registrations/{registration_id}`) là **mô phỏng trạng thái nội bộ trong giao dịch PostgreSQL** nhằm kiểm chứng tính nguyên tử đa bảng; hệ thống **không** kết nối ngân hàng hay cổng thanh toán bên ngoài.
> 2. Mật khẩu mẫu phòng lab và khóa bí mật mẫu trong cấu hình phát triển chỉ phục vụ môi trường cục bộ/kiểm thử, tuyệt đối không sử dụng cho môi trường thực tế.
> 3. Quy mô **3.000 sinh viên** (`SV0001`..`SV3000`) là quy mô tập dữ liệu định danh trong cơ sở dữ liệu; việc kiểm thử tranh chấp đồng thời được thực hiện qua các bài kiểm thử đa tiến trình worker (10–20 yêu cầu đồng thời tranh chỗ cuối) và kịch bản đo tải (10 / 50 / 100 VU), không đồng nghĩa với tuyên bố hạ tầng vật lý phục vụ 3.000 kết nối đồng thời tức thời.

---

## Mục lục

1. [Tổng quan Kiến trúc & Công nghệ](#1-tổng-quan-kiến-trúc--công-nghệ)
2. [Yêu cầu Môi trường](#2-yêu-cầu-môi-trường)
3. [Cấu trúc Thư mục Backend](#3-cấu-trúc-thư-mục-backend)
4. [Cấu hình Biến Môi trường (`.env`)](#4-cấu-hình-biến-môi-trường-env)
5. [Cài đặt & Khởi chạy Backend](#5-cài-đặt--khởi-chạy-backend)
6. [Địa chỉ Truy cập Dịch vụ](#6-địa-chỉ-truy-cập-dịch-vụ)
7. [Cơ chế Xác thực, Phiên đăng nhập & Kiểm soát Đồng thời](#7-cơ-chế-xác-thực-phiên-đăng-nhập--kiểm-soát-đồng-thời)
8. [Danh mục 19 API Endpoints](#8-danh-mục-19-api-endpoints)
9. [Ví dụ Request / Response Thiết yếu](#9-ví-dụ-request--response-thiết-yếu)
10. [Kiểm tra Nhanh Luồng Nghiệp vụ bằng PowerShell](#10-kiểm-tra-nhanh-luồng-nghiệp-vụ-bằng-powershell)
11. [Thành phần Mở rộng Tùy chọn: Hàng đợi Redis & SSO Keycloak](#11-thành-phần-mở-rộng-tùy-chọn-hàng-đợi-redis--sso-keycloak)
12. [Công cụ Vận hành, Đo tải, Đối soát Dữ liệu & Sao lưu](#12-công-cụ-vận-hành-đo-tải-đối-soát-dữ-liệu--sao-lưu)
13. [Kiểm thử Tự động & Kiểm tra Mã nguồn](#13-kiểm-thử-tự-động--kiểm-tra-mã-nguồn)
14. [Xử lý Lỗi Thường gặp (Troubleshooting)](#14-xử-lý-lỗi-thường-gặp-troubleshooting)

---

## 1. Tổng quan Kiến trúc & Công nghệ

Backend được xây dựng theo kiến trúc phân tầng (`routers` → `services` → `repositories` → `PostgreSQL 16`), sử dụng các route đồng bộ chạy trên threadpool của FastAPI kết hợp `psycopg_pool.ConnectionPool` riêng biệt trên từng tiến trình Uvicorn worker.

| Thành phần | Công nghệ / Thư viện | Vai trò trong hệ thống |
|---|---|---|
| **Web API Framework** | `FastAPI 0.162.0`, `Uvicorn 0.54.0` | Xử lý HTTP, CORS allowlist chặt, chuẩn hóa lỗi JSON envelope, xuất OpenAPI 3.1 / Swagger UI |
| **Validation & Settings** | `Pydantic 2.14.2`, `pydantic-settings 2.16.2` | Kiểm tra chặt dữ liệu đầu vào (từ chối trường lạ `UNKNOWN_FIELD`, không ép kiểu ngầm) |
| **Cơ sở dữ liệu chính** | `PostgreSQL 16`, `psycopg[binary] 3.3.6`, `psycopg-pool 3.3.3` | Lưu trữ dữ liệu giao dịch ACID, khóa hàng `SELECT ... FOR UPDATE`, khóa tư vấn `pg_advisory_xact_lock`, partial unique index |
| **Bảo mật & Mật khẩu** | `argon2-cffi 25.1.0`, `hashlib (SHA-256)`, `secrets` | Băm mật khẩu bằng Argon2id (tách ngoài giao dịch DB), sinh Opaque Token 32 byte CSPRNG và băm SHA-256 |
| **Hàng đợi ảo (Tùy chọn)** | `Redis 7.4`, `redis-py 5.3.1` (Lua scripts) | Điều tiết lưu lượng đầu vào FIFO (`WAITING` / `READY` / `EXPIRED`), fail-closed `503` khi mất kết nối |
| **SSO OIDC (Tùy chọn)** | `Keycloak 26.0.5`, `PyJWT[crypto] 2.15.1`, `httpx 0.28.1` | Đăng nhập OIDC Authorization Code + PKCE (`S256`), xác thực chữ ký RSA/JWKS, cookie ràng buộc trình duyệt |
| **Kiểm thử & Linter** | `pytest 8.4.2`, `ruff 0.17.3`, `pgserver 0.1.4`, `fakeredis[lua] 2.40.0` | Kiểm thử đơn vị, hợp đồng HTTP, tích hợp PostgreSQL 16 thật và kiểm thử đồng thời đa worker |

---

## 2. Yêu cầu Môi trường

- **Hệ điều hành**: Windows 10/11 (khuyến nghị chạy lệnh trên **PowerShell**) hoặc Linux/macOS.
- **Cách 1 — Chạy bằng Docker Compose**:
  - Cài đặt **Docker Desktop** (hỗ trợ `docker compose`).
- **Cách 2 — Chạy trực tiếp bằng Python trên máy (không cần Docker)**:
  - **Python**: `>= 3.11, < 3.14` (khuyến nghị Python `3.11.9+` hoặc `3.12`).
  - **PostgreSQL 16**: dùng PostgreSQL 16 cài sẵn trên máy *hoặc* sử dụng tiện ích PostgreSQL 16 cục bộ đóng gói sẵn trong `.venv` qua gói `pgserver` (`python -m scripts.local_pg`).

---

## 3. Cấu trúc Thư mục Backend

```text
backend/
├── app/
│   ├── main.py                        # Khởi tạo FastAPI, lifespan pool, CORS middleware, exception handlers, OpenAPI
│   ├── core/
│   │   ├── config.py                  # Cấu hình biến môi trường có kiểu (Settings)
│   │   ├── errors.py                  # Mã lỗi chuẩn (ErrorCode, FieldErrorCode) & hàm tạo JSON error envelope
│   │   ├── security.py                # Argon2id, sinh Opaque Token CSPRNG, băm SHA-256, sinh PKCE S256
│   │   ├── logging.py                 # JSON structured logger tự động che mật khẩu/token/mã OIDC
│   │   ├── clock.py                   # Đồng hồ UTC chuẩn hóa ISO 8601 hậu tố 'Z'
│   │   └── rate_limit.py              # Bộ giới hạn tần suất bổ trợ (none | memory | redis)
│   ├── db/
│   │   ├── pool.py                    # DatabaseManager quản lý ConnectionPool & context transaction/snapshot
│   │   └── migrations.py              # Bộ chạy migration có khóa tư vấn pg_advisory_lock(88022026) & SHA-256 checksum
│   ├── api/
│   │   ├── deps.py                    # ContractRoute (kiểm tra Content-Type 415, cấm body DELETE), xác thực Bearer & RBAC
│   │   └── routers/                   # 8 routers chia theo nghiệp vụ (19 endpoints)
│   │       ├── auth.py                # /auth/login, /auth/refresh, /auth/logout
│   │       ├── sso.py                 # /auth/sso/login, /auth/sso/callback, /auth/sso/exchange
│   │       ├── course_classes.py      # /course-classes, /course-classes/{course_class_id}
│   │       ├── registrations.py       # /register, /registrations/{registration_id}, /registrations/me
│   │       ├── payments.py            # /payments, /payments/me
│   │       ├── admin.py               # /admin/course-classes (POST, PUT, PATCH status)
│   │       ├── queue.py               # /queue/join, /queue/status
│   │       └── health.py              # /health
│   ├── schemas/                       # Pydantic v2 strict schemas cho request/response
│   ├── services/                      # Điều phối giao dịch, thứ tự khóa, Idempotency SAVEPOINT, Redis Lua, OIDC
│   └── repositories/                  # Truy vấn SQL tham số hóa (psycopg 3), không tự COMMIT giữa chừng
├── migrations/
│   └── 001_initial_schema.sql         # Lược đồ PostgreSQL 16 (11 bảng, sequence LHP, partial unique index, CHECK)
├── scripts/
│   ├── migrate.py                     # CLI áp dụng SQL migrations
│   ├── seed.py                        # CLI nạp dữ liệu mẫu (--mode ui hoặc --mode loadtest)
│   ├── prepare_tokens.py              # CLI sinh trước access token phục vụ đo tải k6 (xuất ra exports/)
│   ├── reset_lab.py                   # CLI làm sạch dữ liệu giao dịch PostgreSQL & Redis giữa các lượt test
│   ├── check_invariants.py            # CLI đối soát 5 bất biến toàn vẹn dữ liệu trên PostgreSQL
│   ├── local_pg.py                    # CLI chạy máy chủ PostgreSQL 16 cục bộ bằng pgserver
│   ├── export_openapi_and_examples.py # CLI xuất OpenAPI JSON & các mẫu response ra outputs/api_examples/
│   └── sql/
│       └── check_invariants.sql       # Truy vấn SQL thuần kiểm tra bất biến toàn vẹn (dùng với psql)
├── .env.example                       # Tệp mẫu biến môi trường đầy đủ chú thích
├── Dockerfile                         # Đóng gói image Python 3.12 slim chạy user non-root (appuser)
├── pyproject.toml                     # Khai báo gói, phụ thuộc và cấu hình công cụ
├── requirements.lock                  # Phiên bản thư viện đã ghim cố định
└── README.md                          # Tài liệu hướng dẫn chi tiết backend (file hiện tại)
```

---

## 4. Cấu hình Biến Môi trường (`.env`)

Sao chép tệp cấu hình mẫu `.env.example` sang `backend/.env` (dùng khi chạy trực tiếp trong `backend/`) và `.env` ở thư mục gốc (dùng khi chạy `compose.dev.yml`).

**Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`)

```powershell
Copy-Item "backend\.env.example" "backend\.env"
Copy-Item "backend\.env.example" ".env"
```

### Bảng các biến môi trường trọng tâm

| Biến môi trường | Giá trị mặc định (`.env.example`) | Ý nghĩa & Lưu ý vận hành |
|---|---|---|
| `APP_ENV` | `dev` | `dev` \| `test` \| `lab` \| `prod`. Các script `seed`, `reset_lab`, `prepare_tokens` tự động từ chối thực thi nếu `APP_ENV=prod` |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8080` | Địa chỉ và cổng lắng nghe HTTP của dịch vụ API |
| `API_WORKERS` | `2` | Số tiến trình Uvicorn worker khi chạy trong container Docker |
| `DATABASE_URL` | `postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_dev` | Chuỗi kết nối PostgreSQL 16 chính của ứng dụng |
| `TEST_DATABASE_URL` | `postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_test` | Chuỗi kết nối DB dành riêng cho `pytest` khi bật `PYTEST_USE_EXTERNAL_DB=true` (tên DB bắt buộc chứa `test`/`pytest` và không được trùng `DATABASE_URL`) |
| `DB_POOL_MIN_SIZE` / `DB_POOL_MAX_SIZE` | `2` / `10` | Số kết nối tối thiểu/tối đa trên **mỗi worker**. Quy tắc: `API_WORKERS * DB_POOL_MAX_SIZE + kết nối dự phòng < max_connections (100)` |
| `DB_POOL_TIMEOUT_SECONDS` | `3.0` | Thời gian chờ lấy kết nối từ pool; quá hạn trả `503 SERVICE_BUSY` kèm `Retry-After: 1` |
| `DB_IDEMPOTENCY_LOCK_TIMEOUT_MS` | `1500` | Thời gian chờ `pg_advisory_xact_lock` cho cùng `(user_id, idempotency_key)`; quá hạn trả `409 REQUEST_IN_PROGRESS` |
| `DB_LOCK_TIMEOUT_MS` | `2000` | Thời gian chờ khóa hàng `FOR UPDATE`; quá hạn rollback và trả `503 SERVICE_BUSY` |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | Thời gian tối đa cho một câu lệnh SQL trong giao dịch |
| `ACCESS_TOKEN_TTL_SECONDS` | `3600` | Thời hạn của `access_token` (1 giờ) |
| `SESSION_ABSOLUTE_TTL_SECONDS` | `28800` | Thời hạn tuyệt đối của phiên đăng nhập tính từ lúc login (8 giờ) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Danh sách origin được phép gọi CORS (phân tách bằng dấu phẩy, không dùng `*`) |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | Origin trình duyệt nhận điều hướng `302` sau khi hoàn tất SSO callback |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Thời gian lưu giữ bản ghi `idempotency_records` (24 giờ) |
| `TUITION_PER_CREDIT` | `500000` | Đơn giá học phí mỗi tín chỉ (số nguyên `VND`; 3 tín chỉ = `1500000` VND) |
| `PAYMENTS_ENABLED` | `true` | Bật/tắt nhóm API thanh toán học phí mô phỏng |
| `QUEUE_ENABLED` | `false` | Bật/tắt hàng đợi ảo Redis (`POST /queue/join`, `GET /queue/status`, kiểm tra `X-Queue-Token`) |
| `SSO_ENABLED` | `false` | Bật/tắt đăng nhập SSO qua Keycloak OIDC (`/auth/sso/*`) |
| `REDIS_URL` | `redis://localhost:6379/0` | Kết nối Redis khi `QUEUE_ENABLED=true` hoặc `RATE_LIMIT_BACKEND=redis` |
| `RATE_LIMIT_BACKEND` | `none` | `none` \| `memory` (cục bộ từng worker) \| `redis` (toàn cục xuyên worker) |

---

## 5. Cài đặt & Khởi chạy Backend

### Cách A — Khởi chạy bằng Docker Compose (Khuyến nghị)

Tệp `compose.dev.yml` đặt tại **thư mục gốc của dự án** (`../compose.dev.yml` nếu tính từ `backend/`). Khi chạy, Docker Compose sẽ khởi động `postgres` (PostgreSQL 16.4), chạy container `migrate` để áp dụng lược đồ, sau đó khởi chạy `api` với 2 Uvicorn workers tại cổng `8080`.

**Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`)

```powershell
# 1. Tạo tệp .env nếu chưa có
Copy-Item "backend\.env.example" ".env"

# 2. Khởi tạo PostgreSQL 16 + tự động chạy migration + khởi chạy API (cổng 8080)
docker compose -f compose.dev.yml up -d --build

# 3. Nạp dữ liệu mẫu chế độ giao diện (3.000 sinh viên + AD0001 + 3 lớp LHP001, LHP002, LHP003)
docker compose -f compose.dev.yml exec api python -m scripts.seed --mode ui

# 4. Kiểm tra trạng thái các container
docker compose -f compose.dev.yml ps
```

*(Nếu bạn đang đứng tại thư mục `backend/`, hãy gọi `docker compose -f ..\compose.dev.yml ...`)*

---

### Cách B — Chạy Trực tiếp bằng Python trên Windows (Không cần Docker)

#### Bước 1: Tạo môi trường ảo `.venv` và cài đặt dependencies

**Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`)

```powershell
python -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\pip.exe" install -r "backend\requirements.lock"
& ".\.venv\Scripts\pip.exe" install -e "backend[dev]"
```

#### Bước 2: Khởi chạy PostgreSQL 16

- **Trường hợp 1 (Đã cài sẵn PostgreSQL 16 trên máy)**: Tạo cơ sở dữ liệu `dkhp_dev` và cập nhật chuỗi kết nối `DATABASE_URL` trong `backend\.env`.
- **Trường hợp 2 (Chưa cài PostgreSQL hệ thống — dùng `pgserver` đi kèm trong `.venv`)**: Mở **Cửa sổ PowerShell số 1** và chạy:

  **Thư mục làm việc**: `DangKyHocPhanTrucTuyen\backend`
  ```powershell
  Set-Location "backend"
  & "..\.venv\Scripts\python.exe" -m scripts.local_pg
  ```
  Cửa sổ số 1 sẽ khởi tạo PostgreSQL 16 cục bộ (tự động tạo cả 2 database `dkhp_dev` và `dkhp_test`) và in ra dòng `DATABASE_URL=postgresql://...`. Giữ cửa sổ này mở và sao chép chuỗi `DATABASE_URL` đó để dùng ở Bước 3.

#### Bước 3: Chạy Migration, Seed dữ liệu mẫu và Khởi động Uvicorn

Mở **Cửa sổ PowerShell số 2**:

**Thư mục làm việc**: `DangKyHocPhanTrucTuyen\backend`

```powershell
Set-Location "backend"

# Nếu dùng scripts.local_pg ở Bước 2, gán DATABASE_URL vừa in ở Cửa sổ 1:
# $env:DATABASE_URL = "postgresql://postgres:password@localhost:xxxxx/dkhp_dev"

# 1. Áp dụng lược đồ PostgreSQL 16 (bảng schema_migrations + kiểm tra SHA-256 checksum)
& "..\.venv\Scripts\python.exe" -m scripts.migrate

# 2. Nạp dữ liệu mẫu chế độ giao diện (SV0001..SV3000, AD0001, LHP001..LHP003)
& "..\.venv\Scripts\python.exe" -m scripts.seed --mode ui

# 3. Khởi động máy chủ API tại cổng 8080
# Lưu ý trên Windows khi chạy trực tiếp ngoài Docker: không truyền --workers 2 cùng --host 0.0.0.0
# để tránh lỗi socket Winsock (WinError 10022); threadpool + psycopg_pool vẫn xử lý song song bình thường.
& "..\.venv\Scripts\uvicorn.exe" app.main:app --host 0.0.0.0 --port 8080
```

---

### Dữ liệu Mẫu Mặc định sau khi Chạy `scripts.seed --mode ui`

> **Lưu ý**: Mật khẩu mẫu phòng lab của các tài khoản được khai báo tại biến `LAB_DEMO_PASSWORD` trong `backend/scripts/seed.py` (mặc định: `Demo@123456`).

| Mã định danh (`student_id`) | Vai trò (`role`) | Đặc điểm trong chế độ `--mode ui` |
|---|---|---|
| `SV0001` | `STUDENT` | **Đã hoàn thành** môn tiên quyết `CS101`; đã ánh xạ sẵn danh tính SSO (`sv0001`) |
| `SV0002` .. `SV3000` | `STUDENT` | **Chưa hoàn thành** môn tiên quyết `CS101` (dùng để kiểm chứng lỗi thiếu tiên quyết ở `LHP001`) |
| `AD0001` | `ADMIN` | Tài khoản quản trị viên (tạo, cập nhật, đóng/mở lớp học phần) |

| Mã lớp (`course_class_id`) | `class_code` | Học phần | Tín chỉ / Học phí | Sĩ số tối đa (`capacity`) | Lịch học | Tiên quyết | Kịch bản kiểm chứng |
|---|---|---|---|---|---|---|---|
| `LHP001` | `CNNT-01` | Công nghệ nền tảng (`CNNT`) | 3 TC / `1500000` VND | `50` (`OPEN`) | `MON` tiết `1–3` (`A101`) | `CS101` | `SV0001` đăng ký thành công (`200`); `SV0002` bị từ chối do thiếu tiên quyết (`409 PREREQUISITE_NOT_MET`) |
| `LHP002` | `WEB-01` | Phát triển ứng dụng Web (`WEB`) | 3 TC / `1500000` VND | `50` (`OPEN`) | `MON` tiết `2–4` (`B201`) | Không | Trùng lịch `MON` tiết `2–3` với `LHP001` (`409 SCHEDULE_CONFLICT`) |
| `LHP003` | `JAVA-01` | Lập trình hướng đối tượng với Java (`JAVA`) | 3 TC / `1500000` VND | `50` (`OPEN`) | `TUE` tiết `1–3` (`C301`) | Không | Mọi sinh viên đều đủ điều kiện đăng ký, thanh toán mô phỏng và hủy hoàn tiền |

---

## 6. Địa chỉ Truy cập Dịch vụ

Khi dịch vụ đang chạy với cấu hình cổng mặc định:

- **API Base URL**: `http://localhost:8080/api/v1`
- **Healthcheck & Trạng thái Feature Flags**: `http://localhost:8080/api/v1/health`
- **Tài liệu tương tác Swagger UI**: `http://localhost:8080/docs`
- **Đặc tả OpenAPI 3.1 JSON**: `http://localhost:8080/openapi.json`
- **Keycloak Admin / OIDC Realm** *(chỉ khi bật profile `sso` hoặc `full`)*: `http://localhost:8081`

---

## 7. Cơ chế Xác thực, Phiên đăng nhập & Kiểm soát Đồng thời

### 7.1. Xác thực bằng Opaque Token (Không dùng JWT cho phiên nội bộ)
- Khi đăng nhập thành công (`POST /api/v1/auth/login` hoặc `POST /api/v1/auth/sso/exchange`), hệ thống sinh cặp **Opaque Token** ngẫu nhiên 32 byte bằng CSPRNG (`secrets.token_urlsafe(32)`): `access_token` và `refresh_token`.
- Cơ sở dữ liệu **không lưu token gốc** mà chỉ lưu bản băm **SHA-256** (`access_token_hash`, `refresh_token_hash`) trong bảng `sessions`.
- Mọi API yêu cầu xác thực đều nhận header:
  ```http
  Authorization: Bearer <access_token>
  ```
- **Xoay vòng Refresh Token nguyên tử (`POST /api/v1/auth/refresh`)**:
  - Mỗi lần gọi `/auth/refresh`, cả `access_token` và `refresh_token` cũ bị thay thế nguyên tử trong cùng một câu lệnh `UPDATE ... RETURNING` có kiểm tra điều kiện. Token cũ mất hiệu lực ngay lập tức.
  - Phía client cần dùng cơ chế **single-flight** (gom các yêu cầu bị `401` cùng lúc vào một lời gọi `/auth/refresh` duy nhất).
  - Phiên đăng nhập có **thời hạn tuyệt đối 8 giờ (`28800` giây)** kể từ lúc đăng nhập ban đầu (`absolute_expires_at`). Khi còn dưới 1 giờ trước mốc 8 giờ, `expires_in` sẽ tự động co lại theo thời gian thực tế còn lại.
- **Đăng xuất theo từng thiết bị (`POST /api/v1/auth/logout`)**:
  - Yêu cầu gửi đồng thời `Authorization: Bearer <access_token>` và body `{"refresh_token": "..."}` của cùng phiên đó. Chỉ thu hồi đúng phiên hiện tại (`revoked_at = NOW()`), không làm gián đoạn các phiên đăng nhập khác của cùng người dùng.

### 7.2. Thứ tự Khóa Giao dịch & Chống Oversell / Deadlock
- Mức cô lập giao dịch mặc định cho các thao tác ghi là PostgreSQL `READ COMMITTED` kết hợp khóa hàng tường minh `SELECT ... FOR UPDATE`.
- **Thứ tự lấy khóa cố định một chiều** trong mọi giao dịch của sinh viên (`POST /register`, `DELETE /registrations/{id}`, `POST /payments`):
  1. `pg_advisory_xact_lock(user_id, idempotency_key)` — tuần tự hóa các yêu cầu gửi trùng cùng `Idempotency-Key`.
  2. `SELECT ... FROM users WHERE id = %s FOR UPDATE` — tuần tự hóa mọi thao tác đồng thời của **cùng một sinh viên** (ngăn sinh viên mở 2 tab đăng ký đồng thời 2 lớp trùng lịch `LHP001` và `LHP002`, hoặc vừa thanh toán vừa hủy cùng lúc), nhưng **không làm nghẽn** các sinh viên khác nhau.
  3. `SELECT ... FROM course_classes WHERE course_class_id = %s FOR UPDATE` — tuần tự hóa việc kiểm tra và trừ chỗ (`remaining_seats`) giữa các sinh viên cùng tranh chỗ trên một lớp.
  4. `SELECT ... FROM registrations ... FOR UPDATE` → `SELECT ... FROM payments ... FOR UPDATE`.
- **Chốt chặn vật lý ở tầng PostgreSQL**:
  - `CHECK (remaining_seats >= 0 AND remaining_seats <= capacity)` trên bảng `course_classes`.
  - **Partial Unique Index** `CREATE UNIQUE INDEX uq_registrations_active_user_class ON registrations(user_id, course_class_id) WHERE status = 'ACTIVE'` ngăn tuyệt đối việc một sinh viên có 2 bản ghi `ACTIVE` ở cùng một lớp, đồng thời vẫn cho phép lưu nhiều bản ghi `CANCELLED` trong lịch sử khi hủy rồi đăng ký lại.

### 7.3. Cơ chế `Idempotency-Key` Xuyên Nhiều Worker
- Ba thao tác ghi dữ liệu bắt buộc truyền header `Idempotency-Key` định dạng **UUID v4**:
  - `POST /api/v1/register`
  - `DELETE /api/v1/registrations/{registration_id}`
  - `POST /api/v1/payments`
- Hệ thống tính vân tay yêu cầu (**SHA-256 canonical fingerprint**) từ `(HTTP_METHOD, canonical_path, canonical_json_body)`.
- Bên trong giao dịch PostgreSQL, logic nghiệp vụ chạy trong một **`SAVEPOINT`**:
  - Nếu thành công (`200`) **hoặc** gặp lỗi nghiệp vụ xác định (`404 CLASS_NOT_FOUND`, `404 REGISTRATION_NOT_FOUND`, `409 ALREADY_REGISTERED`, `409 REGISTRATION_CLOSED`, `409 PREREQUISITE_NOT_MET`, `409 SCHEDULE_CONFLICT`, `409 CLASS_FULL`, `409 ALREADY_PAID`), `SAVEPOINT` hoàn tác các thay đổi dở dang (nếu lỗi) nhưng giao dịch ngoài vẫn lưu nguyên vẹn phản hồi JSON đó vào bảng `idempotency_records` và `COMMIT`.
  - Khi client gửi lại đúng `Idempotency-Key` và cùng payload trong vòng 24 giờ, hệ thống trả lại đúng HTTP status, JSON body và `request_id` gốc kèm header `Idempotent-Replayed: true`.
  - Nếu gửi lại cùng `Idempotency-Key` nhưng thay đổi payload hoặc đường dẫn, hệ thống trả lỗi `422 IDEMPOTENCY_KEY_REUSED`.
  - Nếu một yêu cầu cùng `Idempotency-Key` đang được xử lý ở worker khác chưa xong sau thời gian chờ khóa (`1500ms`), yêu cầu đến sau nhận `409 REQUEST_IN_PROGRESS` kèm `Retry-After: 1`.

---

## 8. Danh mục 19 API Endpoints

Tất cả endpoint đều có tiền tố `/api/v1`. Dữ liệu thời gian dùng chuẩn UTC ISO 8601 có hậu tố `Z`; tiền tệ là số nguyên `VND`.

| # | Phương thức & Đường dẫn | Quyền truy cập | Header / Tham số đầu vào chính | Mã thành công | Các mã lỗi tiêu biểu |
|---|---|---|---|---|---|
| 1 | `POST /api/v1/auth/login` | Công khai | Body: `{student_id, password}` | `200 LOGIN_SUCCESS` | `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS`, `429 RATE_LIMITED` |
| 2 | `POST /api/v1/auth/refresh` | Công khai | Body: `{refresh_token}` | `200 TOKEN_REFRESHED` | `400 VALIDATION_ERROR`, `401 INVALID_REFRESH_TOKEN`, `429 RATE_LIMITED` |
| 3 | `POST /api/v1/auth/logout` | Bearer (`STUDENT`/`ADMIN`) | Body: `{refresh_token}` (cùng phiên) | `200 LOGGED_OUT` | `401 UNAUTHORIZED`, `401 INVALID_REFRESH_TOKEN` |
| 4 | `GET /api/v1/auth/sso/login` | Công khai | Điều hướng trình duyệt (không truyền query lạ) | `302 Found` (tới Keycloak) | `400 VALIDATION_ERROR`, `503 SERVICE_UNAVAILABLE` (khi tắt SSO) |
| 5 | `GET /api/v1/auth/sso/callback` | Callback từ IdP | Query: `code`, `state` + Cookie `dkhp_sso_bind` | `302 Found` (về Frontend) | `302 ?error=SSO_FAILED`, `503 SERVICE_UNAVAILABLE` |
| 6 | `POST /api/v1/auth/sso/exchange` | Công khai | Body: `{exchange_code}` (hiệu lực 60s, 1 lần) | `200 LOGIN_SUCCESS` | `400 VALIDATION_ERROR`, `401 SSO_FAILED`, `503 SERVICE_UNAVAILABLE` |
| 7 | `GET /api/v1/course-classes` | Bearer (`STUDENT`/`ADMIN`) | Query: `page=1`, `page_size=20` (`1..100`), `q` | `200 COURSE_CLASSES_FETCHED` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED` |
| 8 | `GET /api/v1/course-classes/{course_class_id}` | Bearer (`STUDENT`/`ADMIN`) | Path: `course_class_id` (`^LHP[0-9]{3,6}$`) | `200 COURSE_CLASS_FETCHED` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `404 CLASS_NOT_FOUND` |
| 9 | `POST /api/v1/register` | Bearer (`STUDENT`) | Header: `Idempotency-Key` (UUIDv4), `X-Queue-Token` (khi bật queue); Body: `{student_id, course_class_id}` | `200 REGISTERED` | `403 STUDENT_MISMATCH`, `403 QUEUE_TOKEN_*`, `404 CLASS_NOT_FOUND`, `409 ALREADY_REGISTERED`, `409 REGISTRATION_CLOSED`, `409 PREREQUISITE_NOT_MET`, `409 SCHEDULE_CONFLICT`, `409 CLASS_FULL`, `409 REQUEST_IN_PROGRESS`, `422 IDEMPOTENCY_KEY_REUSED` |
| 10 | `DELETE /api/v1/registrations/{registration_id}` | Bearer (`STUDENT`) | Header: `Idempotency-Key` (UUIDv4); Path: `registration_id` (không gửi body) | `200 REGISTRATION_CANCELLED` | `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 REGISTRATION_NOT_FOUND`, `409 REQUEST_IN_PROGRESS`, `422 IDEMPOTENCY_KEY_REUSED` |
| 11 | `GET /api/v1/registrations/me` | Bearer (`STUDENT`) | Query: `page=1`, `page_size=20`, `status=ACTIVE\|CANCELLED\|ALL` | `200 REGISTRATIONS_FETCHED` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN` |
| 12 | `POST /api/v1/payments` | Bearer (`STUDENT`) | Header: `Idempotency-Key` (UUIDv4); Body: `{registration_id}` | `200 PAYMENT_SUCCESS` | `404 REGISTRATION_NOT_FOUND`, `409 ALREADY_PAID`, `409 REQUEST_IN_PROGRESS`, `422 IDEMPOTENCY_KEY_REUSED`, `503 SERVICE_UNAVAILABLE` |
| 13 | `GET /api/v1/payments/me` | Bearer (`STUDENT`) | Query: `page=1`, `page_size=20`, `status=PAID\|REFUNDED\|ALL` | `200 PAYMENTS_FETCHED` | `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `503 SERVICE_UNAVAILABLE` |
| 14 | `POST /api/v1/admin/course-classes` | Bearer (`ADMIN`) | Body: `{class_code, course_code, course_name, credits, capacity, status, schedule, prerequisite_course_codes}` | `201 COURSE_CLASS_CREATED` | `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `409 CLASS_CODE_EXISTS` |
| 15 | `PUT /api/v1/admin/course-classes/{course_class_id}` | Bearer (`ADMIN`) | Path: `course_class_id`; Body: đầy đủ như `POST` | `200 COURSE_CLASS_UPDATED` | `404 CLASS_NOT_FOUND`, `409 CLASS_CODE_EXISTS`, `409 CAPACITY_BELOW_REGISTERED`, `409 CLASS_HAS_REGISTRATIONS` |
| 16 | `PATCH /api/v1/admin/course-classes/{course_class_id}/status` | Bearer (`ADMIN`) | Path: `course_class_id`; Body: `{status: "OPEN"\|"CLOSED"}` | `200 COURSE_CLASS_STATUS_UPDATED` | `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `404 CLASS_NOT_FOUND` |
| 17 | `POST /api/v1/queue/join` | Bearer (`STUDENT`) | Body: `{}` | `200 QUEUE_JOINED` | `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `503 SERVICE_UNAVAILABLE` |
| 18 | `GET /api/v1/queue/status` | Bearer (`STUDENT`) | Không truyền query lạ | `200 QUEUE_STATUS_FETCHED` | `400 VALIDATION_ERROR`, `403 FORBIDDEN`, `503 SERVICE_UNAVAILABLE` |
| 19 | `GET /api/v1/health` | Công khai | Không truyền query lạ | `200 HEALTHY` | `400 VALIDATION_ERROR`, `503 SERVICE_UNAVAILABLE` |

---

## 9. Ví dụ Request / Response Thiết yếu

### 9.1. Đăng nhập (`POST /api/v1/auth/login`)

**Request**:
```json
{
  "student_id": "SV0001",
  "password": "<LAB_DEMO_PASSWORD>"
}
```

**Response (`200 OK`)**:
```json
{
  "success": true,
  "code": "LOGIN_SUCCESS",
  "message": "Đăng nhập thành công.",
  "data": {
    "access_token": "<OPAQUE_ACCESS_TOKEN>",
    "token_type": "Bearer",
    "expires_in": 3600,
    "refresh_token": "<OPAQUE_REFRESH_TOKEN>",
    "refresh_expires_in": 28800,
    "student": {
      "student_id": "SV0001",
      "full_name": "Sinh viên mẫu 0001",
      "role": "STUDENT"
    }
  },
  "request_id": "8c6c3ed0-768d-4fc6-8792-7b7eae691501"
}
```

### 9.2. Đăng ký lớp học phần thành công (`POST /api/v1/register`)

**Headers**:
```http
Authorization: Bearer <OPAQUE_ACCESS_TOKEN>
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json
```

**Request Body**:
```json
{
  "student_id": "SV0001",
  "course_class_id": "LHP001"
}
```

**Response (`200 OK`)**:
```json
{
  "success": true,
  "code": "REGISTERED",
  "message": "Đăng ký học phần thành công.",
  "data": {
    "registration": {
      "registration_id": "4d0ce29e-9e4d-4e0a-8a92-f776fe905001",
      "student_id": "SV0001",
      "course_class_id": "LHP001",
      "class_code": "CNNT-01",
      "course_name": "Công nghệ nền tảng",
      "credits": 3,
      "status": "ACTIVE",
      "payment_status": "UNPAID",
      "tuition_amount": 1500000,
      "registered_at": "2026-11-01T08:30:00Z",
      "cancelled_at": null
    },
    "course_class": {
      "course_class_id": "LHP001",
      "class_code": "CNNT-01",
      "course_code": "CNNT",
      "course_name": "Công nghệ nền tảng",
      "credits": 3,
      "capacity": 50,
      "remaining_seats": 49,
      "registered_count": 1,
      "status": "OPEN",
      "schedule": [
        {
          "day_of_week": "MON",
          "start_period": 1,
          "end_period": 3,
          "room": "A101"
        }
      ],
      "prerequisites": [
        {
          "course_code": "CS101",
          "course_name": "Nhập môn lập trình",
          "satisfied": true
        }
      ],
      "tuition_amount": 1500000,
      "registration_status": "REGISTERED",
      "registration_id": "4d0ce29e-9e4d-4e0a-8a92-f776fe905001",
      "payment_status": "UNPAID"
    }
  },
  "request_id": "8c6c3ed0-768d-4fc6-8792-7b7eae691501"
}
```

### 9.3. Hủy đăng ký đã thanh toán — Tự động hoàn tiền mô phỏng (`DELETE /api/v1/registrations/{registration_id}`)

**Response (`200 OK`)**:
```json
{
  "success": true,
  "code": "REGISTRATION_CANCELLED",
  "message": "Hủy đăng ký học phần thành công.",
  "data": {
    "registration": {
      "registration_id": "4d0ce29e-9e4d-4e0a-8a92-f776fe905001",
      "student_id": "SV0001",
      "course_class_id": "LHP001",
      "class_code": "CNNT-01",
      "course_name": "Công nghệ nền tảng",
      "credits": 3,
      "status": "CANCELLED",
      "payment_status": "REFUNDED",
      "tuition_amount": 1500000,
      "registered_at": "2026-11-01T08:30:00Z",
      "cancelled_at": "2026-11-01T08:40:00Z"
    },
    "course_class": {
      "course_class_id": "LHP001",
      "class_code": "CNNT-01",
      "course_code": "CNNT",
      "course_name": "Công nghệ nền tảng",
      "credits": 3,
      "capacity": 50,
      "remaining_seats": 50,
      "registered_count": 0,
      "status": "OPEN",
      "schedule": [
        {
          "day_of_week": "MON",
          "start_period": 1,
          "end_period": 3,
          "room": "A101"
        }
      ],
      "prerequisites": [
        {
          "course_code": "CS101",
          "course_name": "Nhập môn lập trình",
          "satisfied": true
        }
      ],
      "tuition_amount": 1500000,
      "registration_status": "NOT_REGISTERED",
      "registration_id": null,
      "payment_status": null
    },
    "refund": {
      "payment_id": "61de10f7-8f5e-4d34-a3cd-0dcb5da42519",
      "amount": 1500000,
      "currency": "VND",
      "status": "REFUNDED",
      "refunded_at": "2026-11-01T08:40:00Z"
    }
  },
  "request_id": "8c6c3ed0-768d-4fc6-8792-7b7eae691501"
}
```

### 9.4. Ví dụ Phản hồi Lỗi Nghiệp vụ Chuẩn (`409 Conflict` / `422 Unprocessable Entity`)

- **Chưa đạt môn tiên quyết (`409 PREREQUISITE_NOT_MET`)**:
  ```json
  {
    "success": false,
    "code": "PREREQUISITE_NOT_MET",
    "message": "Chưa đạt tiên quyết.",
    "data": null,
    "errors": [
      {
        "field": "prerequisites[0].course_code",
        "code": "PREREQUISITE_MISSING",
        "message": "CS101 — Nhập môn lập trình chưa hoàn thành."
      }
    ],
    "request_id": "8c6c3ed0-768d-4fc6-8792-7b7eae691501"
  }
  ```

- **Trùng lịch học (`409 SCHEDULE_CONFLICT`)**:
  ```json
  {
    "success": false,
    "code": "SCHEDULE_CONFLICT",
    "message": "Trùng lịch học.",
    "data": null,
    "errors": [
      {
        "field": "schedule",
        "code": "CLASS_TIME_CONFLICT",
        "message": "Trùng lớp LHP002 vào MON tiết 2–3."
      }
    ],
    "request_id": "8c6c3ed0-768d-4fc6-8792-7b7eae691501"
  }
  ```

---

## 10. Kiểm tra Nhanh Luồng Nghiệp vụ bằng PowerShell

Khi dịch vụ API đang chạy tại `http://localhost:8080`, mở một cửa sổ PowerShell ở bất kỳ thư mục nào để kiểm tra trọn vẹn luồng **Health → Đăng nhập → Xem lớp → Đăng ký → Thanh toán mô phỏng → Hủy & Hoàn tiền**:

**Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`) hoặc `DangKyHocPhanTrucTuyen\backend`

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$BaseUrl = "http://localhost:8080/api/v1"
$LabPassword = "Demo" + "@123456" # Mật khẩu mẫu phòng lab trong scripts/seed.py

# 1. Kiểm tra Healthcheck
Invoke-RestMethod -Method Get -Uri "$BaseUrl/health" | ConvertTo-Json -Depth 5

# 2. Đăng nhập tài khoản SV0001 (đã hoàn thành môn tiên quyết CS101)
$LoginBody = @{ student_id = "SV0001"; password = $LabPassword } | ConvertTo-Json
$LoginResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/auth/login" `
    -ContentType "application/json" -Body $LoginBody
$AccessToken = $LoginResp.data.access_token
Write-Host "Đăng nhập thành công: $($LoginResp.data.student.student_id)"

# 3. Tra cứu danh sách lớp học phần
$AuthHeaders = @{ Authorization = "Bearer $AccessToken" }
Invoke-RestMethod -Method Get -Uri "$BaseUrl/course-classes?page=1&page_size=20" `
    -Headers $AuthHeaders | ConvertTo-Json -Depth 6

# 4. Đăng ký lớp LHP001 kèm Idempotency-Key (UUID v4)
$RegKey = [guid]::NewGuid().ToString()
$RegBody = @{ student_id = "SV0001"; course_class_id = "LHP001" } | ConvertTo-Json
$RegResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/register" `
    -Headers @{ Authorization = "Bearer $AccessToken"; "Idempotency-Key" = $RegKey } `
    -ContentType "application/json" -Body $RegBody
$RegId = $RegResp.data.registration.registration_id
Write-Host "Đăng ký thành công: registration_id=$RegId | chỗ còn lại=$($RegResp.data.course_class.remaining_seats)"

# 5. Thanh toán học phí mô phỏng cho đăng ký vừa tạo
$PayKey = [guid]::NewGuid().ToString()
$PayBody = @{ registration_id = $RegId } | ConvertTo-Json
$PayResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/payments" `
    -Headers @{ Authorization = "Bearer $AccessToken"; "Idempotency-Key" = $PayKey } `
    -ContentType "application/json" -Body $PayBody
Write-Host "Thanh toán: status=$($PayResp.data.payment.status) | amount=$($PayResp.data.payment.amount) VND"

# 6. Hủy đăng ký (tự động hoàn chỗ + chuyển trạng thái sang REFUNDED nguyên tử)
$CancelKey = [guid]::NewGuid().ToString()
$CancelResp = Invoke-RestMethod -Method Delete -Uri "$BaseUrl/registrations/$RegId" `
    -Headers @{ Authorization = "Bearer $AccessToken"; "Idempotency-Key" = $CancelKey }
Write-Host "Sau khi hủy: status=$($CancelResp.data.registration.status), payment_status=$($CancelResp.data.registration.payment_status), chỗ còn lại=$($CancelResp.data.course_class.remaining_seats)"
```

---

## 11. Thành phần Mở rộng Tùy chọn: Hàng đợi Redis & SSO Keycloak

Mặc định `QUEUE_ENABLED=false` và `SSO_ENABLED=false` để việc chạy phát triển và đo tải cốt lõi không phụ thuộc dịch vụ ngoài PostgreSQL. Bạn có thể bật từng phần qua Docker Compose profiles.

### 11.1. Hàng đợi Ảo Redis (`QUEUE_ENABLED=true`)
- **Mục đích**: Giới hạn số sinh viên được cấp quyền bước vào vùng giao dịch đăng ký cùng lúc (`QUEUE_MAX_READY`, mặc định `100`), bảo vệ connection pool của PostgreSQL khi có lượng truy cập đột biến.
- **Lưu ý nghiệp vụ**: Trạng thái `READY` và `X-Queue-Token` chỉ là vé vào cửa tạm thời (mặc định `300` giây), **không giữ chỗ** trong lớp học phần. Khi sinh viên đăng xuất (`POST /auth/logout`), lượt hàng đợi của sinh viên đó trên Redis được tự động giải phóng để đôn người kế tiếp lên.
- **Khởi chạy với Docker Compose**:

  **Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`)
  ```powershell
  $env:QUEUE_ENABLED = "true"
  docker compose -f compose.dev.yml --profile queue up -d --build
  ```
- **Luồng gọi API khi bật Queue**:
  1. Gọi `POST /api/v1/queue/join` (body `{}`) để lấy trạng thái `READY` (nếu còn slot) hoặc `WAITING` (kèm vị trí `position`).
  2. Nếu `WAITING`, định kỳ gọi `GET /api/v1/queue/status` (khuyến nghị mỗi 3 giây) cho tới khi `status == "READY"`.
  3. Đính kèm header `X-Queue-Token: <queue_token>` khi gọi `POST /api/v1/register`. (Lưu ý: các yêu cầu replay `Idempotency-Key` đã hoàn tất được trả kết quả trước bước kiểm tra `X-Queue-Token`).

### 11.2. Đăng nhập SSO qua Keycloak OIDC + PKCE (`SSO_ENABLED=true`)
- **Mục đích**: Xác thực tập trung qua giao thức OpenID Connect Authorization Code + PKCE (`S256`).
- **Cấu hình tự động**: Container Keycloak tự động nạp file `infra/keycloak/dkhp-realm.json` (realm `dkhp`, client `dkhp-backend`, tài khoản mẫu `sv0001` ánh xạ tới `SV0001`).
- **Khởi chạy với Docker Compose**:

  **Thư mục làm việc**: thư mục gốc dự án (`DangKyHocPhanTrucTuyen`)
  ```powershell
  $env:SSO_ENABLED = "true"
  docker compose -f compose.dev.yml --profile sso up -d --build
  ```
- **Luồng hoạt động**:
  1. Trình duyệt điều hướng tới `GET http://localhost:8080/api/v1/auth/sso/login`. Backend lưu giao dịch OIDC (`state`, `nonce`, `code_verifier`), đặt cookie tạm `dkhp_sso_bind` (`HttpOnly; SameSite=Lax; Path=/api/v1/auth/sso/callback`) và chuyển hướng `302` sang Keycloak (`http://localhost:8081`).
  2. Sau khi đăng nhập tại Keycloak, trình duyệt quay về `GET /api/v1/auth/sso/callback`. Backend đối chiếu `state` + cookie `dkhp_sso_bind`, đổi mã với PKCE, xác minh chữ ký JWT qua JWKS và điều hướng `302` về `{FRONTEND_ORIGIN}/sso/callback?exchange_code=...`.
  3. Ứng dụng giao diện gọi `POST /api/v1/auth/sso/exchange` với body `{"exchange_code": "..."}` (mã chỉ dùng 1 lần trong 60 giây) để nhận cặp `access_token` và `refresh_token` nội bộ.

*(Để bật đồng thời cả Redis và Keycloak, dùng `--profile full` kèm `$env:QUEUE_ENABLED="true"; $env:SSO_ENABLED="true"`).*

---

## 12. Công cụ Vận hành, Đo tải, Đối soát Dữ liệu & Sao lưu

Tất cả lệnh CLI dưới đây được thực thi từ thư mục `backend/`.

**Thư mục làm việc**: `DangKyHocPhanTrucTuyen\backend`

### 12.1. Kiểm tra Bất biến Toàn vẹn Dữ liệu (`scripts.check_invariants`)
Công cụ kiểm tra 5 bất biến liên bảng trong giao dịch `REPEATABLE READ READ ONLY`:
1. `remaining_seats + COUNT(ACTIVE) == capacity` và `0 <= remaining_seats <= capacity` trên mọi lớp học phần.
2. Không có 2 bản ghi `ACTIVE` trùng cặp `(user_id, course_class_id)`.
3. Không có bản ghi `CANCELLED` nào còn mang trạng thái thanh toán `PAID`.
4. Đối xứng 1–1 giữa `registrations.payment_status` và bảng `payments`.
5. Không có sinh viên nào có 2 lớp `ACTIVE` trùng thứ và giao tiết học.

```powershell
& "..\.venv\Scripts\python.exe" -m scripts.check_invariants
```
*(Trả về JSON có `"ok": true` và mã thoát `0` nếu toàn vẹn tuyệt đối. Ngoài ra có thể chạy file SQL thuần `scripts/sql/check_invariants.sql` bằng `psql`).*

### 12.2. Chuẩn bị Dữ liệu & Token cho Kịch bản Đo tải (`loadtest`)
Chế độ `--mode loadtest` thiết lập lớp `LHP001` có `capacity = 1000`, không yêu cầu môn tiên quyết và không gắn lịch học để 1.000 sinh viên khác nhau (`SV0001`..`SV1000`) đều đủ điều kiện đăng ký hợp lệ.

```powershell
# 1. Làm sạch dữ liệu giao dịch cũ và nạp lại chế độ loadtest (LHP001 = 1000 chỗ)
& "..\.venv\Scripts\python.exe" -m scripts.reset_lab --confirm-lab-reset --clear-sessions --reseed loadtest

# 2. Sinh trước 1.000 access_token ra tệp ../exports/loadtest_tokens.json (đã gitignore)
# Giúp kịch bản đo tải /register không bị cộng dồn thời gian băm Argon2id của /auth/login
& "..\.venv\Scripts\python.exe" -m scripts.prepare_tokens --count 1000

# 3. Giữa các lượt bắn tải: làm sạch registrations/idempotency nhưng giữ nguyên sessions token đã tạo
& "..\.venv\Scripts\python.exe" -m scripts.reset_lab --confirm-lab-reset --reseed loadtest

# 4. Quay lại bộ dữ liệu mẫu 3 lớp (LHP001..LHP003) để chạy giao diện thông thường
& "..\.venv\Scripts\python.exe" -m scripts.reset_lab --confirm-lab-reset --clear-sessions --reseed ui
```

> **Hành vi của `scripts.reset_lab` đối với Redis**:
> - Khi `QUEUE_ENABLED=false` và không truyền `--reset-redis`: script không yêu cầu Redis phải chạy và báo rõ phần Redis được bỏ qua (`exit code 0`).
> - Khi `QUEUE_ENABLED=true` hoặc truyền `--reset-redis`: script chỉ xóa các key thuộc phạm vi `dkhp:queue:*` và `dkhp:rl:*` (không bao giờ gọi `FLUSHALL`). Nếu PostgreSQL đã xử lý xong nhưng Redis lỗi kết nối, script báo rõ `"reset chưa hoàn tất: PostgreSQL đã xử lý, Redis chưa xử lý"` và trả mã thoát `3`.

### 12.3. Xuất OpenAPI JSON & Các Mẫu Phản hồi Chuẩn
Để xuất đặc tả OpenAPI và các tệp JSON mẫu (được kiểm tra qua Pydantic schemas) ra thư mục `outputs/api_examples/` (đã được cấu hình trong `.gitignore`):

```powershell
& "..\.venv\Scripts\python.exe" -m scripts.export_openapi_and_examples
```

### 12.4. Sao lưu Nóng & Phục hồi Kiểm chứng (`pg_dump` / `pg_restore`)
Quy trình sao lưu snapshot nhất quán và khôi phục kiểm chứng sang một database độc lập (`dkhp_restore_verify` — không ghi đè lên database `dkhp_dev` đang chạy):

#### Cách A — Chạy qua Docker Compose (Khuyến nghị khi chạy bằng Docker Desktop)

**Thư mục làm việc**: thư mục gốc dự án (`D:\Code\DangKyHocPhanTrucTuyen`)

```powershell
# 1. SAO LƯU: Chạy pg_dump bên trong container postgres để tạo file dkhp_snapshot.dump và lấy ra thư mục dự án
docker exec backend-dkhp-postgres-1 pg_dump -U dkhp_user -d dkhp_dev --format=custom --no-owner --no-privileges -f /tmp/dkhp_snapshot.dump
docker cp backend-dkhp-postgres-1:/tmp/dkhp_snapshot.dump ./dkhp_snapshot.dump

# 2. KHÔI PHỤC: Tạo database kiểm chứng độc lập (dkhp_restore_verify) và chạy pg_restore đưa dữ liệu vào đó
docker exec backend-dkhp-postgres-1 psql -U dkhp_user -d postgres -c "DROP DATABASE IF EXISTS dkhp_restore_verify;"
docker exec backend-dkhp-postgres-1 psql -U dkhp_user -d postgres -c "CREATE DATABASE dkhp_restore_verify;"
docker exec backend-dkhp-postgres-1 pg_restore -U dkhp_user -d dkhp_restore_verify --no-owner --no-privileges /tmp/dkhp_snapshot.dump

# 3. KIỂM TRA: Chạy check_invariants.py để đối soát 5 bất biến toàn vẹn trên database vừa khôi phục
docker exec backend-dkhp-api-1 python -m scripts.check_invariants --database-url "postgresql://dkhp_user:dkhp_dev_pass@postgres:5432/dkhp_restore_verify"
```

#### Cách B — Chạy trực tiếp trên Windows (Khi máy đã cài sẵn bộ công cụ PostgreSQL 16 Client vào PATH)

**Thư mục làm việc**: `D:\Code\DangKyHocPhanTrucTuyen\backend`

```powershell
# Khai báo các biến kết nối
$env:DATABASE_URL = "postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_dev"
$env:ADMIN_DATABASE_URL = "postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/postgres"
$env:RESTORE_DATABASE_URL = "postgresql://dkhp_user:dkhp_dev_pass@localhost:5432/dkhp_restore_verify"

# 1. Sao lưu nóng ở định dạng custom của PostgreSQL 16
pg_dump --format=custom --no-owner --no-privileges --file="dkhp_snapshot.dump" "$env:DATABASE_URL"

# 2. Tạo database kiểm chứng độc lập và khôi phục vào đó
psql "$env:ADMIN_DATABASE_URL" -c 'DROP DATABASE IF EXISTS "dkhp_restore_verify";'
psql "$env:ADMIN_DATABASE_URL" -c 'CREATE DATABASE "dkhp_restore_verify";'
pg_restore --no-owner --no-privileges --dbname="$env:RESTORE_DATABASE_URL" "dkhp_snapshot.dump"

# 3. Đối soát toàn vẹn dữ liệu trên database vừa khôi phục
& "..\.venv\Scripts\python.exe" -m scripts.check_invariants --database-url "$env:RESTORE_DATABASE_URL"
```

---

## 13. Kiểm thử Tự động & Kiểm tra Mã nguồn

Bộ kiểm thử tự động sử dụng **PostgreSQL 16 thật** (mặc định tự khởi tạo máy chủ PostgreSQL 16 cô lập qua `pgserver`, hoặc kết nối tới PostgreSQL 16 bên ngoài khi đặt `PYTEST_USE_EXTERNAL_DB=true` kèm `TEST_DATABASE_URL`). Bộ kiểm thử **không tác động** tới database đang dùng trong `DATABASE_URL`.

**Thư mục làm việc**: `DangKyHocPhanTrucTuyen\backend`

```powershell
# 1. Kiểm tra chuẩn mã nguồn với Ruff
& "..\.venv\Scripts\ruff.exe" check app scripts tests

# 2. Chạy nhanh nhóm kiểm thử đơn vị (Unit) và hợp đồng HTTP/OpenAPI (Contract)
& "..\.venv\Scripts\pytest.exe" tests/unit tests/contract -v

# 3. Chạy nhóm kiểm thử tích hợp nghiệp vụ & CLI trên PostgreSQL 16
& "..\.venv\Scripts\pytest.exe" tests/integration -v

# 4. Chạy nhóm kiểm thử tranh chấp đồng thời (khởi chạy 2 tiến trình Uvicorn workers thật)
& "..\.venv\Scripts\pytest.exe" tests/concurrency -v

# 5. Chạy toàn bộ 34 bài kiểm thử
& "..\.venv\Scripts\pytest.exe" -v
```

---

## 14. Xử lý Lỗi Thường gặp (Troubleshooting)

1. **Lỗi kết nối CSDL (`OperationalError: connection failed` hoặc `503 SERVICE_UNAVAILABLE` tại `/api/v1/health`)**:
   - Kiểm tra container `postgres` (`docker compose -f compose.dev.yml ps`) hoặc cửa sổ chạy `python -m scripts.local_pg` đã bật chưa, và chuỗi `DATABASE_URL` trong `backend\.env` có khớp cổng/mật khẩu thực tế không.
2. **Đăng nhập báo `401 INVALID_CREDENTIALS` với `SV0001` hoặc danh sách lớp học phần trống**:
   - Bạn mới chạy `python -m scripts.migrate` để tạo bảng nhưng chưa chạy `python -m scripts.seed --mode ui` để nạp tài khoản và lớp học phần mẫu.
3. **Ứng dụng Frontend gọi API bị trình duyệt chặn CORS**:
   - Kiểm tra chính xác `Origin` trên thanh địa chỉ trình duyệt (ví dụ `http://localhost:3000` hoặc IP LAN `http://192.168.1.25:5173`), bổ sung vào biến `CORS_ALLOWED_ORIGINS` trong `.env` (phân tách bằng dấu phẩy, không có dấu `/` ở cuối) rồi khởi động lại Uvicorn.
4. **Gọi `POST /register`, `POST /payments` hoặc `DELETE /registrations/{id}` nhận `400 VALIDATION_ERROR` tại trường `Idempotency-Key`**:
   - Ba API này bắt buộc có header `Idempotency-Key` đúng định dạng **UUID v4** (ví dụ `crypto.randomUUID()` trong JavaScript hoặc `[guid]::NewGuid().ToString()` trong PowerShell).
   - Nếu tái sử dụng một `Idempotency-Key` cũ cho một lớp khác hoặc thao tác khác, API sẽ trả `422 IDEMPOTENCY_KEY_REUSED`.
5. **Gọi `DELETE /api/v1/registrations/{registration_id}` nhận `400 VALIDATION_ERROR`**:
   - Theo quy ước kiểm tra chặt tại `ContractRoute`, phương thức `DELETE` không nhận request body. Hãy đảm bảo client không gửi kèm body JSON khi gọi `DELETE`.
6. **Chạy lại kịch bản đo tải thấy phản hồi trả về kèm header `Idempotent-Replayed: true` mà sĩ số không giảm**:
   - Do chưa chạy `python -m scripts.reset_lab --confirm-lab-reset --reseed loadtest` giữa hai lượt đo tải hoặc kịch bản đang gửi lặp lại cùng một `Idempotency-Key` cũ.
7. **Lỗi hiển thị tiếng Việt trong cửa sổ PowerShell**:
   - Chạy lệnh `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` trước khi gọi `Invoke-RestMethod`.

---

← Quay lại tài liệu tổng quan dự án: [../README.md](../README.md)

