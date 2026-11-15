# Hệ thống Đăng ký Học phần Trực tuyến

Dự án xây dựng hệ thống hỗ trợ sinh viên tra cứu, đăng ký, quản lý học phần và theo dõi học phí trên nền tảng web. Quản trị viên có thể quản lý các lớp học phần, điều chỉnh sĩ số, kiểm soát trạng thái mở đăng ký và theo dõi số liệu kiểm thử tải.

Hệ thống tập trung giải quyết bài toán nhiều sinh viên cùng đăng ký vào các lớp có số chỗ giới hạn, bảo đảm dữ liệu được cập nhật nhất quán khi có yêu cầu đồng thời hoặc yêu cầu gửi lại (Idempotency).

---

## 1. Giới thiệu dự án

### Mục tiêu dự án

- Cung cấp giao diện trực quan cho sinh viên và quản trị viên.
- Hỗ trợ tra cứu lớp học phần, lịch học và điều kiện tiên quyết.
- Bảo đảm số lượng đăng ký không vượt quá sức chứa của lớp (`enrolled_count <= capacity`).
- Ngăn đăng ký trùng môn, trùng lớp và kiểm tra xung đột lịch học.
- Duy trì sự nhất quán giữa đăng ký, hủy đăng ký và thanh toán học phí mô phỏng.
- Hỗ trợ điều tiết truy cập bằng hàng đợi ảo (Waiting Room) và đăng nhập một lần (SSO Keycloak OIDC + PKCE S256).

### Đối tượng sử dụng & Chức năng chính

| Đối tượng | Chức năng chính |
|---|---|
| **Sinh viên** (`STUDENT`) | Đăng nhập (mật khẩu hoặc SSO), xem tổng quan học tập & học phí, tìm kiếm/lọc lớp học phần, tham gia hàng đợi (nếu bật), đăng ký nhiều lớp học phần, hủy đăng ký, xem danh sách học phần của tôi, thanh toán học phí mô phỏng |
| **Quản trị viên** (`ADMIN`) | Đăng nhập quản trị, xem thống kê tổng quan hệ thống và trạng thái dịch vụ (`/api/v1/health`), tạo mới lớp học phần, chỉnh sửa sức chứa & đóng/mở lớp học phần, xuất cấu hình kiểm thử tải JSON và nhập/phân tích kết quả kiểm thử CSV |
| **Người vận hành** | Khởi tạo môi trường Docker Compose, chạy migration/seed dữ liệu mẫu (3.000 sinh viên), chạy kiểm thử nghiệm thu (`KT1–KT3`), đo tải `k6`, bật/tắt SSO Keycloak và hàng đợi Redis |

> **Lưu ý:** Chức năng thanh toán trong dự án là mô phỏng nội bộ (`SIMULATED`) trên PostgreSQL để phục vụ nghiệp vụ khóa hủy lớp sau khi đóng học phí, chưa kết nối ngân hàng hoặc cổng thanh toán thật.

---

## 2. Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| **Frontend** | React 19, TypeScript / JSX, Vite 8, React Router v7, Axios, Tailwind CSS v4, Lucide React, Recharts |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, Argon2id (`argon2-cffi`), PyJWT (`crypto`) |
| **Cơ sở dữ liệu** | PostgreSQL 16, `psycopg` v3 + `psycopg_pool` (SQL thuần + khóa bi quan `SELECT ... FOR UPDATE`) |
| **Kiểm thử & Đo tải** | Grafana k6 (`grafana/k6`), Pytest, Python Async HTTPX Benchmark Runner |
| **Xác thực & SSO (tùy chọn)** | Opaque Session Token (SHA-256), Keycloak 26 (OIDC Authorization Code + PKCE S256) |
| **Hàng đợi & Rate Limit (tùy chọn)** | Redis 7 (Waiting Room Queue & Rate Limiting) |
| **Hạ tầng triển khai** | Docker, Docker Compose |

---

## 3. Cấu trúc thư mục

