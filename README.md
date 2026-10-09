# Smart PPE Monitoring System - Backend Microservices

> **Đề tài Đồ án Tốt nghiệp:** Hệ thống Giám sát An toàn Lao động Thông minh (Smart PPE Monitoring System)  
> **Kiến trúc:** Microservices & Event-Driven Architecture (Chuẩn Tài liệu Đặc tả D08)  
> **Công nghệ lõi:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Redis, Apache Kafka, Traefik API Gateway, Docker.

---

## Mục Lục

- [Giới Thiệu Tổng Quan](#giới-thiệu-tổng-quan)
- [Kiến Trúc Hệ Thống (Architecture Overview)](#kiến-trúc-hệ-thống-architecture-overview)
  - [Các Microservices Domain](#các-microservices-domain)
- [Tính Năng Nổi Bật](#tính-năng-nổi-bật)
- [Công Nghệ Sử Dụng (Tech Stack)](#công-nghệ-sử-dụng-tech-stack)
- [Hướng Dẫn Cài Đặt & Chạy Dự Án](#hướng-dẫn-cài-đặt--chạy-dự-án)
  - [1. Yêu cầu môi trường](#1-yêu-cầu-môi-trường)
  - [2. Cài đặt dependencies](#2-cài-đặt-dependencies)
  - [3. Cấu hình biến môi trường](#3-cấu-hình-biến-môi-trường)
  - [4. Khởi tạo Cơ sở Dữ liệu & Prisma Clients](#4-khởi-tạo-cơ-sở-dữ-liệu--prisma-clients)
- [Tài Khoản Đăng Nhập Mặc Định](#tài-khoản-đăng-nhập-mặc-định)
- [Danh Mục Lệnh Khởi Chạy (Scripts)](#danh-mục-lệnh-khởi-chạy-scripts)
- [Tài Liệu API Trực Quan (Swagger UI)](#tài-liệu-api-trực-quan-swagger-ui)
- [Bản Quyền & Giấy Phép](#bản-quyền--giấy-phép)

---

## Giới Thiệu Tổng Quan

**Smart PPE Monitoring System** là nền tảng backend phân tán phục vụ giám sát việc chấp hành trang thiết bị bảo hộ lao động cá nhân (mũ bảo hộ, áo phản quang, vùng hạn chế nguy hiểm) tại các công trường xây dựng và nhà máy công nghiệp theo thời gian thực.

Hệ thống được thiết kế theo kiến trúc **Microservices (Database-per-Service)** kết hợp mô hình **Event-Driven Backbone**, đảm bảo tính độc lập dữ liệu, khả năng chịu tải cao, chống nghẽn I/O khi tiếp nhận hàng nghìn luồng camera AI đồng thời và kiểm soát an toàn bảo mật nghiêm ngặt.

---

## Kiến Trúc Hệ Thống (Architecture Overview)

```text
                               ┌──────────────────────────────────────────────────────────┐
                               │                 Client Applications                     │
                               │   (Web Dashboard Giám sát, Mobile App, Alert Widgets)    │
                               └────────────────────────────┬─────────────────────────────┘
                                                            │ HTTP / WebSocket (Port 80/443)
                                                            ▼
                               ┌──────────────────────────────────────────────────────────┐
                               │             Traefik API Gateway (Port 80/8080)           │
                               │    - Dynamic Routing & Prefix Stripping                  │
                               │    - Distributed Tracing (X-Request-Id: UUIDv7)          │
                               │    - Security Headers Injection (Helmet standard)        │
                               └────────────┬─────────────┬─────────────┬─────────────────┘
                                            │             │             │
                    ┌───────────────────────┼─────────────┴─────────────┼───────────────────────┐
                    ▼                       ▼                           ▼                       ▼
       ┌─────────────────────────┐┌───────────────────┐    ┌─────────────────────────┐┌───────────────────┐
       │ Identity & RBAC Service ││ Site Service      │    │ Camera Service          ││ Incident Service  │
       │ Port: 8888 (RS256 JWKS) ││ Port: 8891        │    │ Port: 8892              ││ Port: 8893        │
       └────────────┬────────────┘└─────────┬─────────┘    └────────────┬────────────┘└─────────┬─────────┘
                    │                       │                           │                       │
                    ▼                       ▼                           ▼                       ▼
            [(ppe_identity_db)]     [(ppe_site_db)]             [(ppe_camera_db)]       [(ppe_incident_db)]
                    │                       │                           │                       │
                    └───────────────────────┼───────────────────────────┼───────────────────────┘
                                            │ Publish/Subscribe Events  │
                                            ▼                           ▼
                               ┌──────────────────────────────────────────────────────────┐
                               │               Apache Kafka / Redis Event Bus             │
                               │     - ppe.violation.detected (Snapshot & Metadata)       │
                               │     - ppe.incident.status_changed                        │
                               │     - ppe.auth.revocation_event (Blacklist Cache)        │
                               └────────────┬───────────────────────────┬─────────────────┘
                                            │                           │
                                            ▼                           ▼
                               ┌─────────────────────────┐ ┌─────────────────────────┐
                               │  Notification Service   │ │   Reporting Service     │
                               │  Port: 8894             │ │   Port: 8895            │
                               └────────────┬────────────┘ └────────────┬────────────┘
                                            ▼                           ▼
                                [(ppe_notification_db)]     [(ppe_reporting_db)]
```

### Các Microservices Domain

1. **Identity & RBAC Service (`:8888`)**:
   - Quản lý tài khoản, hồ sơ người dùng, phiên làm việc (`UserDevice`).
   - Xác thực bất đối xứng **Asymmetric JWT (RS256)**, cung cấp public key qua endpoint chuẩn **RFC 7517 JWKS** (`/.well-known/jwks.json`).
   - Phân quyền động (Dynamic RBAC) theo ma trận `User -> Role -> RolePermission -> Permission`.
   - Bảo vệ 2FA TOTP (RFC 6238), Google OAuth2, Account Lockout (ASVS).
2. **Site Management Service (`:8891`)**:
   - Quản trị danh mục công trường (`/api/v1/sites`), phân khu thi công (`/api/v1/zones`).
   - Cấu hình vùng hạn chế nguy hiểm (`/api/v1/restricted-areas`) với tọa độ đa giác (Polygon Boundary).
   - Tùy biến ngưỡng phát hiện an toàn cho từng công trường (`SiteSafetyConfig`: confidence threshold, confirmation time, cooldown).
3. **Camera Management Service (`:8892`)**:
   - Quản trị danh sách camera, vị trí lắp đặt, liên kết Zone/Site.
   - Quản lý luồng RTSP/HLS stream, trạng thái kết nối và ping kiểm tra tình trạng camera.
4. **Incident & Review Service (`:8893`)**:
   - Tiếp nhận sự cố vi phạm từ AI Worker (`ppe.violation.detected`).
   - Quản lý bằng chứng (Snapshot/Clip URL), phân công và quy trình xử lý vi phạm: **True Violation** hoặc **False Alarm**.
5. **Notification Service (`:8894`)**:
   - Tiếp nhận sự kiện vi phạm thời gian thực để gửi cảnh báo qua WebSocket/SSE tới Web Dashboard.
   - Hàng đợi email cảnh báo (BullMQ / Nodemailer) kèm cơ chế đa kênh dự phòng.
6. **Reporting & Analytics Service (`:8895`)**:
   - CQRS Read-Model: Tổng hợp thống kê sự cố vi phạm theo công trường, thời gian và loại thiết bị bảo hộ.
   - Tính toán tỷ lệ cảnh báo sai (False Alert Rate), đánh giá hiệu quả an toàn và xuất báo cáo PDF/Excel.
7. **Media & Storage Service (`:8890`)**:
   - Lưu trữ hình ảnh snapshot, video bằng chứng và avatar người dùng trên Cloudflare R2 / MinIO S3 qua Presigned URLs.

---

## Tính Năng Nổi Bật

- **Kiến trúc phân tầng 5 lớp chuẩn mực**:
  $$\text{Route} \longrightarrow \text{Validation (Zod)} \longrightarrow \text{Controller} \longrightarrow \text{Service} \longrightarrow \text{Repository} \longrightarrow \text{Prisma ORM}$$
- **Phân quyền phân tán không phụ thuộc mạng (Decentralized Auth)**: Các service độc lập xác thực chữ ký RS256 offline qua JWKS cache mà không phát sinh thêm HTTP call sang Identity Service (0.01ms latency).
- **Phân quyền động không hard-code (Dynamic RBAC)**: Quản lý quyền cấp hạt nhân (`requirePermission('PPE_*')`), hỗ trợ định nghĩa các vai trò mới linh hoạt mà không cần sửa code.
- **Khóa chính định hướng thời gian UUIDv7**: Toàn bộ bảng CSDL sử dụng `uuid_generate_v7()` (RFC 9562) tối ưu hóa cấu trúc chỉ mục B-Tree và hiệu năng truy vấn.
- **Khả năng quan sát & Truy vết phân tán (Distributed Tracing)**: Middleware `requestIdMiddleware` tự sinh và chuyển tiếp header `X-Request-Id` (UUIDv7) qua toàn bộ chuỗi microservices.
- **Tài liệu API tự động**: 100% Swagger UI tại `/api/docs` sinh tự động từ Zod Schema qua `@asteasolutions/zod-to-openapi`.

---

## Công Nghệ Sử Dụng (Tech Stack)

| Thành phần               | Công nghệ                                                           |
| :----------------------- | :------------------------------------------------------------------ |
| **Runtime & Ngôn ngữ**   | Node.js (>= 20.x), TypeScript 5.9 (Strict Mode)                     |
| **Web Framework**        | Express 4                                                           |
| **Cơ sở dữ liệu**        | PostgreSQL 16 (6 Logical Databases)                                 |
| **ORM & Query Builder**  | Prisma ORM 5.22                                                     |
| **Cache & Invalidation** | Redis 7 (In-memory TTL + Pub/Sub Cache Invalidation)                |
| **Event Streaming**      | Apache Kafka (Event Bus vi phạm & cảnh báo)                         |
| **Message Queue**        | BullMQ (Hàng đợi gửi email & tác vụ định kỳ)                        |
| **Xác thực & Bảo mật**   | Asymmetric JWT (RS256), BcryptJS, Helmet, CORS, Rate Limit RFC 6585 |
| **Xác thực dữ liệu**     | Zod (Validate tại biên HTTP)                                        |
| **Tài liệu API**         | Swagger UI Express + Zod-to-OpenAPI                                 |
| **Package Manager**      | `pnpm` (`pnpm@9.15.0`)                                              |

---

## Hướng Dẫn Cài Đặt & Chạy Dự Án

### 1. Yêu cầu môi trường

- **Node.js**: Phiên bản `>= 20.0.0`
- **pnpm**: `npm install -g pnpm`
- **PostgreSQL**: Cài đặt cục bộ (cổng 5433 hoặc 5432) hoặc qua Docker
- **Redis**: Cục bộ (cổng 6379) hoặc Cloud Redis

### 2. Cài đặt dependencies

```bash
pnpm install
```

### 3. Cấu hình biến môi trường

Sao chép file mẫu và cấu hình thông số kết nối:

```bash
cp .env.example .env
```

Kiểm tra các chuỗi kết nối trong file `.env`:

- `IDENTITY_DATABASE_URL`: `postgresql://.../ppe_identity_db`
- `SITE_DATABASE_URL`: `postgresql://.../ppe_site_db`
- `CAMERA_DATABASE_URL`: `postgresql://.../ppe_camera_db`
- `INCIDENT_DATABASE_URL`: `postgresql://.../ppe_incident_db`
- `NOTIFICATION_DATABASE_URL`: `postgresql://.../ppe_notification_db`
- `REPORTING_DATABASE_URL`: `postgresql://.../ppe_reporting_db`

### 4. Khởi tạo Cơ sở Dữ liệu & Prisma Clients

```bash
# 1. Sinh toàn bộ Prisma Clients cho 6 microservices
pnpm run prisma:generate:all

# 2. Áp dụng Database Migrations cho các microservices
pnpm run db:migrate:identity
pnpm run db:migrate:site

# 3. Nạp dữ liệu khởi tạo (Permissions, Roles, Người dùng chuẩn PPE)
pnpm run db:seed
```

---

## Tài Khoản Đăng Nhập Mặc Định

Dữ liệu seed ban đầu (`prisma/seed.ts`) tạo sẵn các tài khoản chuẩn cho buổi bảo vệ đồ án và kiểm thử:

| Email               | Mật khẩu         | Vai trò (Role)     | Phạm vi & Trách nhiệm                                                                         |
| :------------------ | :--------------- | :----------------- | :-------------------------------------------------------------------------------------------- |
| `admin@ppe.local`   | `Admin@123456`   | **ADMIN**          | Quản trị viên tối cao: Toàn quyền cấu hình hệ thống, quản lý người dùng, phân quyền RBAC.     |
| `manager@ppe.local` | `Manager@123456` | **SAFETY_MANAGER** | Quản lý an toàn: Quản trị công trường, phân khu, cấu hình ngưỡng AI, camera và xem báo cáo.   |
| `officer@ppe.local` | `Officer@123456` | **SAFETY_OFFICER** | Cán bộ an toàn trực ban: Giám sát luồng cảnh báo vi phạm, duyệt True/False Alarm, đóng sự cố. |

_(Hệ thống đồng thời duy trì các tài khoản cũ `admin@template.local`, `manager@template.local`, `user@template.local` để đảm bảo tương thích ngược)._

---

## Danh Mục Lệnh Khởi Chạy (Scripts)

### Khởi chạy môi trường phát triển (Development):

```bash
# Chạy Monolith Gateway / API chính (:8888)
pnpm dev

# Chạy riêng lẻ từng Microservice độc lập:
pnpm run dev:site          # Site Management Service (:8891)
pnpm run dev:notification  # Notification Service (:8894)
pnpm run dev:media         # Media Service (:8890)
pnpm run dev:worker        # Background Worker Service
```

### Kiểm thử, Biên dịch & Triển khai:

```bash
# Chạy bộ kiểm thử tự động (Unit & Integration tests)
pnpm test

# Chạy kiểm thử riêng cho các module PPE:
pnpm exec tsx --test tests/ppe-auth-rbac-be03.test.ts tests/site-service.test.ts

# Biên dịch TypeScript sang JavaScript (dist/)
pnpm build

# Chạy server production từ bản build
pnpm start
pnpm run start:site

# Kiểm tra cú pháp (Lint) và định dạng code (Format)
pnpm run lint
pnpm run format
```

---

## Tài Liệu API Trực Quan (Swagger UI)

Khi server đang hoạt động, tài liệu API được sinh tự động theo chuẩn OpenAPI 3.0 tại:

- **Swagger UI URL:** [http://localhost:8888/api/docs](http://localhost:8888/api/docs)
- **OpenAPI JSON Spec:** [http://localhost:8888/api/docs.json](http://localhost:8888/api/docs.json)
- **JWKS Endpoint:** [http://localhost:8888/.well-known/jwks.json](http://localhost:8888/.well-known/jwks.json)
- **Security Disclosure:** [http://localhost:8888/.well-known/security.txt](http://localhost:8888/.well-known/security.txt)
- **Health & Readiness Check:** [http://localhost:8888/api/v1/health/readiness](http://localhost:8888/api/v1/health/readiness)

---

## Bản Quyền & Giấy Phép

Đồ án Tốt nghiệp chuyên ngành Kỹ thuật Phần mềm / Công nghệ Thông tin.  
Được phát triển và duy trì bởi nhóm tác giả Đề tài Smart PPE Monitoring Microservices.
