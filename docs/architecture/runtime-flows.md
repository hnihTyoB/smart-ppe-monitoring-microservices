# Runtime Flows & Execution Lifecycles

> **Phiên bản:** 1.0.0  
> **Ngày lập:** 12/10/2026  
> **Mục tiêu:** Mô tả chi tiết luồng thực thi trong thời gian chạy (runtime) cho các module đặc biệt: Cron & Maintenance, Authentication & API Key, Webhooks (Inbound/Outbound), Message Broker và Khởi động/Dừng service (Graceful Shutdown).

---

## 1. Luồng Cron Jobs & Scheduled Tasks

Hệ thống quản lý các tác vụ định kỳ thông qua tiến trình `app-worker` (`src/worker.server.ts`) kết hợp cùng BullMQ queue (`src/modules/cron/cron.queue.ts` & `cron.worker.ts`):

```mermaid
sequenceDiagram
    autonumber
    participant Worker as worker.server.ts
    participant BullQueue as BullMQ (cron-queue)
    participant Redis as Redis Server
    participant CronWorker as cron.worker.ts
    participant CronService as cron.service.ts
    participant IdentityDB as ppe_identity_db
    participant NotifQueue as BullMQ (events-notification-queue)

    Worker->>BullQueue: initCronJobs()
    Note over BullQueue,Redis: Repeatable jobs được đăng ký với cron patterns (UTC)<br/>- Daily Cleanup: 02:00 AM<br/>- Weekly Digest: 08:00 AM Thứ 2<br/>- Data Retention: 03:00 AM Chủ nhật
    Redis-->>CronWorker: Kích hoạt Trigger theo lịch
    CronWorker->>CronService: handleScheduledJob(jobName)
    
    alt Job: Daily Maintenance Cleanup
        CronService->>IdentityDB: Xóa tokens hết hạn (refresh, verify, reset)
        CronService->>IdentityDB: Dọn dẹp Audit Logs quá hạn retention (90 ngày)
    else Job: Weekly Activity Digest
        CronService->>IdentityDB: Tổng hợp user mới, phiên hoạt động, audit logs
        CronService->>NotifQueue: Phát event gửi email báo cáo cho Quản trị viên
    end
    
    CronService-->>CronWorker: Job hoàn tất (Success)
    CronWorker->>Redis: Cập nhật Job Progress & Hoàn thành
```

### Các đặc tính an toàn:
1. **Chống thực thi trùng lặp (Concurrency Control):** BullMQ sử dụng Redis repeatable job keys và distributed locks đảm bảo dù `app-worker` có scale nhiều replicas, mỗi scheduled job chỉ được xử lý bởi **đúng một** worker instance tại một thời điểm.
2. **Khả năng chạy lại (Idempotency):** Các tác vụ dọn dẹp token và audit logs sử dụng mệnh đề `DELETE ... WHERE expiresAt < cutoffDate` có tính bất biến/idempotent, có thể chạy lại an toàn nếu worker bị crash giữa chừng.

---

## 2. Luồng Bảo trì Hệ thống (Maintenance Mode)

Trạng thái bảo trì được lưu trữ tại bảng `maintenance_configs` (`ppe_identity_db`) và đồng bộ thời gian thực tới các microservice qua Redis Pub/Sub:

```mermaid
sequenceDiagram
    autonumber
    participant Admin as Quản trị viên
    participant API as app-api (:9999)
    participant CacheSvc as maintenanceCacheService
    participant RedisPubSub as Redis (MAINTENANCE_PUBSUB_CHANNEL)
    participant Satellite as Satellite Services (:8889 - :8894)
    participant Client as Người dùng cuối

    Admin->>API: PATCH /api/v1/maintenance (enabled=true, status=READ_ONLY)
    API->>CacheSvc: updateConfig(...)
    CacheSvc->>RedisPubSub: PUBLISH { action: "INVALIDATE" }
    
    par Invalidation Fan-out
        RedisPubSub-->>API: Xóa cache RAM
        RedisPubSub-->>Satellite: Xóa cache RAM
    end

    Client->>Satellite: POST /api/v1/incidents
    Satellite->>Satellite: maintenanceGuard() kiểm tra cấu hình
    alt User có quyền ADMIN hoặc IP trong Whitelist
        Satellite-->>Client: Cho phép thực hiện (Bypass)
    else Request dạng ghi (POST/PUT/DELETE) trong chế độ READ_ONLY
        Satellite-->>Client: 503 Service Unavailable (Kèm thông báo bảo trì)
    end
```

---

## 3. Luồng Xác thực (Authentication) & API Key

### 3.1. Xác thực JWT Người dùng (Decentralized Local Verification)
Hệ thống sử dụng chữ ký bất đối xứng **RS256** (RSA 2048-bit) cho phép các satellite microservice tự xác thực token trong **0.01ms** mà không cần gọi HTTP sang Identity Service:

```mermaid
sequenceDiagram
    autonumber
    participant Client as Frontend / User
    participant Traefik as Traefik Gateway
    participant CoreAuth as Identity Service (:9999)
    participant Satellite as Satellite Service (:8891)

    Client->>CoreAuth: POST /api/v1/auth/login
    CoreAuth-->>Client: Trả về Access Token (Ký bằng Private Key RS256, kid='template-be-auth-key-1')
    
    Client->>Traefik: GET /api/v1/sites (Bearer Token)
    Traefik->>Satellite: Forward request (Inject x-gateway-secret)
    Satellite->>Satellite: verifyJwtLocally / authMiddleware
    Note over Satellite: 1. Đọc public key từ local pem hoặc /.well-known/jwks.json (Cached 24h)<br/>2. Verify chữ ký RS256 và expiration<br/>3. Trích xuất req.user = { id, role, roleId }
    Satellite-->>Client: 200 OK (Dữ liệu sites)
```

### 3.2. Xác thực API Key Tích hợp Hệ thống
API Key được sử dụng cho các hệ thống bên ngoài hoặc Camera Edge kết nối trực tiếp:
1. Client gửi header `x-api-key: ak_live_...`.
2. Middleware `apiKeyAuthMiddleware` băm SHA-256 chuỗi key và so khớp với `key_hash` trong `api_keys` (`ppe_identity_db`).
3. Kiểm tra các điều kiện nghiêm ngặt:
   - Trạng thái `status === ACTIVE` và chưa bị thu hồi (`revokedAt === null`).
   - Thời hạn hiệu lực `expiresAt > NOW()`.
   - IP Whitelist (nếu có cấu hình).
   - Scopes / Quyền hạn được cấp phép (ví dụ: `ppe:vision:write`).
   - Rate limit chuyên biệt theo từng key.

---

## 4. Luồng Webhook (Inbound & Outbound)

### 4.1. Inbound Webhook (Tiếp nhận Cảnh báo AI Vision từ Camera Edge)

```mermaid
sequenceDiagram
    autonumber
    participant Camera as AI Edge Camera
    participant Traefik as Traefik Gateway
    participant Ingestion as ai-vision.controller (:9999)
    participant Redis as Redis (Idempotency Cache)
    participant EventBus as Redis EventBus

    Camera->>Traefik: POST /api/v1/integrations/ai-vision/alerts<br/>Headers: x-signature, x-timestamp, x-idempotency-key
    Traefik->>Ingestion: Forward Request
    
    Ingestion->>Ingestion: 1. Kiểm tra Anti-replay timestamp (Độ lệch tối đa 300s)
    Ingestion->>Ingestion: 2. Xác thực chữ ký HMAC-SHA256 (Secret đối soát)
    Ingestion->>Redis: 3. Kiểm tra Idempotency Token (SETNX với TTL 24h)
    
    alt Token đã tồn tại (Duplicate Delivery)
        Redis-->>Ingestion: Bị trùng lặp
        Ingestion-->>Camera: 200 OK (status: "ALREADY_PROCESSED")
    else Token hợp lệ mới
        Redis-->>Ingestion: Lưu thành công
        Ingestion->>EventBus: publish("ppe.violation.detected", alertPayload)
        Ingestion-->>Camera: 202 Accepted (status: "QUEUED", alertId)
    end
```

### 4.2. Outbound Webhook (Bắn Webhook Thông báo Sự cố ra Hệ thống Bên ngoài)
1. Khi có sự cố mức nghiêm trọng `CRITICAL`, `integration.service.ts` tìm kiếm các subscription đăng ký sự kiện `ppe.incident.created`.
2. Gói tin được đưa vào BullMQ `webhook.queue.ts`.
3. `webhook.worker.ts` tiếp nhận và gửi HTTP POST đến URL đích với:
   - Header `X-Webhook-Signature`: Chữ ký HMAC SHA-256 tính từ body và secret subscription.
   - Header `X-Webhook-Event`: Tên sự kiện.
   - Timeout 10 giây.
4. Nếu thất bại (timeout hoặc HTTP 5xx), BullMQ kích hoạt cơ chế retry tự động theo hàm mũ (Exponential Backoff) tối đa 5 lần. Kết quả từng lần gửi được ghi nhận vào `webhook_deliveries` (`ppe_identity_db`).

---

## 5. Luồng Khởi động Service & Graceful Shutdown

Tất cả các entry point của hệ thống (`api.server.ts`, `worker.server.ts`, `notification.server.ts`, v.v.) đều tuân thủ quy trình vòng đời chuẩn:

```mermaid
sequenceDiagram
    autonumber
    participant OS as Hệ điều hành / Docker
    participant Server as Microservice Process
    participant HTTP as HTTP Server (Express)
    participant Workers as Background Workers / Subscribers
    participant Connections as DB & Redis Connections

    Note over Server: KHỞI ĐỘNG (Startup)
    Server->>Connections: Khởi tạo kết nối Prisma DB & Redis
    Server->>Workers: Đăng ký EventBus Subscribers & BullMQ Workers
    Server->>HTTP: listen(PORT) - Sẵn sàng nhận traffic

    Note over Server: DỪNG HOẠT ĐỘNG (Graceful Shutdown)
    OS->>Server: Gửi tín hiệu SIGTERM / SIGINT
    Server->>Server: Kích hoạt timer giới hạn cưỡng bức (Force Exit Timer: 10s)
    Server->>HTTP: Đóng idle connections & ngừng nhận request mới (server.close)
    Server->>Workers: Dừng workers đang chạy (worker.stop / subscribers.close)
    Server->>Connections: Ngắt kết nối Prisma Clients & Redis ($disconnect / quit)
    Server->>OS: process.exit(0) sạch sẽ
```