```text
DangKyHocPhanTrucTuyen/
├── frontend/                           # Giao diện người dùng (React + TypeScript + Vite)
│   ├── public/                         # Tài nguyên tĩnh & file CSV mẫu kiểm thử tải
│   ├── src/
│   │   ├── assets/                     # Logo PTIT và ảnh QR minh họa
│   │   ├── components/                 # Layout chung, thẻ thông tin, modal đăng ký & biểu đồ
│   │   ├── pages/                      # Các trang: auth/, student/, admin/
│   │   ├── routes/                     # Định tuyến & bảo vệ route theo vai trò (STUDENT/ADMIN)
│   │   ├── services/                   # Axios client & các service gọi API Backend (/api/v1/*)
│   │   ├── types/                      # Khai báo kiểu TypeScript bổ trợ
│   │   └── utils/                      # Tiện ích sinh Idempotency-Key (UUIDv4) & xử lý CSV
│   ├── .env.example                    # Mẫu cấu hình biến môi trường Frontend
│   ├── kt1_kt2_kt3_results.csv         # Kết quả CSV của 3 kịch bản nghiệm thu KT1, KT2, KT3
│   ├── sample-load-test-results.csv    # Kết quả CSV đo tải 7 mức (10 -> 3000 VUs)
│   ├── index.html                      # Trang HTML gốc
│   ├── package.json                    # Khai báo dependencies và scripts Frontend
│   ├── tsconfig.json                   # Cấu hình TypeScript
│   ├── vite.config.ts                  # Cấu hình Vite bundler
│   └── README.md                       # Tài liệu chi tiết Frontend
├── backend/                            # Máy chủ API & xử lý nghiệp vụ (FastAPI + PostgreSQL)
│   ├── app/                            # Mã nguồn chính (api, core, db, repositories, schemas, services)
│   ├── migrations/                     # Các file SQL khởi tạo bảng, ràng buộc và chỉ mục
│   ├── scripts/                        # Công cụ CLI: migrate, seed, reset_lab, prepare_tokens,
│   │                                   # check_invariants, run_loadtest_csv, run_kt1_kt2_kt3
│   ├── .env.example                    # Mẫu cấu hình biến môi trường Backend
│   ├── Dockerfile                      # Cấu hình đóng gói container Backend API
│   ├── pyproject.toml                  # Cấu hình dự án Python
│   ├── requirements.lock               # Danh sách thư viện Python đã khóa phiên bản
│   └── README.md                       # Tài liệu chi tiết Backend
├── infra/
│   ├── k6/
│   │   └── register_loadtest.js        # Kịch bản đo tải Grafana k6 cho POST /api/v1/register
│   └── keycloak/
│       └── dkhp-realm.json             # Cấu hình realm mẫu tự động nạp cho Keycloak
├── compose.dev.yml                     # Cấu hình Docker Compose (PostgreSQL, Migrate, API, Redis, Keycloak)
├── run_k6_loadtest.ps1                 # Script PowerShell tự động chạy đo tải k6 & xuất CSV
├── .gitignore
└── README.md                           # Tài liệu tổng quan và hướng dẫn tích hợp toàn hệ thống
```

---

## 4. Cách cài đặt

### Yêu cầu hệ thống

- **Docker Desktop** (khuyến nghị để chạy PostgreSQL 16, Backend API, Redis, Keycloak và k6).
- **Node.js** `>= 20.x` và **npm** `>= 10.x` (để chạy Frontend).
- **Python** `3.11` hoặc `3.12` (nếu muốn chạy Backend hoặc các script đo tải trực tiếp trên máy).

### Bước 1: Chuẩn bị biến môi trường Backend & Docker Compose

Tại thư mục gốc `D:\Code\DangKyHocPhanTrucTuyen`:

```powershell
Copy-Item "backend\.env.example" ".env"
Copy-Item "backend\.env.example" "backend\.env"
```

> Nếu các file `.env` và `backend/.env` đã tồn tại, giữ nguyên cấu hình hiện có (không cần ghi đè).

### Bước 2: Chuẩn bị biến môi trường và cài đặt thư viện Frontend

```powershell
Set-Location "frontend"
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env" }
npm install
Set-Location ".."
```

Giá trị mặc định trong `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8080/api
VITE_SSO_AUTH_URL=http://localhost:8080/api/v1/auth/sso/login
VITE_SSO_CALLBACK_URL=http://localhost:5173/sso/callback
```

---

## 5. Cách chạy Docker Compose

Mở **Docker Desktop**, sau đó mở PowerShell tại thư mục gốc `D:\Code\DangKyHocPhanTrucTuyen`:

### Chế độ tiêu chuẩn (PostgreSQL 16 + Migration + Backend API)

```powershell
# 1. Khởi chạy PostgreSQL, chạy migration tự động và bật API ở cổng 8080
docker compose -f compose.dev.yml up -d --build

# 2. Nạp dữ liệu mẫu cho giao diện (3.000 sinh viên SV0001..SV3000, AD0001 và 3 lớp LHP001..LHP003)
docker compose -f compose.dev.yml exec api python -m scripts.seed --mode ui

# 3. Kiểm tra trạng thái các container
docker compose -f compose.dev.yml ps
```

### Chế độ đầy đủ (Bật thêm Redis Queue và Keycloak SSO)

```powershell
docker compose -f compose.dev.yml --profile full up -d --build
```

---

## 6. Cách chạy Backend (Trực tiếp bằng Python không qua container API)

Nếu chỉ dùng Docker cho PostgreSQL (`docker compose -f compose.dev.yml up -d postgres`) và muốn chạy Backend trực tiếp trên máy:

```powershell
Set-Location "backend"
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.lock
pip install -e .

# Chạy migration và nạp dữ liệu mẫu
python -m scripts.migrate
python -m scripts.seed --mode ui

# Khởi chạy máy chủ FastAPI tại cổng 8080
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

Xem thêm chi tiết các lệnh quản trị dữ liệu tại [backend/README.md](backend/README.md).

---

## 7. Cách chạy Frontend

Mở một cửa sổ PowerShell tại thư mục `frontend`:

```powershell
Set-Location "frontend"
npm run dev
```

- Giao diện phát triển chạy tại: **`http://localhost:5173`**
- Kiểm tra kiểu TypeScript và đóng gói bản production:

```powershell
npm run build
npm run lint
```

### Tài khoản dữ liệu mẫu để đăng nhập trên giao diện

Sau khi chạy `python -m scripts.seed --mode ui`:

| Vai trò | Mã đăng nhập | Mật khẩu | Ghi chú |
|---|---|---|---|
| **Sinh viên** (đủ điều kiện tiên quyết `CS101`) | `SV0001` | `Demo@123456` | Đăng ký được cả `LHP001`, `LHP002`, `LHP003` |
| **Sinh viên** (chưa có môn tiên quyết `CS101`) | `SV0002` .. `SV3000` | `Demo@123456` | Dùng để kiểm thử chặn môn tiên quyết ở `LHP001` |
| **Quản trị viên** | `AD0001` | `Demo@123456` | Chọn tab **Quản trị viên** ở màn hình đăng nhập |

---

## 8. Cách cấu hình Keycloak (SSO OIDC + PKCE S256)

Dự án đã tích hợp sẵn luồng đăng nhập SSO theo chuẩn **OIDC Authorization Code + PKCE S256**:

1. File cấu hình realm mẫu nằm tại `infra/keycloak/dkhp-realm.json`:
   - **Realm:** `dkhp`
   - **Client ID:** `dkhp-backend`
   - **Client Secret (môi trường dev):** `dev-only-keycloak-secret-override-in-env`
   - **Valid Redirect URIs:** `http://localhost:8080/api/v1/auth/sso/callback`
   - **Web Origins:** `http://localhost:5173`, `http://127.0.0.1:5173`
   - **Tài khoản Keycloak mẫu:** `sv0001` / `Demo@123456` (ánh xạ với sinh viên `SV0001` qua `sub = 11111111-2222-3333-4444-555555550001`).

2. Để bật tính năng đăng nhập SSO:
   - Trong file `.env` (và `backend/.env`), cập nhật:
     ```env
     SSO_ENABLED=true
     OIDC_TOKEN_ENDPOINT=http://keycloak:8080/realms/dkhp/protocol/openid-connect/token
     OIDC_JWKS_URI=http://keycloak:8080/realms/dkhp/protocol/openid-connect/certs
     OIDC_CLIENT_ID=dkhp-backend
     OIDC_CLIENT_SECRET=dev-only-keycloak-secret-override-in-env
     ```
   - Khởi động dịch vụ Keycloak và cập nhật container `api`:
     ```powershell
     docker compose -f compose.dev.yml --profile sso up -d
     ```
   - Khi nhấn nút đăng nhập SSO trên trang `/login`, trình duyệt sẽ chuyển hướng qua `/api/v1/auth/sso/login` -> Keycloak (`http://localhost:8081`) -> `/api/v1/auth/sso/callback` -> `http://localhost:5173/sso/callback` và tự động đổi `exchange_code` một lần lấy phiên đăng nhập.

