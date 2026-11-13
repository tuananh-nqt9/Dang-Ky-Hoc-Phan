# Hệ thống Đăng ký Học phần Trực tuyến

Dự án xây dựng hệ thống hỗ trợ sinh viên tra cứu, đăng ký và quản lý học phần trên nền tảng web. Quản trị viên có thể quản lý các lớp học phần, điều chỉnh sĩ số và kiểm soát trạng thái mở đăng ký.

Hệ thống tập trung giải quyết bài toán nhiều sinh viên cùng đăng ký vào các lớp có số chỗ giới hạn, bảo đảm dữ liệu được cập nhật nhất quán khi có yêu cầu đồng thời hoặc yêu cầu gửi lại.

## 1. Mục tiêu dự án

- Cung cấp giao diện thuận tiện cho sinh viên và quản trị viên.
- Hỗ trợ tra cứu lớp học phần, lịch học và điều kiện đăng ký.
- Bảo đảm số lượng đăng ký không vượt quá sức chứa của lớp.
- Ngăn đăng ký trùng và kiểm tra xung đột lịch học.
- Duy trì sự nhất quán giữa đăng ký, hủy đăng ký và thanh toán mô phỏng.
- Xây dựng cơ sở để đánh giá hiệu năng và đề xuất giải pháp điều tiết truy cập trong giờ cao điểm.

Bài toán hướng đến quy mô dữ liệu 3.000 sinh viên. Khả năng phục vụ người dùng đồng thời cần được đánh giá bằng các lượt đo tải thực tế trên cấu hình triển khai cụ thể.

## 2. Đối tượng sử dụng

| Đối tượng | Nhu cầu sử dụng |
|---|---|
| Sinh viên | Tra cứu lớp, đăng ký và hủy học phần, xem kết quả đăng ký |
| Quản trị viên | Quản lý thông tin lớp, sĩ số và trạng thái mở đăng ký |
| Người vận hành | Khởi tạo môi trường, theo dõi dịch vụ và kiểm tra dữ liệu |

## 3. Chức năng chính

### Dành cho sinh viên

- Đăng nhập và quản lý phiên sử dụng.
- Tìm kiếm, xem danh sách và thông tin lớp học phần.
- Xem lịch học, số chỗ còn lại và điều kiện tiên quyết.
- Đăng ký học phần và nhận kết quả xử lý.
- Hủy đăng ký và tra cứu danh sách học phần đã đăng ký.
- Thanh toán học phí mô phỏng thông qua chức năng backend cung cấp.

### Dành cho quản trị viên

- Tạo và cập nhật lớp học phần theo các quy tắc nghiệp vụ.
- Điều chỉnh sức chứa phù hợp với số lượng đăng ký hiện có.
- Mở hoặc đóng việc tiếp nhận đăng ký của lớp.

### Các cơ chế hỗ trợ

- Phân quyền truy cập theo vai trò.
- Kiểm tra môn tiên quyết và trùng lịch.
- Kiểm soát đồng thời khi nhiều người tranh chỗ.
- Xử lý yêu cầu gửi lại để hạn chế tác động nghiệp vụ trùng lặp.
- Hỗ trợ hàng đợi truy cập và đăng nhập một lần theo cấu hình.

Danh sách trên mô tả phạm vi chức năng của hệ thống. Các màn hình và mức độ tích hợp frontend sẽ được cập nhật khi mã nguồn giao diện được bổ sung vào repository.

> Thanh toán trong dự án là mô phỏng nội bộ, chưa kết nối ngân hàng hoặc cổng thanh toán thật.

## 4. Tổng quan kiến trúc

Hệ thống được tổ chức thành các thành phần:

| Thành phần | Vai trò |
|---|---|
| Frontend | Hiển thị giao diện, tiếp nhận thao tác và gửi yêu cầu tới backend |
| Backend | Xác thực, phân quyền, kiểm tra điều kiện và xử lý nghiệp vụ |
| PostgreSQL | Lưu trữ dữ liệu và bảo đảm tính nhất quán của các giao dịch |
| Redis — tùy chọn | Hỗ trợ hàng đợi và điều tiết truy cập |
| Keycloak — tùy chọn | Cung cấp đăng nhập một lần |
| Docker Compose | Khởi tạo và quản lý các dịch vụ trong môi trường phát triển |

