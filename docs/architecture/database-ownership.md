# Database Ownership Matrix & Data Isolation Rules

> **Phiên bản:** 1.0.0  
> **Ngày lập:** 12/10/2026  
> **Nguyên tắc cốt lõi:** Database-per-Service. Mỗi Microservice sở hữu độc quyền logical database và schema của mình. Không cho phép service A truy vấn trực tiếp bảng của service B qua SQL/Prisma Client. Không sử dụng Foreign Key xuyên database.

---

## 1. Database Ownership Matrix

| Microservice | Logical Database | Database User | Tables & Entities Owned | Allowed Access | Cơ chế truy cập dữ liệu bên ngoài |
|---|---|---|---|---|---|
| **Identity & Access Service** (`app-api`, `app-worker`) | `ppe_identity_db` | `ppe_identity_user` | `users`, `roles`, `permissions`, `role_permissions`, `sessions`, `refresh_tokens`, `verification_tokens`, `password_reset_tokens`, `audit_logs`, `system_configs`, `maintenance_configs`, `api_keys`, `webhook_subscriptions`, `webhook_deliveries`, `file_records`, `outbox_messages` | Độc quyền sở hữu toàn bộ bảng liên quan đến Auth, RBAC, System Settings, Integration, Webhook & Audit. | Không truy vấn trực tiếp database khác. Nhận số liệu báo cáo qua Outbox/EventBus. |
| **Site Management Service** (`site-service`) | `ppe_site_db` | `ppe_site_user` | `sites`, `zones`, `site_safety_configs`, `restricted_areas` | Độc quyền sở hữu danh mục công trường, khu vực hạn chế và quy chuẩn an toàn cấp công trường. | Dữ liệu camera thuộc `camera-service`, AI Model thuộc `reporting-service`. Truy cập qua Internal HTTP API hoặc EventBus. |
| **Camera Management Service** (`camera-service`) | `ppe_camera_db` | `ppe_camera_user` | `cameras`, `camera_configs`, `camera_streams`, `camera_events` | Độc quyền sở hữu danh mục camera giám sát, cấu hình stream RTSP/HLS và thông số override cấp camera. | Nhận thông tin siteId, zoneId dạng String (UUID) không có FK vật lý. Xác thực site qua API nếu cần. |
| **Incident Management Service** (`incident-service`) | `ppe_incident_db` | `ppe_incident_user` | `incidents`, `evidences`, `evidence_metadata`, `incident_assignments`, `incident_status_history`, `incident_comments`, `evidence_access_logs` | Độc quyền sở hữu vòng đời sự cố vi phạm PPE, bằng chứng hình ảnh/video, nhật ký xử lý và bằng chứng số. | Lưu `siteId`, `cameraId`, `violationId` dạng UUID độc lập. Phát sự cố qua EventBus `ppe.incident.created`. |
| **Notification Service** (`notification-service`) | `ppe_notification_db` | `ppe_notification_user` | `notifications`, `notification_templates`, `notification_preferences`, `notification_logs`, `email_notifications` | Độc quyền sở hữu hòm thư thông báo người dùng, mẫu thông báo, cấu hình kênh nhận tin, nhật ký gửi tin và hàng đợi email. | Lắng nghe sự cố từ EventBus. Tra cứu thông tin người nhận qua Identity Token Claims hoặc Identity Internal API. |
| **Reporting & Analytics Service** (`reporting-service`) | `ppe_reporting_db` | `ppe_reporting_user` | `daily_compliance_reports`, `ai_models`, `ai_model_versions`, `camera_health_logs`, `safety_incident_summaries`, `audit_summary_logs`, `export_jobs` | Độc quyền sở hữu báo cáo tuân thủ an toàn lao động, phiên bản thuật toán AI Vision, lịch sử xuất báo cáo. | Tiêu thụ event bất đồng bộ từ EventBus để cập nhật read models thống kê. |

---

## 2. Quy tắc Phân lập Dữ liệu (Isolation Rules)

1. **Phân quyền người dùng PostgreSQL:**
   - Script khởi tạo `scripts/init-multiple-dbs.sql` thực hiện `REVOKE CONNECT ON DATABASE <db_name> FROM PUBLIC;` và chỉ `GRANT CONNECT` cho duy nhất user sở hữu database đó.
   - User `ppe_site_user` không thể kết nối `ppe_camera_db` hay bất kỳ database nào khác.