---

## 9. Kiểm thử Nghiệm thu, Đo tải (k6) & Luồng Kiểm thử Hệ thống

### 9.1. Tại sao sử dụng Grafana k6 để kiểm thử tải (Load Testing)?

Hệ thống lựa chọn **Grafana k6** ([infra/k6/register_loadtest.js](infra/k6/register_loadtest.js)) kết hợp với script điều phối để đo tải thay vì bắn tải trực tiếp từ trình duyệt web vì 4 lý do kỹ thuật cốt lõi:

1. **Vượt qua giới hạn kết nối của trình duyệt:** Trình duyệt thông thường giới hạn tối đa khoảng 6 kết nối đồng thời trên cùng một domain (`localhost:8080`), không thể giả lập hàng trăm hay hàng nghìn sinh viên cùng bấm nút Đăng ký tại cùng một mili-giây.
2. **Hiệu năng cao, tiêu tốn ít RAM/CPU (Runtime bằng Go):** `k6` được viết bằng ngôn ngữ Go, sử dụng cơ chế goroutines nhẹ thay vì tạo hàng nghìn luồng OS nặng nề, giúp một máy tính cá nhân dễ dàng giả lập từ `10` đến `3.000` người dùng ảo (`VUs` — Virtual Users) đồng thời.
3. **Tách biệt chi phí đăng nhập nhờ `SharedArray`:** Trong thực tế, sinh viên đã đăng nhập từ trước rồi mới chờ đến giờ bấm nút đăng ký. `k6` hỗ trợ nạp sẵn 3.000 `access_token` (`exports/loadtest_tokens.json`) vào vùng nhớ dùng chung `SharedArray`, giúp đo **thuần túy năng lực xử lý tranh chấp khóa tại `POST /api/v1/register`** mà không bị nhiễu bởi thời gian băm mật khẩu Argon2id của bước login.
4. **Đo lường chính xác các phân vị độ trễ (`Avg`, `P95`, `P99`, `RPS`):** Tự động thống kê độ trễ phân vị thứ 95 (`P95`), thứ 99 (`P99`), số request/giây (`RPS`) và xuất thẳng ra định dạng CSV để hiển thị biểu đồ trên trang Quản trị (`/admin/testing`).

---

### 9.2. Luồng Kiểm thử & Đo tải Toàn trình (Testing Workflow)

Mỗi đợt kiểm thử tranh chỗ hoặc đo tải đều đi qua **5 giai đoạn khép kín** để đảm bảo tính khách quan và kiểm chứng được tính toàn vẹn dữ liệu trong PostgreSQL:

```text
[1. Reset & Seed Loadtest]  -->  Làm sạch bảng giao dịch, mở lớp mục tiêu (LHP001 / LHP999)
            │
            ▼
[2. Prepare 3.000 Tokens]   -->  Cấp sẵn 3.000 phiên (SV0001..SV3000) trong bảng sessions
            │
            ▼
[3. Bắn tải POST /register] -->  k6 / Async Runner gửi đồng thời kèm Bearer Token & Idempotency-Key
            │                    Backend khóa dòng (SELECT ... FOR UPDATE), kiểm tra điều kiện,
            │                    trừ remaining_seats = remaining_seats - 1 & ghi bảng registrations
            ▼
[4. Đối soát Invariants]    -->  Kiểm tra SQL: remaining_seats + COUNT(ACTIVE) == capacity,
            │                    không vượt sĩ số (remaining_seats >= 0), không trùng ACTIVE
            ▼
[5. Xuất CSV & Vẽ Biểu đồ]  -->  Ghi file CSV -> Nhập lên trang /admin/testing?tab=results
```

