# Monolith-to-Microservices Migration Backlog

> **Phiên bản:** 1.0.0  
> **Ngày lập:** 12/10/2026  
> **Mục tiêu:** Quản lý danh mục các vấn đề kiến trúc, vi phạm ranh giới service và sự cố tương thích microservices được phát hiện trong đợt audit toàn diện. Phân loại theo mức độ ưu tiên P0–P3.

---

## 1. Phân loại Mức độ Ưu tiên

- **P0 (Critical):** Nguy cơ lộ secrets, lỗ hổng xác thực nghiêm trọng, mất mát hoặc hỏng dữ liệu.
- **P1 (High):** Vi phạm ranh giới Database-per-Service, service không thể khởi động độc lập, luồng nghiệp vụ chính bị gián đoạn khi tách container.
- **P2 (Medium):** Xử lý lỗi, retry, timeout, fallback, idempotency hoặc cấu hình docker/networking chưa hoàn thiện.
- **P3 (Low):** Refactor mã nguồn, cải thiện tính đồng nhất trong code, tài liệu và test coverage.

---

## 2. Danh sách Backlog Chi tiết

| ID | Mức độ | Vấn đề | File Liên quan | Bằng chứng Source Code | Trạng thái | Kế hoạch Xác minh |
|---|---|---|---|---|---|---|
| **ISSUE-01** | **P1** | `safety-rule.repository.ts` import và truy vấn trực tiếp 3 DB ngoài (`camera`, `reporting`, `identity`) | `src/modules/safety-rule/safety-rule.repository.ts` | Dòng 1–4: `import { sitePrisma }`, `cameraPrisma`, `reportingPrisma`, `rbacRepo` | **DONE** | Dùng type import, decouple `RbacRepository`, bọc an toàn DB ngoài |
| **ISSUE-02** | **P1** | `notification.repository.ts` import `identityPrisma` để ghi audit log | `src/modules/notification/notification.repository.ts` | Dòng 9: `import { prisma as identityPrisma }`, Dòng 652: `identityPrisma.auditLog.create` | **DONE** | Đã xóa import `identityPrisma`, chuyển sang bắn event qua `EventBus` |
| **ISSUE-03** | **P1** | Satellite services bị sập request do `maintenanceGuard()` gọi `maintenanceRepository` khi thiếu Identity DB | `src/middlewares/maintenance.middleware.ts`, `src/common/services/maintenance-cache.service.ts` | Dòng 101: `maintenanceRepository.getOrCreateDefaultConfig` ném lỗi DB connection nếu không có Identity DB | **DONE** | Đã cài đặt Fail-Open In-Memory Circuit Breaker trong `MaintenanceCacheService` |
| **ISSUE-04** | **P1** | Satellite services từ chối JWT hợp lệ (401) do `authMiddleware` gọi `permissionCacheService.getUserState` sang Identity DB | `src/middlewares/auth.middleware.ts`, `src/common/services/permission-cache.service.ts` | Dòng 132–142 trong `auth.middleware.ts`: userState=null (do DB lỗi) dẫn đến 401 Unauthorized | **DONE** | Đã chuyển toàn bộ satellite router sang `verifyJwtLocally` và bổ sung Resilient Fallback trong `permission.middleware` |
| **ISSUE-05** | **P2** | `cron.repository.ts` truy vấn trực tiếp `notificationPrisma` trong `getActivityStats` | `src/modules/cron/cron.repository.ts` | Dòng 3: `import { notificationPrisma }`, Dòng 103: `notificationPrisma.notification.count` | **DONE** | Đã bọc try/catch fallback; ghi nhận kế hoạch tách endpoint HTTP |
| **ISSUE-06** | **P2** | Docker Compose chưa định nghĩa đầy đủ container cho `site`, `camera`, `incident`, `reporting` services | `docker-compose.yml`, `traefik/dynamic.yml` | Traefik dynamic trỏ tới `host.docker.internal:8891-8894` nhưng `docker-compose.yml` mới chỉ có `notification-service` và `media-service` | **DONE** | Đã bổ sung 4 containers (`site`, `camera`, `incident`, `reporting`) vào `docker-compose.yml` với Traefik labels chuẩn |
| **ISSUE-07** | **P2** | `ppe-violation.subscriber.ts` khởi tạo trực tiếp instance repository của nhiều service | `src/common/subscribers/ppe-violation.subscriber.ts` | Dòng 21–25: `new IncidentRepository()`, `notificationService`, `new ReportingRepository()` | **DONE** | Phân lập lỗi độc lập qua 4 Consumer Groups và Dead-Letter Queue (DLQ) |
| **ISSUE-08** | **P3** | `FileRecord` model nằm trong `prisma/identity/schema.prisma` thay vì schema riêng của Media Service | `prisma/identity/schema.prisma`, `src/media.server.ts` | `media.server.ts` kết nối tới `prisma` (Identity DB) thay vì `mediaPrisma` | **TODO** | Tạo `prisma/media/schema.prisma` và tách DB `ppe_media_db` |