2. **Không có Foreign Key xuyên Service:**
   - Các bảng trong `ppe_incident_db` (`incidents`) lưu `site_id`, `camera_id` dưới dạng trường `Uuid` độc lập, không khai báo `@relation` hay foreign key vật lý sang `ppe_site_db` hay `ppe_camera_db`.
3. **Liên kết dữ liệu phân tán (Data Federation):**
   - Khi cần hiển thị tên Site và mã Camera trong danh sách Sự cố (Incident List), Client/Frontend gọi qua API Gateway tổng hợp (BFF) hoặc Incident Service lưu read-model projection (denormalized data: `siteName`, `cameraCode`) được cập nhật qua sự kiện.
4. **Không chia sẻ Database Connection String:**
   - Trong `docker-compose.yml`, mỗi service container chỉ nhận biến môi trường của database mà nó sở hữu.
   - Ví dụ: `site-service` chỉ nhận `SITE_DATABASE_URL`, không nhận `IDENTITY_DATABASE_URL` hay `CAMERA_DATABASE_URL`.

---

## 3. Các Vi phạm Database-per-Service Cần Khắc phục

### Vi phạm 1: `src/modules/safety-rule/safety-rule.repository.ts`
- **Thực trạng:** 
  - Khởi tạo đồng thời `sitePrisma`, `cameraPrisma`, `reportingPrisma`, và `rbacRepository` (`identityPrisma`).
  - Truy vấn bảng `cameras`, `camera_configs` trong `ppe_camera_db`.
  - Truy vấn bảng `ai_model_versions` trong `ppe_reporting_db`.
  - Ghi vào bảng `audit_logs` trong `ppe_identity_db`.
- **Phương án giải quyết:**
  - Bảng `site_safety_configs` và `restricted_areas` thuộc sở hữu chính chủ của `ppe_site_db`.
  - Thao tác lấy camera config override chuyển thành gọi HTTP sang `camera-service` (`GET /api/v1/cameras/:id/config`) với timeout 3s và circuit breaker/fallback.
  - Thao tác lấy deployed AI model version chuyển thành gọi HTTP sang `reporting-service` (`GET /api/v1/reporting/models/active`) với timeout 3s và fallback.
  - Audit log chuyển thành xuất bản event lên Redis EventBus hoặc ghi vào cơ chế log nội bộ.

### Vi phạm 2: `src/modules/notification/notification.repository.ts`
- **Thực trạng:**
  - Import `prisma as identityPrisma` để thực thi `identityPrisma.auditLog.create` khi quản lý mẫu thông báo (`notification_templates`).
- **Phương án giải quyết:**
  - `notification-service` sở hữu bảng `notification_logs` trong `ppe_notification_db`.
  - Ghi nhận lịch sử quản lý template vào bảng nội bộ hoặc phát event `notification.template_modified` để Identity/Audit Service tiếp nhận.

### Vi phạm 3: `src/modules/cron/cron.repository.ts`
- **Thực trạng:**
  - Gọi trực tiếp `notificationPrisma.notification.count` và `notificationPrisma.emailNotification.count` trong `getActivityStats()`.
- **Phương án giải quyết:**
  - Cho phép `getActivityStats` xử lý an toàn (graceful fallback = 0) khi không có `notificationPrisma`.
  - Trong tương lai, tiến trình Cron thu thập số liệu thông qua HTTP Health/Stats endpoint do `notification-service` công bố.

---

## 4. Kế hoạch Di chuyển và Đồng bộ Dữ liệu

1. **Prisma Schemas & Migrations:**
   - Cả 6 schema đã được cấu trúc thành công trong thư mục `prisma/`:
     - `prisma/identity/schema.prisma`
     - `prisma/site/schema.prisma`
     - `prisma/camera/schema.prisma`
     - `prisma/incident/schema.prisma`
     - `prisma/notification/schema.prisma`
     - `prisma/reporting/schema.prisma`
   - Mỗi schema có output generated client độc lập trong `node_modules/@prisma/client-<service>`.
2. **Quản lý Migration:**
   - Sử dụng script điều phối `scripts/prisma-service.js <service> migrate dev --name <migration_name>` để đảm bảo migration của từng database được sinh ra và theo dõi độc lập.