**Chi tiết những gì diễn ra bên trong Backend ở Bước 3 đối với mỗi request `POST /api/v1/register`:**
1. Xác thực `Authorization: Bearer <access_token>` qua bảng `sessions` và đối chiếu `student_id` trong body.
2. Kiểm tra `Idempotency-Key` (dùng `pg_advisory_xact_lock` theo cặp `(user_id, key)`) để chống xử lý trùng khi mạng lỗi hoặc sinh viên bấm đúp.
3. Khóa bi quan dòng lớp học phần (`SELECT ... FOR UPDATE` trên bảng `course_classes`) để buộc mọi giao dịch đăng ký cùng một lớp phải xếp hàng tuần tự.
4. Kiểm tra trạng thái lớp (`OPEN`), số chỗ còn lại (`remaining_seats > 0`), môn tiên quyết, trùng học phần và xung đột lịch học.
5. Giảm `remaining_seats` đi `1`, thêm bản ghi `ACTIVE` vào `registrations`, lưu kết quả vào `idempotency_records` và `COMMIT`.

---

### 9.3. Cách chạy 5 kịch bản kiểm thử tính đúng đắn (`KT1`, `KT2`, `KT3`, `KT4`, `KT5`)

Dự án cung cấp sẵn script [backend/scripts/run_kt1_kt2_kt3.py](backend/scripts/run_kt1_kt2_kt3.py) để kiểm chứng trực tiếp 5 kịch bản nghiệm thu cốt lõi của nghiệp vụ đăng ký học phần:

| Mã kịch bản | Nội dung kiểm thử | Kỳ vọng nghiệm thu |
|---|---|---|
| **KT1** | Một sinh viên hợp lệ (`SV0001`) đăng ký khi lớp còn chỗ (`50` chỗ) | Thêm đúng `1` đăng ký (`active = 1`), giảm đúng `1` chỗ (`remaining_seats = 49`) |
| **KT2** | Nhiều sinh viên (`50` SV: `SV0001..SV0050`) gửi đồng thời để tranh **1 chỗ cuối cùng** (`capacity = 1, remaining_seats = 1`) | Chỉ thêm đúng `1` đăng ký (`1` nhận `200 REGISTERED`, `49` nhận `409 CLASS_FULL`), không vượt chỉ tiêu (`remaining_seats = 0`) |
| **KT3** | Cùng một sinh viên (`SV0001`) gửi lặp cùng yêu cầu (`Idempotency-Key` giống nhau) và gửi đồng thời nhiều yêu cầu (`50` request) | Không tạo đăng ký trùng (`active = 1`), không giảm thêm chỗ (`remaining_seats = 49`) |
| **KT4** | Kiểm tra chặn trùng lịch học: `20` sinh viên (`SV0001..SV0020`) đang học lớp `LHP998` (*Thứ 2, tiết 1–3*) gửi đồng thời yêu cầu đăng ký vào lớp `LHP997` (*Thứ 2, tiết 2–4*, còn `50` chỗ) | Chặn 100% với mã lỗi `409 SCHEDULE_CONFLICT` (`20/20` request), không tạo đăng ký mới (`active = 0`), giữ nguyên số chỗ trống (`remaining_seats = 50`) |
| **KT5** | **Hủy học phần hoàn chỗ & Tranh chỗ vừa nhả ra**: Lớp đã đầy (`10/10`, `remaining_seats = 0`), `SV0001` gọi `DELETE /api/v1/registrations/{id}` hủy nhả ra `1` chỗ trống -> ngay lập tức `30` sinh viên bên ngoài (`SV0011..SV0040`) đua `POST /api/v1/register` tranh chỗ đó | `SV0001` nhận `200 REGISTRATION_CANCELLED` (+1 chỗ), chỉ đúng `1/30` SV mới lấy được chỗ (`200 REGISTERED`), `29` SV nhận `409 CLASS_FULL`, tổng sĩ số giữ chuẩn `10/10` (`remaining_seats = 0`) |

**Lệnh chạy tại thư mục gốc `D:\Code\DangKyHocPhanTrucTuyen`:**

```powershell
$env:PYTHONUTF8="1"; py -3.11 backend/scripts/run_kt1_kt2_kt3.py
```

- Kết quả được in chi tiết ra Terminal và tự động xuất ra file **[frontend/kt1_kt2_kt3_results.csv](frontend/kt1_kt2_kt3_results.csv)**.
- Để tùy chỉnh số lượng sinh viên ở `KT2`, `KT4`, `KT5`:
  ```powershell
  $env:PYTHONUTF8="1"; py -3.11 backend/scripts/run_kt1_kt2_kt3.py --competing-students 1000 --conflict-students 50 --regrab-students 100
  ```