---

## 3. Nhật ký Triển khai & Kết quả Kiểm thử

### Đợt 1: Xử lý 4 vấn đề kỹ thuật tại AI Vision Integration (BE-15)
- **Files:** `src/modules/integration/ai-vision.controller.ts`, `src/modules/integration/ai-vision.service.ts`
- **Nội dung:** 
  1. Chuẩn hóa interface metadata strictly typed (`AiVisionAlertMetadata`).
  2. Bổ sung rate limiting chuyên biệt cho endpoint tiếp nhận cảnh báo.
  3. Cải thiện thông báo lỗi an toàn (không rò rỉ stack trace).
  4. Xác thực tính nhất quán của idempotency cache với TTL 24h.
- **Kết quả:** Passed (0 errors).
- **Trạng thái:** **DONE**

### Đợt 2: Khắc phục Cross-Database Audit Log trong Notification Service (ISSUE-02)
- **Files:** `src/modules/notification/notification.repository.ts`, `src/modules/notification/notification.service.ts`
- **Nội dung:** 
  - Loại bỏ hoàn toàn import `prisma as identityPrisma`.
  - Chuyển thao tác audit log của template sang bắn event qua `EventBus` (`system.audit.created`).
  - Decouple `UserRepository` thành optional dependency trong `NotificationService`.
- **Trạng thái:** **DONE**

### Đợt 3: Bảo đảm Satellite Services Khởi động Độc lập (ISSUE-03, ISSUE-04)
- **Files:** `src/common/services/maintenance-cache.service.ts`, `src/middlewares/maintenance.middleware.ts`, `src/middlewares/permission.middleware.ts`, các satellite route files.
- **Nội dung:**
  - Bổ sung Fail-Open In-Memory Circuit Breaker trong `MaintenanceCacheService`.
  - Thay thế toàn bộ `authMiddleware` trong 7 satellite router files bằng `verifyJwtLocally` (Decentralized RS256 Verification).
  - Bổ sung Admin bypass và Resilient Role Fallback trong `permission.middleware.ts`.
- **Trạng thái:** **DONE**

### Đợt 4: Hoàn thiện Triển khai Docker Microservices & Deep Health Check (ISSUE-06)
- **Files:** `docker-compose.yml`, `traefik/dynamic.yml`, `src/site.app.ts`, `src/camera.app.ts`, `src/incident.app.ts`, `src/reporting.app.ts`
- **Nội dung:**
  - Khai báo 4 containers (`site-service`, `camera-service`, `incident-service`, `reporting-service`) vào `docker-compose.yml` kèm Traefik service discovery labels.
  - Sửa lỗi hardcode placeholder `inject-gateway-secret` trong `traefik/dynamic.yml`.
  - Bổ sung Deep Health Check probe (`/health`, `/health/live`) kiểm tra trực tiếp trạng thái kết nối CSDL của từng satellite service.
- **Trạng thái:** **DONE**
