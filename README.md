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
| **Người vận hành** | Khởi tạo môi trường Docker Compose, chạy migration/seed dữ liệu mẫu (3.000 sinh viên), bật/tắt SSO Keycloak và hàng đợi Redis |

> **Lưu ý:** Chức năng thanh toán trong dự án là mô phỏng nội bộ (`SIMULATED`) trên PostgreSQL để phục vụ nghiệp vụ khóa hủy lớp sau khi đóng học phí, chưa kết nối ngân hàng hoặc cổng thanh toán thật.

---

## 2. Công nghệ sử dụng

| Thành phần | Công nghệ |
|---|---|
| **Frontend** | React 19, TypeScript / JSX, Vite 8, React Router v7, Axios, Tailwind CSS v4, Lucide React, Recharts |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, Argon2id (`argon2-cffi`), PyJWT (`crypto`) |
| **Cơ sở dữ liệu** | PostgreSQL 16, `psycopg` v3 + `psycopg_pool` (SQL thuần + khóa bi quan `SELECT ... FOR UPDATE`) |
| **Xác thực & SSO (tùy chọn)** | Opaque Session Token (SHA-256), Keycloak 26 (OIDC Authorization Code + PKCE S256) |
| **Hàng đợi & Rate Limit (tùy chọn)** | Redis 7 (Waiting Room Queue & Rate Limiting) |
| **Hạ tầng triển khai** | Docker, Docker Compose |

---

## 3. Cấu trúc thư mục

```text
DangKyHocPhanTrucTuyen/
├── frontend/                     # Giao diện người dùng (React + TypeScript + Vite)
│   ├── public/                   # Tài nguyên tĩnh & file CSV mẫu kiểm thử tải
│   ├── src/
│   │   ├── assets/               # Logo PTIT và ảnh QR minh họa
│   │   ├── components/           # Layout chung, thẻ thông tin, modal đăng ký & biểu đồ
│   │   ├── pages/                # Các trang: auth/, student/, admin/
│   │   ├── routes/               # Định tuyến & bảo vệ route theo vai trò (STUDENT/ADMIN)
│   │   ├── services/             # Axios client & các service gọi API Backend (/api/v1/*)
│   │   ├── types/                # Khai báo kiểu TypeScript bổ trợ
│   │   └── utils/                # Tiện ích sinh Idempotency-Key (UUIDv4) & xử lý CSV
│   ├── .env.example              # Mẫu cấu hình biến môi trường Frontend
│   ├── index.html                # Trang HTML gốc
│   ├── package.json              # Khai báo dependencies và scripts Frontend
│   ├── tsconfig.json             # Cấu hình TypeScript
│   ├── vite.config.ts            # Cấu hình Vite bundler
│   └── README.md                 # Tài liệu chi tiết Frontend
├── backend/                      # Máy chủ API & xử lý nghiệp vụ (FastAPI + PostgreSQL)
│   ├── app/                      # Mã nguồn chính (api, core, db, repositories, schemas, services)
│   ├── migrations/               # Các file SQL khởi tạo bảng, ràng buộc và chỉ mục
│   ├── scripts/                  # Công cụ CLI: migrate, seed, reset_state, verify_invariants
│   ├── .env.example              # Mẫu cấu hình biến môi trường Backend
│   ├── Dockerfile                # Cấu hình đóng gói container Backend API
│   ├── pyproject.toml            # Cấu hình dự án Python
│   ├── requirements.lock         # Danh sách thư viện Python đã khóa phiên bản
│   └── README.md                 # Tài liệu chi tiết Backend
├── infra/
│   └── keycloak/
│       └── dkhp-realm.json       # Cấu hình realm mẫu tự động nạp cho Keycloak
├── compose.dev.yml               # Cấu hình Docker Compose (PostgreSQL, Migrate, API, Redis, Keycloak)
├── .gitignore
└── README.md                     # Tài liệu tổng quan và hướng dẫn tích hợp toàn hệ thống
```

---

## 4. Cách cài đặt

### Yêu cầu hệ thống