---

### 9.4. Cách chạy đo tải đa mức (`10`, `50`, `100`, `500`, `1000`, `2000`, `3000` user)

#### Cách A: Chạy bằng Grafana k6 (Tự động qua PowerShell + Docker `grafana/k6`)

Script [run_k6_loadtest.ps1](run_k6_loadtest.ps1) tự động chuẩn bị 3.000 token, gọi `k6` (nếu máy chưa cài `k6` sẽ tự động chạy qua container `grafana/k6:latest`), đối soát `check_invariants` sau mỗi mức tải, xuất kết quả ra [frontend/sample-load-test-results.csv](frontend/sample-load-test-results.csv) và khôi phục lại dữ liệu mẫu UI khi hoàn tất:

```powershell
# Chạy 3 mức tải chuẩn (10, 50, 100 VUs)
.\run_k6_loadtest.ps1 -VuLevels 10,50,100

# Hoặc chạy toàn bộ 7 mức tải (10, 50, 100, 500, 1000, 2000, 3000 VUs)
.\run_k6_loadtest.ps1
```

#### Cách B: Chạy bằng Python Async Load Runner (Không cần tải thêm image k6)

```powershell
$env:PYTHONUTF8="1"; py -3.11 backend/scripts/run_loadtest_csv.py
```

- Mặc định chạy đủ 7 mức: **`10, 50, 100, 500, 1000, 2000, 3000` VUs** với 3.000 tài khoản thật (`SV0001..SV3000`).
- Tự động ghi kết quả vào **[frontend/sample-load-test-results.csv](frontend/sample-load-test-results.csv)**.
- Nếu muốn test kịch bản giới hạn chỗ (ví dụ lớp chỉ có `500` chỗ nhưng bắn tới `3000` user):
  ```powershell
  $env:PYTHONUTF8="1"; py -3.11 backend/scripts/run_loadtest_csv.py --capacity 500
  ```

#### Cách C: Chạy trực tiếp trên Giao diện Web & Xem biểu đồ ngay lập tức (Khuyên dùng)

Không cần mở Terminal để gõ lệnh, bạn có thể bấm chạy và xem kết quả trực tiếp ngay trên trang quản trị:

1. Đăng nhập tài khoản Quản trị viên (`AD0001` / `Demo@123456`) tại `http://localhost:5173/login`.
2. Mở mục **Trung tâm kiểm thử** (`http://localhost:5173/admin/testing`).
3. Tại tab **"Chạy kiểm thử trực tiếp"**, bạn có 2 bảng điều khiển:
   - **Bảng 1 – Chạy Đo Tải Đa Mức / Tùy Chỉnh (`POST /api/v1/register`):**
     - Chọn nhanh các preset (`Nhanh 10, 50, 100 VUs`, `5 mức 10..1000 VUs`, `Đầy đủ 7 mức 10..3000 VUs`, hoặc `2000 SV tranh 1000 chỗ`), hoặc tự nhập danh sách VUs và sức chứa lớp (`Capacity`).
     - Bấm nút **"▶ Chạy đo tải ngay"**.
   - **Bảng 2 – Chạy 4 Kịch Bản Nghiệm Thu (`KT1 · KT2 · KT3 · KT4`):**
     - Tùy chỉnh số lượng sinh viên tranh chỗ cuối (`KT2`), số request gửi lặp (`KT3`), số sinh viên trùng lịch (`KT4`).
     - Bấm nút **"Chạy kiểm thử KT1 – KT4 ngay"**.
4. Ngay khi chạy xong, giao diện sẽ **tự động hiển thị ngay bên dưới**:
   - **Biểu đồ đường trực quan** (chọn chỉ số *Average response time (ms)*, *P95 (ms)*, *P99 (ms)*, *RPS*, *Tổng request*, *Request thành công/thất bại*).
   - **8 thẻ thống kê tổng quan** & thanh tỷ lệ Thành công / Bị chặn (`409`).
   - **Bảng số liệu chi tiết** từng mức tải / kịch bản (kèm nút **Xuất CSV**).
   - **Nhật ký thực thi & đối soát Database (Invariants)** (`PASS`/`FAIL`, `remaining_seats`, `active_registrations`).