Luồng xử lý bắt đầu từ thao tác trên giao diện. Backend tiếp nhận yêu cầu, kiểm tra quyền và điều kiện nghiệp vụ, cập nhật cơ sở dữ liệu rồi trả kết quả để frontend hiển thị.

Quyết định cấp chỗ được thực hiện ở backend và cơ sở dữ liệu. Số chỗ hiển thị trên giao diện có thể thay đổi khi các sinh viên khác cùng đăng ký.

## 5. Công nghệ sử dụng

| Nhóm | Công nghệ |
|---|---|
| Backend | Python, FastAPI, Uvicorn, Pydantic |
| Cơ sở dữ liệu | PostgreSQL, Psycopg |
| Thành phần tùy chọn | Redis, Keycloak |
| Môi trường triển khai | Docker, Docker Compose |
| Frontend | Thông tin công nghệ được cập nhật cùng mã nguồn giao diện |

## 6. Cấu trúc thư mục

```text
DangKyHocPhanTrucTuyen/
├── frontend/                 # Vị trí dự kiến cho mã nguồn giao diện
├── backend/
│   ├── app/                  # Mã nguồn backend
│   ├── migrations/           # Khởi tạo và cập nhật cơ sở dữ liệu
│   ├── scripts/              # Công cụ khởi tạo dữ liệu và vận hành
│   ├── .env.example          # Mẫu cấu hình môi trường
│   ├── Dockerfile            # Cấu hình image backend
│   ├── pyproject.toml        # Cấu hình dự án Python
│   ├── requirements.lock     # Dependencies đã khóa phiên bản
│   └── README.md             # Hướng dẫn backend chi tiết
├── infra/
│   └── keycloak/             # Cấu hình Keycloak
├── compose.dev.yml           # Cấu hình dịch vụ Docker
├── .gitignore
└── README.md                 # Tài liệu tổng quan toàn dự án
```

## 7. Hướng dẫn khởi chạy

### Backend và cơ sở dữ liệu

Chuẩn bị cấu hình môi trường theo [hướng dẫn backend](backend/README.md).

Nếu sử dụng Docker, mở Docker Desktop và chạy tại thư mục gốc dự án:

```powershell
docker compose -f compose.dev.yml up -d --build
```

Kiểm tra trạng thái dịch vụ:

```powershell
docker compose -f compose.dev.yml ps
```

Các bước khởi tạo dữ liệu, cấu hình thành phần tùy chọn và cách chạy trực tiếp bằng Python được trình bày trong `backend/README.md`.

### Frontend

Hướng dẫn cài đặt, cấu hình kết nối API và khởi chạy giao diện sẽ được bổ sung tại mục này khi mã nguồn frontend được đưa vào repository.

Khi tích hợp, địa chỉ API phía frontend phải khớp với backend; cấu hình CORS phía backend phải cho phép địa chỉ giao diện đang sử dụng.

## 8. Địa chỉ dịch vụ

Với cấu hình backend mặc định:

| Tài nguyên | Địa chỉ |
|---|---|
| Backend API | `http://localhost:8080/api/v1` |
| Swagger UI | `http://localhost:8080/docs` |
| OpenAPI JSON | `http://localhost:8080/openapi.json` |
| Healthcheck | `http://localhost:8080/api/v1/health` |

Các địa chỉ `localhost` sử dụng trên máy đang chạy dịch vụ. Địa chỉ giao diện sẽ được cập nhật cùng cấu hình frontend.

## 9. Quy trình phát triển

- `main`: lưu phiên bản chung của dự án.
- `feat/backend`: phát triển backend và cơ sở dữ liệu.
- `feat/frontend`: phát triển giao diện và kết nối API.

Các thay đổi được kiểm tra trên nhánh chức năng trước khi mở Pull Request để hợp nhất vào `main`.

Không đưa mật khẩu, token, file `.env` thật, môi trường ảo hoặc dữ liệu phát sinh cục bộ lên repository.

## 10. Tài liệu backend

Xem [backend/README.md](backend/README.md) để biết chi tiết về cài đặt, cấu hình, API, dữ liệu mẫu và công cụ vận hành.