- **Docker Desktop** (khuyến nghị để chạy PostgreSQL 16, Backend API, Redis và Keycloak).
- **Node.js** `>= 20.x` và **npm** `>= 10.x` (để chạy Frontend).
- **Python** `3.11` hoặc `3.12` (nếu muốn chạy Backend trực tiếp trên máy thay vì Docker).

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
| **Sinh viên** (đủ điều kiện tiên quyết `CS101`) | `SV0001` .. `SV1500` | `Demo@123456` | Đăng ký được cả `LHP001`, `LHP002`, `LHP003` |
| **Sinh viên** (chưa có môn tiên quyết `CS101`) | `SV1501` .. `SV3000` | `Demo@123456` | Dùng để kiểm thử chặn môn tiên quyết ở `LHP001` |
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
     OIDC_CLIENT_SECRET=dev-only-keycloak-secret-override-in-env
     ```
   - Khởi động dịch vụ Keycloak và cập nhật container `api`:
     ```powershell
     docker compose -f compose.dev.yml --profile sso up -d
     ```
   - Khi nhấn nút đăng nhập SSO trên trang `/login`, trình duyệt sẽ chuyển hướng qua `/api/v1/auth/sso/login` -> Keycloak (`http://localhost:8081`) -> `/api/v1/auth/sso/callback` -> `http://localhost:5173/sso/callback` và tự động đổi `exchange_code` một lần lấy phiên đăng nhập.

---

## 9. Cách kiểm tra kết nối

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

Kết quả mong đợi:
- `/api/v1/health` trả về `status: "ok"`, `code: "HEALTH_OK"`, `data.database: "UP"`.
- CORS Preflight trả về `StatusCode: 204` kèm header `Access-Control-Allow-Origin: http://localhost:5173`.

---

## 10. Các lỗi thường gặp & Cách khắc phục

| Hiện tượng / Thông báo lỗi | Nguyên nhân | Cách khắc phục |
|---|---|---|
| `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` | Docker Desktop chưa được bật hoặc engine chưa khởi động xong. | Mở ứng dụng **Docker Desktop**, đợi biểu tượng chuyển sang trạng thái *Engine running* rồi chạy lại lệnh `docker compose`. |
| Giao diện báo `Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.` (`ERR_NETWORK`) | Container `api` chưa chạy tại cổng `8080` hoặc sai `VITE_API_BASE_URL` hoặc bị chặn CORS. | Kiểm tra `docker compose -f compose.dev.yml ps`, đảm bảo `VITE_API_BASE_URL=http://localhost:8080/api` trong `frontend/.env` và `CORS_ALLOWED_ORIGINS` chứa `http://localhost:5173`. |
| Đăng nhập tài khoản `AD0001` báo `Tài khoản không chính xác...` | Đang để tab vai trò là **Sinh viên** khi nhập mã `AD0001` (hoặc ngược lại). | Chuyển công tắc vai trò trên đầu form đăng nhập sang **Quản trị viên** trước khi đăng nhập bằng `AD0001`. |
| Đăng nhập tài khoản `SV0001` báo sai mật khẩu | Cơ sở dữ liệu chưa được chạy lệnh `seed`. | Chạy `docker compose -f compose.dev.yml exec api python -m scripts.seed --mode ui` để nạp tài khoản mẫu. |
| Sinh viên không chọn được lớp `LHP001` hoặc lớp bị khóa chọn | Sinh viên thuộc nhóm `SV1501..SV3000` (chưa hoàn thành môn tiên quyết `CS101`) hoặc lớp `LHP002` trùng lịch Thứ 2 tiết 2–3 với `LHP001` đang chọn. | Dùng tài khoản `SV0001..SV1500` để đăng ký `LHP001`, hoặc bỏ chọn lớp trùng lịch trước khi chọn lớp khác. |
| Không thể hủy lớp học phần (`409 ALREADY_PAID`) | Lớp học phần đã được thanh toán học phí mô phỏng (`PAID`). | Theo quy tắc nghiệp vụ, học phần đã thanh toán không thể hủy trực tiếp trên cổng sinh viên. |
| Nhấn nút SSO báo `Chức năng đăng nhập SSO chưa được bật trên môi trường này.` (`503 SERVICE_UNAVAILABLE`) | Mặc định `SSO_ENABLED=false` để ưu tiên đăng nhập nội bộ và kiểm thử tải. | Đặt `SSO_ENABLED=true` trong `.env` và chạy `docker compose -f compose.dev.yml --profile sso up -d`. |

---

## 11. Tài liệu chi tiết từng phân hệ

- **Tài liệu Backend:** [backend/README.md](backend/README.md)
- **Tài liệu Frontend:** [frontend/README.md](frontend/README.md)