5. Ngoài ra, ở tab **"Kết quả & Nhập CSV"** (`http://localhost:5173/admin/testing?tab=results`), bạn vẫn có thể bấm **"Nhập CSV"** để mở lại các tệp `sample-load-test-results.csv` hoặc `kt1_kt2_kt3_results.csv` bất kỳ lúc nào.

---

## 10. Cách kiểm tra kết nối

### Bảng địa chỉ các dịch vụ

| Dịch vụ | Địa chỉ |
|---|---|
| **Frontend (Vite Dev Server)** | `http://localhost:5173` |
| **Backend API Base URL** | `http://localhost:8080/api/v1` |
| **Swagger UI (Tài liệu API)** | `http://localhost:8080/docs` |
| **Healthcheck Endpoint** | `http://localhost:8080/api/v1/health` |
| **Keycloak Admin / OIDC** (khi bật profile `sso`) | `http://localhost:8081` |

### Kiểm tra nhanh bằng PowerShell

```powershell
# 1. Kiểm tra Healthcheck của Backend & kết nối PostgreSQL
Invoke-RestMethod -Uri "http://localhost:8080/api/v1/health"

# 2. Kiểm tra CORS Preflight từ Origin của Frontend (http://localhost:5173)
Invoke-WebRequest -Method OPTIONS -Uri "http://localhost:8080/api/v1/auth/login" `
  -Headers @{
    "Origin" = "http://localhost:5173"
    "Access-Control-Request-Method" = "POST"
    "Access-Control-Request-Headers" = "Authorization, Content-Type"
  } | Select-Object StatusCode, Headers
```

---

## 11. Các lỗi thường gặp & Cách khắc phục

| Hiện tượng / Thông báo lỗi | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | Docker Desktop chưa được bật hoặc engine chưa khởi động xong. | Mở ứng dụng **Docker Desktop**, đợi biểu tượng chuyển sang trạng thái *Engine running* rồi chạy lại lệnh `docker compose`. |
| Giao diện báo `Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.` (`ERR_NETWORK`) | Container `api` chưa chạy tại cổng `8080` hoặc sai `VITE_API_BASE_URL` hoặc bị chặn CORS. | Kiểm tra `docker compose -f compose.dev.yml ps`, đảm bảo `VITE_API_BASE_URL=http://localhost:8080/api` trong `frontend/.env` và `CORS_ALLOWED_ORIGINS` chứa `http://localhost:5173`. |
| Đăng nhập tài khoản `AD0001` báo `Tài khoản không chính xác...` | Đang để tab vai trò là **Sinh viên** khi nhập mã `AD0001` (hoặc ngược lại). | Chuyển công tắc vai trò trên đầu form đăng nhập sang **Quản trị viên** trước khi đăng nhập bằng `AD0001`. |
| Đăng nhập tài khoản `SV0001` báo sai mật khẩu | Cơ sở dữ liệu chưa được chạy lệnh `seed`. | Chạy `docker compose -f compose.dev.yml exec api python -m scripts.seed --mode ui` để nạp tài khoản mẫu. |
| Sinh viên không chọn được lớp `LHP001` hoặc lớp bị khóa chọn | Sinh viên thuộc nhóm `SV0002..SV3000` (chưa hoàn thành môn tiên quyết `CS101`) hoặc lớp `LHP002` trùng lịch Thứ 2 tiết 2–3 với `LHP001` đang chọn. | Dùng tài khoản `SV0001` để đăng ký `LHP001`, hoặc bỏ chọn lớp trùng lịch trước khi chọn lớp khác. |
| Nhấn nút SSO báo `Chức năng đăng nhập SSO chưa được bật trên môi trường này.` (`503 SERVICE_UNAVAILABLE`) | Mặc định `SSO_ENABLED=false` để ưu tiên đăng nhập nội bộ và kiểm thử tải. | Đặt `SSO_ENABLED=true` trong `.env` theo hướng dẫn ở Mục 8 và chạy `docker compose -f compose.dev.yml --profile sso up -d`. |

---

## 12. Tài liệu chi tiết từng phân hệ

- **Tài liệu Backend:** [backend/README.md](backend/README.md)
- **Tài liệu Frontend:** [frontend/README.md](frontend/README.md)
