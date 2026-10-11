# CẨM NANG TOÀN DIỆN: CHIẾN LƯỢC BẢO VỆ ĐỒ ÁN TỐT NGHIỆP
## Đề tài: Hệ thống Giám sát An toàn Lao động Thông minh (Smart PPE Monitoring System)
### Kiến trúc: Microservices & Event-Driven Architecture (Chuẩn Tài liệu D08 & Tasks BE-03, BE-04, BE-05)

---

## 🎯 1. TƯ DUY CHIẾN LƯỢC: BIẾN "CHƯA XONG HẾT" THÀNH "KỸ SƯ CHUYÊN NGHIỆP"

> [!IMPORTANT]
> **Nguyên tắc số 1 của Hội đồng chấm ĐATN:**
> Thầy cô không chấm điểm một giao diện web lung linh nhưng bên dưới là một khối code chắp vá dễ sập. Hội đồng đánh giá cao nhất ở:
> 1. **Tư duy Kiến trúc (Architecture Thinking)**: Hiểu tại sao mình làm vậy, ưu - nhược điểm và sự đánh đổi (trade-offs).
> 2. **Độ tin cậy của phần lõi (Core System Reliability)**: Cơ sở dữ liệu chuẩn, bảo mật vững, không mất mát dữ liệu.
> 3. **Tính trung thực và cầu thị (Engineering Integrity)**: Dám thừa nhận giới hạn và có lộ trình hoàn thiện rõ ràng.

---

## 📋 2. TỔNG HỢP 10 BỘ CÂU HỎI VÀ ĐÁP ÁN NỀN TẢNG (CHEAT SHEET)

### 🔹 Câu 1: Tại sao chọn Microservices và 6 Database riêng? Có bị Over-Engineering không?
* **Bẫy của Hội đồng**: Thầy cô muốn thử xem bạn có chạy theo "trend" công nghệ mà không hiểu bài toán hay không.
* **Câu trả lời chuẩn**:
  > *"Hệ thống có 2 nhóm tải trọng đối lập: nhóm **Quản trị** (Site, Camera, User) có lưu lượng thấp/đều, nhưng nhóm **Giám sát AI & Vi phạm** (Incident, Stream) có lưu lượng rất cao và đột biến theo thời gian thực. Việc tách Microservices với Kafka Event Bus giúp tải xử lý vi phạm không làm nghẽn hệ thống quản trị, và Database-per-Service giúp cô lập dữ liệu/hiệu năng, tránh lock bảng khi nhiều camera đẩy vi phạm liên tục."*

---

### 🔹 Câu 2: Giải quyết bài toán Cross-Database Join & Tính nhất quán dữ liệu thế nào?
* **Bẫy của Hội đồng**: Bạn tách DB thì làm sao SELECT JOIN tên công nhân, tên công trường và vi phạm?
* **Câu trả lời chuẩn**:
  > *"Em kết hợp 2 giải pháp:  
  > 1) **Metadata Snapshotting**: Trong Kafka event `ppe.violation.detected`, AI Worker nhúng sẵn các thông tin định danh tĩnh tại thời điểm xảy ra sự việc (`site_name`, `camera_code`, `worker_code`, `timestamp`).  
  > 2) **CQRS & Read-Model Projection**: Reporting Service lắng nghe các sự kiện này để tổng hợp sẵn vào Read Model của riêng nó, phục vụ lọc/thống kê tức thì với tốc độ O(1) mà không cần Distributed Join qua mạng."*

---

### 🔹 Câu 3: Luồng dữ liệu thời gian thực (End-to-End Pipeline) từ Camera đến Cảnh báo?
* **Câu trả lời chuẩn**:
  > *"1. Camera công trường đẩy RTSP stream tới AI Worker (chạy YOLO + ByteTrack).  
  > 2. Khi phát hiện vi phạm liên tục qua N frames để chống nhiễu (Temporal Debouncing), AI Worker crop snapshot/clip và upload lên MinIO Object Storage lấy URL.  
  > 3. AI Worker bắn event `ppe.violation.detected` lên Kafka topic.  
  > 4. Incident Service consume Kafka để ghi nhận vào `ppe_incident_db`.  
  > 5. Notification Service đồng thời consume event để bắn WebSocket/SSE tới Web Dashboard của Giám sát an toàn trong vòng dưới 1 - 2 giây."*

---

### 🔹 Câu 4: Xác thực & Phân quyền liên dịch vụ (Decentralized Auth) hoạt động ra sao?
* **Bẫy của Hội đồng**: Mỗi request đến Camera hay Incident Service có phải gọi ngược lại Auth Service không?
* **Câu trả lời chuẩn**:
  > *"Em sử dụng chữ ký bất đối xứng **Asymmetric JWT (RS256)**:  
  > - Identity Service giữ Private Key để ký Access Token.  
  > - API Gateway và các Microservices tải Public Key qua endpoint chuẩn **RFC 7517 JWKS** (`/.well-known/jwks.json`) và cache trong RAM (TTL 24h).  
  > - Mỗi service tự verify token offline trong **0.01ms** mà không phát sinh bất kỳ network call nào sang Identity Service (triệt tiêu Single Point of Failure). Quyền hạn chi tiết được kiểm soát tại middleware `requirePermission` của từng service."*

---

### 🔹 Câu 5: Khi Admin khóa tài khoản khẩn cấp, làm sao thu hồi Access Token RS256 còn hạn?
* **Câu trả lời chuẩn**:
  > *"Hệ thống áp dụng cơ chế phòng thủ 2 lớp:  
  > 1. **Short-lived Token**: Access Token chỉ có hạn 15 phút, thu hẹp tối đa cửa sổ rủi ro.  
  > 2. **Event-driven Redis Blacklist**: Khi có sự kiện khẩn cấp (khóa tài khoản, hạ quyền), Identity Service bắn event `user.revoked` qua Redis Pub/Sub; các microservices lập tức lưu `userId` vào Redis Blacklist với TTL bằng thời hạn còn lại của token. Middleware verify token kiểm tra Redis O(1) để chặn ngay lập tức."*

---

### 🔹 Câu 6: Đối diện câu hỏi "Đồ án đã làm được những gì, phần nào chưa xong?"
* **Nguyên tắc**: Tuyệt đối không giấu dốt, không bao biện, không hứa suông. Nói rõ ràng theo 3 cột mốc:
* **Câu trả lời chuẩn**:
  > *"Đồ án được xây dựng theo phương pháp 'Tiến hóa kiến trúc' (Evolutionary Architecture) và hiện tại đã hoàn thành vững chắc các trụ cột cốt lõi:  
  > 1) **Hạ tầng phân tán**: Cụm Docker Compose với 6 Logical DBs được cô lập phân quyền, cụm Kafka KRaft mode và MinIO S3 Object Storage.  
  > 2) **Dịch vụ Identity & Dynamic RBAC**: Chuẩn bảo mật OWASP, RS256 JWKS, Token Rotation, 2FA TOTP và đạt **100% pass hơn 500 automated tests**.  
  > 3) **Xương sống sự kiện**: Transactional Outbox Pattern chống mất mát dữ liệu vi phạm.  
  > 4) **Mô hình AI**: YOLO đã được huấn luyện phân loại mũ/áo bảo hộ.  
  > Phần đang tiếp tục hoàn thiện là tích hợp Dashboard Frontend tập trung và adapter kết nối camera vật lý. Hợp đồng API (OpenAPI 3.0 specs) đã được chuẩn hóa đầy đủ."*

---

### 🔹 Câu 7: Chịu lỗi phân tán (Fault Tolerance) & Chống mất sự kiện (Zero Message Loss)?
* **Câu trả lời chuẩn**:
  > *"Em áp dụng bộ 3 giải pháp công nghiệp:  
  > 1. **Transactional Outbox Pattern**: Bản ghi vi phạm và sự kiện Outbox được ghi trong cùng 1 ACID Database Transaction. Worker dùng truy vấn `FOR UPDATE SKIP LOCKED` để relay lên Kafka, đảm bảo không bao giờ mất sự kiện dù server crash.  
  > 2. **Idempotent Consumer**: Consumer kiểm tra `event_id` (UUIDv7) qua Redis/DB constraint để triệt tiêu xử lý trùng lặp khi Kafka gửi lại (At-least-once delivery).  
  > 3. **Orphan File Cleanup**: File upload lên MinIO đều có cờ `isConfirmed`. Cron job quét định kỳ xóa các file rác quá 24h không liên kết bản ghi vi phạm."*

---

### 🔹 Câu 8: Mô hình AI giải quyết Báo động giả (False Alarm) và Che khuất (Occlusion) thế nào?
* **Câu trả lời chuẩn**:
  > *"1. **Model**: YOLO (v8/v11) tối ưu tốc độ inference thời gian thực trên các classes: `person`, `hardhat`, `no_hardhat`, `safety_vest`, `no_safety_vest`.  
  > 2. **Chống báo động giả**: Kết hợp Object Tracking (**ByteTrack**) để gán `track_id` cho từng công nhân và áp dụng **Temporal Debouncing**: Chỉ kết luận vi phạm khi phát hiện vi phạm liên tục qua N frames (ví dụ 30 frames ~ 1-2 giây), triệt tiêu nhiễu khi bị giàn giáo hay vật liệu che khuất tạm thời.  
  > 3. **Tăng cường dữ liệu (Augmentation)**: Huấn luyện với Color Jittering, Random Shadow và Mosaic để thích nghi với điều kiện nắng gắt/bụi bặm công trường."*

---

### 🔹 Câu 9: Chiến lược Live Demo thuyết phục khi chưa hoàn thiện Frontend?
* **Kịch bản Demo 5 phút ghi trọn điểm thực hành**:
  1. **Bước 1 (1 phút) - Trực quan hóa Hạ tầng**: Mở terminal gõ `docker compose -f docker-compose.infra.yml ps` chỉ rõ các container: PostgreSQL 16 (6 DBs), Kafka KRaft, Kafka UI, MinIO đang running/healthy.
  2. **Bước 2 (2 phút) - Demo AI & Kafka Event Pipeline**: Chạy script test inference ảnh/video qua model YOLO -> Model đóng bounding box -> tự động upload ảnh bằng chứng lên MinIO -> bắn event lên Kafka. Mở **Kafka UI (port 8088)** cho thầy cô xem message JSON thời gian thực, mở **MinIO Console (port 9001)** xem ảnh vi phạm thật!
  3. **Bước 3 (2 phút) - Minh chứng Chất lượng Kỹ thuật**: Mở **Swagger UI (`/api/docs`)** test API cấp token RS256 / Dynamic RBAC, và chạy lệnh `pnpm test` trong terminal cho thầy cô thấy hơn 500 unit & integration test cases pass xanh 100%.

---

### 🔹 Câu 10: Tóm tắt Đóng góp, Hạn chế & Hướng phát triển trong 1 phút?
* **Câu trả lời chuẩn**:
  > *"1. **Đóng góp**: Đồ án chứng minh tính khả thi của giải pháp giám sát an toàn tự động kết hợp AI Vision và kiến trúc Microservices phân tán chịu tải cao, giải quyết triệt để bài toán cô lập dữ liệu và độ trễ dưới 2 giây.  
  > 2. **Hạn chế**: Hệ thống mới kiểm thử trên môi trường cụm Docker nội bộ, chưa thử nghiệm trên hạ tầng Kubernetes đa node; mô hình AI cần bổ sung thêm dữ liệu ban đêm và góc khuất.  
  > 3. **Hướng phát triển**: Hoàn thiện Dashboard giám sát thời gian thực, triển khai Auto-scaling trên K8s và mở rộng nhận diện dây an toàn trên cao (Harness) cùng cảnh báo xâm nhập vùng nguy hiểm."*

---

## 🚀 3. CHUYÊN ĐỀ SÂU: 6 BỘ CÂU HỎI VẤN ĐÁP KỸ THUẬT THEO TÀI LIỆU D08.PDF

### 🔸 Câu 11 (D08 Mục 2.5 & 3.4): Safety Rule Engine - confirmationDuration & cooldownDuration
* **Câu hỏi**: *"Trong `SiteSafetyConfig`, cơ chế chi tiết của `confirmationDuration` (2s) và `cooldownDuration` (30s) là gì? Tại sao camera 25-30 FPS bắt buộc phải có cả 2?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > - `confirmationDuration` (2s) là cửa sổ thời gian bộ lọc **Temporal Filtering**: AI Tracking phải phát hiện vi phạm liên tục trong 2 giây (~50-60 frames ở 25-30 FPS) thì mới đủ điều kiện kết luận vi phạm, loại bỏ triệt để hiện tượng che khuất thoáng qua (Flicker/Occlusion).  
  > - `cooldownDuration` (30s) là cơ chế **De-duplication / Anti-Spam**: Sau khi sự cố đã được ghi nhận cho đối tượng/camera đó, hệ thống 'đóng băng' việc kích hoạt sự cố mới trong 30 giây tiếp theo, tránh tạo hàng trăm bản ghi trùng lặp làm ngập kênh cảnh báo của Cán bộ an toàn."*

---

### 🔸 Câu 12 (D08 Mục 2.6): Vùng hạn chế nguy hiểm (Restricted Area) & Hình học không gian
* **Câu hỏi**: *"Trong model `RestrictedArea`, `boundary: Json` là một polygon. Em dùng thuật toán hình học nào để kiểm tra công nhân xâm nhập? Em lấy điểm tọa độ nào trên Bounding Box và tại sao?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Thuật toán hình học**: Em áp dụng thuật toán **Ray Casting (Point-in-Polygon / Crossing Number)** để kiểm tra điểm mục tiêu có nằm trong đa giác `boundary` hay không.  
  > 2) **Tọa độ tham chiếu**: Em lấy **Điểm đáy giữa của Bounding Box (Foot Point: `x_center = (x1+x2)/2, y_bottom = y2`)**, tức vị trí bàn chân công nhân tiếp xúc với mặt đất. Do camera đặt trên cao nhìn chéo (Perspective Projection), nếu dùng tâm Box (Center) hoặc đỉnh Box (Head) thì công nhân chỉ đứng ngoài rào chắn nghiêng người vào sẽ bị báo động sai; việc lấy Foot Point bảo đảm độ chính xác vật lý thực tế tuyệt đối."*

---

### 🔸 Câu 13 (D08 Mục 1 & 2.1): Bằng chứng pháp lý (Evidence Checksum) & Audit Trail
* **Câu hỏi**: *"Tại sao trường `checksum` (SHA-256) trong `EvidenceMetadata` và bảng `EvidenceAccessLog` lại là yêu cầu bắt buộc? Làm sao chứng minh trước thanh tra rằng bằng chứng không bị can thiệp?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Tính toàn vẹn pháp lý (Tamper Evidence)**: Bằng chứng hình ảnh/clip vi phạm có thể là căn cứ chế tài kỷ luật hoặc xử lý tai nạn lao động trước pháp luật. `checksum` (SHA-256) được tính ngay khi AI trích xuất bằng chứng tại biên và lưu bất biến trong CSDL; nếu tệp tin trên MinIO bị chỉnh sửa hoặc thay thế, hệ thống sẽ phát hiện hash mismatch ngay lập tức.  
  > 2) **Chống chối bỏ (Non-repudiation & Audit Trail)**: `EvidenceAccessLog` ghi lại nhật ký mọi lượt truy cập, xem hoặc xuất bằng chứng (ai xem, lúc nào, hành động gì) để ngăn ngừa rò rỉ dữ liệu nhạy cảm hoặc can thiệp trái phép vào hồ sơ vi phạm."*

---

### 🔸 Câu 14 (D08 Mục 4.3 & 4.5): Human Review (True/False Alarm) & MLOps Feedback Loop
* **Câu hỏi**: *"Sự kết hợp giữa Human Review (`True Violation` vs `False Alarm`) trong Incident Service và `AiModelVersion` trong Reporting Service tạo ra giá trị gì cho MLOps?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô, đây là cơ chế **Human-in-the-Loop & Vòng lặp phản hồi Active Learning**:  
  > 1) **Phát hiện Model Drift**: Tỷ lệ `falseAlarms / totalIncidents` được theo dõi theo từng camera/công trường, cảnh báo ngay khi độ chính xác mô hình suy giảm trên môi trường thực tế (do ánh sáng, thời tiết thay đổi).  
  > 2) **Thu thập mẫu khó (Hard Negatives Collection)**: Các snapshot/clip bị gắn nhãn False Alarm được tự động gom vào Data Lake phục vụ tái huấn luyện (Retraining). Nhờ đó, phiên bản `AiModelVersion` tiếp theo sẽ được bổ sung chính xác các trường hợp gây nhầm lẫn (như mũ thời trang, balo, góc khuất) để liên tục cải thiện mAP50 và Precision."*

---

### 🔸 Câu 15 (D08 Mục 2.7): 4 Kafka Consumer Groups & Xử lý Poison Pills qua DLQ
* **Câu hỏi**: *"Tại sao em phải tách thành 4 Consumer Groups riêng biệt (`INCIDENT_SERVICE`, `NOTIFICATION_SERVICE`, `REPORTING_SERVICE`, `AUDIT_LOGGER`) cùng nghe topic `ppe.violation.detected`? Xử lý Poison Pills thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Mô hình Fan-out Publish/Subscribe**: Em dùng 4 Consumer Groups riêng biệt để mỗi service duy trì Offset độc lập, đảm bảo cả 4 service cùng nhận được thông điệp vi phạm mà không bị 'tranh giành' (nếu dùng chung 1 group thì Kafka sẽ chia tải point-to-point, service này nhận thì service kia mất).  
  > 2) **Cô lập lỗi (Fault Isolation)**: Nếu Notification Service bị chậm hoặc lỗi gửi mail/SMS, offset của nó bị lag riêng biệt, hoàn toàn KHÔNG làm tắc nghẽn hay gián đoạn luồng ghi DB của Incident Service.  
  > 3) **Xử lý Poison Pills**: Nếu một tin nhắn bị lỗi sau số lần retry tối đa, consumer đẩy tin nhắn vào `ppe.dead-letter-queue` và commit offset để partition tiếp tục vận hành bình thường."*

---

### 🔸 Câu 16 (D08 Bảng 3.5): Traefik Priority Routing & Chống Bypass Gateway bằng Secret
* **Câu hỏi**: *"Tại sao em đặt `priority: 100` cho 6 microservices và `priority: 1` cho `app-api` trong Traefik? Middleware `inject-gateway-secret` bảo vệ hệ thống thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Quy tắc ưu tiên định tuyến (Priority Precedence)**: Router `app-api` là catch-all với tiền tố chung `PathPrefix('/api/v1')`. Nếu không đặt `priority: 100` cho 6 microservices chuyên biệt và `priority: 1` cho `app-api`, Traefik có nguy cơ chuyển nhầm các request như `/api/v1/incidents` hay `/api/v1/sites` vào app-api thay vì đến đúng microservice đích.  
  > 2) **Chống Bypass Gateway (Zero-Trust Security)**: Middleware `inject-gateway-secret` tự động gắn header `X-Gateway-Secret` bí mật khi chuyển tiếp traffic. Các microservices nội bộ áp dụng middleware `requireGatewayOrigin` (kiểm tra bằng `crypto.timingSafeEqual`). Nếu kẻ tấn công scan thấy port nội bộ (như 8893) và gọi trực tiếp, request sẽ bị từ chối ngay với HTTP `403 GATEWAY_REQUIRED`."*

---

## 🔥 4. CHUYÊN ĐỀ SÂU: 6 CÂU HỎI VẤN ĐÁP TỪ MODULE SITE MANAGEMENT (TASK BE-03 & BE-04)

### 🔹 Câu 17 (Task BE-04: `site.service.ts`): Cấu trúc phân cấp & Tự động hóa Safety Config
* **Câu hỏi**: *"Tại sao khi tạo Site mới, hệ thống tự động khởi tạo luôn `SiteSafetyConfig` mặc định? Khi tạo `RestrictedArea`, làm sao ngăn người dùng gán nhầm `zoneId` của công trường khác?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Tự động hóa Fail-Safe**: Mọi camera khi cắm vào công trường đều cần ngưỡng xử lý ngay lập tức. Nếu không có cấu hình an toàn, AI Worker sẽ không biết lấy threshold nào để lọc vi phạm. Do đó hệ thống tự động khởi tạo giá trị an toàn chuẩn công nghiệp (ngưỡng 0.8, confirmation 2s, cooldown 30s) theo nguyên tắc Fail-Safe.  
  > 2) **Toàn vẹn quan hệ phân cấp**: Khi tạo `RestrictedArea`, Service kiểm tra chéo: nếu có `zoneId` thì bắt buộc `zone.siteId === data.siteId`. Nếu người dùng gửi `zoneId` của công trường A gán vào công trường B, Service chặn ngay với mã lỗi 400 `VALIDATION_ERROR`."*

---

### 🔹 Câu 18 (Task BE-03: `permission.constant.ts` & `site.route.ts`): Permission-First Dynamic RBAC
* **Câu hỏi**: *"Tại sao ở các route em lại dùng `requirePermission(PPE_SITE_MANAGE)` thay vì kiểm tra thẳng role `requireRole('SAFETY_MANAGER')`? Nếu sau này thêm role `AUDITOR` thì có phải sửa code không?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Kiến trúc Permission-First**: Role chỉ là tập hợp danh nghĩa, thẩm quyền thực tế thuộc về Permissions. Việc kiểm tra `requirePermission(PPE_SITE_MANAGE)` giúp code decouple hoàn toàn khỏi tên Role.  
  > 2) **Mở rộng Zero-Downtime**: Sau này doanh nghiệp có tạo vai trò mới như `AUDITOR` hay `INTERN_OFFICER` qua API `POST /api/v1/rbac/roles` và gán quyền `PPE_SITE_READ`, vai trò mới sẽ hoạt động tức thì trong thời gian thực mà KHÔNG cần sửa bất kỳ dòng code nào hay restart server."*

---

### 🔹 Câu 19 (Task BE-04: `site.app.ts`, `site.server.ts` & `routes/index.ts`): Dual-Mounting & Strangler Fig Pattern
* **Câu hỏi**: *"Tại sao em vừa cho Site Service chạy độc lập ở port 8891, vừa mount router vào Monolith ở port 9999? Thiết kế này có tác dụng gì?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô, đây là chiến lược Dual-Mounting theo mô hình Strangler Fig Pattern:  
  > 1) **Local Development**: Lập trình viên chỉ cần chạy 1 tiến trình Monolith duy nhất (`pnpm dev`) để test nhanh toàn bộ luồng mà không cần mở 6-7 cửa sổ terminal hay tốn nhiều RAM.  
  > 2) **Production Deployment**: Ta có thể tách Site Service ra container/pod riêng (`node dist/site.server.js`, port 8891) để scale độc lập. Traefik Gateway sẽ định tuyến ưu tiên sang microservice này (priority 100), trong khi monolith vẫn sẵn sàng fallback nếu service vệ tinh bảo trì."*

---

### 🔹 Câu 20 (Task BE-04: `site.validation.ts`): Input Validation & DoS Defense với Zod
* **Câu hỏi**: *"Tại sao tọa độ đa giác `boundary` bắt buộc `min(3)`, `max(50)` và `.finite()`? Tại sao trên các schema update em đều thêm luật chặn payload rỗng `{}`?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Kiểm soát đa giác**: Đa giác hình học tối thiểu phải có 3 đỉnh (`min(3)`) mới khép kín thành diện tích vùng cấm; giới hạn `max(50)` và `.finite()` để chống tấn công DoS CPU khi AI tính toán thuật toán Ray Casting trên đa giác quá nhiều cạnh hoặc tọa độ `NaN`/`Infinity`. Tọa độ `.min(0)` vì pixel frame video luôn dương.  
  > 2) **Chặn payload rỗng**: Nếu client gửi `PUT /sites/:id` với body `{}` rỗng, nếu không chặn thì Prisma vẫn thực hiện câu lệnh UPDATE, gây lãng phí kết nối DB, sinh ra bản ghi Audit Log rác và cập nhật trường `updatedAt` sai lệch dù không có dữ liệu nào thay đổi."*

---

### 🔹 Câu 21 (Task BE-03 & BE-04 Tests): Chiến lược Test tự động với `node:test` và Dependency Injection
* **Câu hỏi**: *"Tại sao em dùng `node:test` thay vì Jest? Nhờ kiến trúc nào mà em có thể test logic của `SiteService` cực nhanh trong RAM?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Zero External Dependencies & Tốc độ**: Em sử dụng `node:test` native của Node.js 22 kết hợp `tsx --test` để chạy siêu nhanh, không cần cài đặt Jest nặng nề hay lo ngại xung đột cấu hình TypeScript ESM/CJS, giảm rủi ro chuỗi cung ứng (Supply Chain CVEs).  
  > 2) **Dependency Injection & Mocking**: Nhờ cấu trúc phân tầng Clean Architecture, `SiteService` nhận `SiteRepository` qua constructor injection; trong unit test, em inject mock repository để kiểm thử toàn diện mọi ranh giới nghiệp vụ (duplicate code 409, hierarchy mismatch 400, not found 404) trong RAM với tốc độ hàng chục nghìn test/giây mà không phụ thuộc vào kết nối DB ngoài."*

---

### 🔹 Câu 22 (Task BE-03: `prisma/seed.ts`): Phân quyền thực tế Safety Manager vs Safety Officer & Demo
* **Câu hỏi**: *"Sự khác biệt thẩm quyền giữa Safety Manager và Safety Officer là gì? Khi demo, nếu đăng nhập Officer rồi gọi API tạo Site hoặc sửa ngưỡng AI thì hệ thống phản hồi thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Phân định ranh giới thẩm quyền**: `SAFETY_MANAGER` có quyền chiến lược (tạo công trường, thêm camera, đổi ngưỡng AI `PPE_SAFETY_CONFIG_MANAGE`, xuất báo cáo). Ngược lại, `SAFETY_OFFICER` là cán bộ tác chiến trực ban: chỉ có quyền giám sát thời gian thực, duyệt True/False vi phạm (`PPE_INCIDENT_REVIEW`) và cập nhật xử lý sự cố.  
  > 2) **Hành vi phản hồi khi Demo**: Nếu `officer@ppe.local` gọi API `POST /api/v1/sites` hoặc `PUT /safety-config`, middleware `requirePermission(PPE_SITE_MANAGE)` chặn đứng ngay với HTTP 403 Forbidden `{ success: false, code: 'FORBIDDEN', message: 'Bạn không có quyền thực hiện hành động này' }`. Trên giao diện, các nút chức năng quản trị này cũng tự động bị ẩn dựa trên danh sách `permissions` trả về từ token."*

---

## 📹 5. CHUYÊN ĐỀ SÂU: 5 CÂU HỎI VẤN ĐÁP TỪ MODULE CAMERA MANAGEMENT (TASK BE-05)

### 🔹 Câu 23 (Task BE-05: `camera.service.ts`): Bảo mật thông tin xác thực luồng RTSP (Credential Masking)
* **Câu hỏi**: *"Tại sao luồng RTSP camera công trường lại hay chứa user/password trong URL? Hàm `maskStreamCredentials` giải quyết lỗ hổng bảo mật gì?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô: Các camera IP công trường thường xác thực qua chuẩn Basic Auth nhúng trực tiếp trong URI `rtsp://<username>:<password>@<ip>:<port>/<path>`. Nếu lưu và trả về nguyên trạng qua API GET hoặc ghi ra log hệ thống, mật khẩu camera sẽ bị lộ qua HTTP Response (CWE-200 / CWE-532). Hàm `maskStreamCredentials` sử dụng Regex để che giấu mật khẩu thành `rtsp://<user>:***@<ip>...` khi phản hồi ra bên ngoài hoặc ghi log, bảo vệ an toàn cho thiết bị camera trước nguy cơ bị chiếm quyền điều khiển."*

---

### 🔹 Câu 24 (Task BE-05: `camera.repository.ts` & `camera.service.ts`): Transaction nguyên tử & Giám sát bảo trì
* **Câu hỏi**: *"Tại sao em dùng `$transaction` khi tạo Camera? Trong hàm `pingCamera`, tại sao lại cố tình giữ nguyên trạng thái `MAINTENANCE` nếu camera đang bảo trì thay vì chuyển sang `ONLINE`?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Tính nguyên tử (Atomicity)**: Một camera muốn AI xử lý được thì bắt buộc phải có đồng thời cấu hình phân tích (`CameraConfig`) và luồng truyền tải (`CameraStream`). Việc bọc `$transaction` đảm bảo nguyên tắc 'All or Nothing': nếu tạo luồng stream thất bại, database sẽ rollback toàn bộ, không để lại bản ghi camera mồ côi (Orphan Record) trong CSDL.  
  > 2) **Bảo toàn nghiệp vụ Bảo trì**: Khi kỹ thuật viên chủ động đặt camera vào chế độ `MAINTENANCE` để sửa chữa phần cứng/góc quay, camera đó không được phép tham gia vào luồng giám sát phạt vi phạm. Nếu probe tự ý đổi về `ONLINE`, AI sẽ tiếp tục phát hiện và tạo vi phạm sai trong lúc kỹ thuật viên đang thử nghiệm."*

---

### 🔹 Câu 25 (Task BE-05: `camera.validation.ts`): Giới hạn FPS AI và Kiểm thực giao thức Stream
* **Câu hỏi**: *"Tại sao pipeline AI giám sát PPE lại chọn capture 10 FPS thay vì 30 FPS của camera? Việc kiểm thực `STREAM_URL_REGEX` ở biên HTTP mang lại lợi ích gì?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Tối ưu tải GPU & Chống nghẽn**: Tốc độ di chuyển của công nhân trên công trường chỉ khoảng 1 - 1.5 m/s. Việc AI xử lý ở 10 FPS (100ms/frame) là hoàn toàn đủ để phát hiện vi phạm và tracking liên tục (kết hợp confirmation window 2s = 20 frames), trong khi giúp giảm tải tính toán GPU và băng thông mạng tới 60-70% so với 30 FPS, cho phép 1 GPU phục vụ đồng thời nhiều camera hơn.  
  > 2) **Phòng vệ biên HTTP**: `STREAM_URL_REGEX` ngăn chặn việc truyền các scheme độc hại như `file:///etc/passwd`, `javascript:`, `ftp:` hoặc chuỗi rác, phòng chống lỗ hổng SSRF / Path Traversal và ngăn chặn AI Ingestion Worker (OpenCV/FFmpeg) bị crash do giao thức không được hỗ trợ."*

---

### 🔹 Câu 26 (Tài liệu `README.md` mới): Quy trình Onboarding & Tính nhất quán Kiến trúc
* **Câu hỏi**: *"Khi một kỹ sư mới tiếp nhận dự án, họ mất bao lâu và cần những bước nào để chạy được hệ thống? Em duy trì tính đồng bộ giữa `README.md`, Docker/Traefik và code thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Quy trình Onboarding 3 bước (< 5 phút)**: Một kỹ sư mới chỉ cần: a) `pnpm install` cài dependencies; b) `docker compose -f docker-compose.infra.yml up -d` để dựng 6 logical DBs, Kafka, MinIO; c) `pnpm run prisma:generate:all && pnpm run db:seed` để nạp toàn bộ schemas và tài khoản mẫu. Sau đó chạy ngay `pnpm dev`.  
  > 2) **Đồng bộ nhất quán (Single Source of Truth)**: Toàn bộ cổng dịch vụ (:8888, :8891, :8892, :8893, :8894) đều được tập trung hóa qua biến môi trường chuẩn trong `.env.example` và ánh xạ 1:1 sang cấu hình Traefik Dynamic Router và Docker Compose; tài liệu Swagger UI được sinh tự động 100% từ Zod schema nên không bao giờ xảy ra tình trạng tài liệu bị lệch pha (Out-of-sync) với mã nguồn."*

---

### 🔹 Câu 27 (Live Demo Camera Service & Traefik Routing): Trình diễn thực tế Module Camera
* **Câu hỏi**: *"Em chọn những API nào để demo toàn bộ vòng đời của camera? Làm sao chứng minh trực quan request đang được Traefik API Gateway định tuyến chính xác vào Camera Microservice (:8892)?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Kịch bản Live Demo Camera Service 4 bước**:  
  >    - Gọi `POST /api/v1/cameras` tạo camera kèm RTSP URL; chứng minh response tự động sinh cả `config` (10 FPS) và `streams` trong 1 transaction.  
  >    - Gọi `POST /api/v1/cameras/:id/ping` để kích hoạt health probe stream, đo độ trễ latency thực tế và ghi nhật ký.  
  >    - Gọi `GET /api/v1/cameras/:id/health-logs` xem bảng audit trail sức khỏe camera theo thời gian.  
  >    - Gọi `PUT /api/v1/cameras/:id` đổi trạng thái sang `MAINTENANCE` và ping lại để chứng minh trạng thái bảo trì được bảo toàn nguyên vẹn.  
  > 2) **Minh chứng qua Traefik Gateway**: Mở Traefik Dashboard (:8080) chỉ rõ router `cameras` đang active với priority 100 trỏ tới service `:8892`; đồng thời trên response headers chỉ ra sự hiện diện của `X-Gateway: Traefik-v3` và `X-Request-Id: UUIDv7` do Gateway tự động inject."*

---

## 🛡️ 6. CHUYÊN ĐỀ SÂU: 5 CÂU HỎI VẤN ĐÁP TỪ MODULE INCIDENT MANAGEMENT (TASK BE-06)

### 🔹 Câu 28 (Task BE-06: `incident.service.ts`): Incident State Machine & Trách nhiệm giải trình khi DISMISSED
* **Câu hỏi**: *"Tại sao khi bác bỏ sự cố (`DISMISSED` / False Alarm), hệ thống bắt buộc nhập `reason` tối thiểu 3 ký tự, còn khi `CONFIRMED` thì lại là tùy chọn? Khi sự cố đã `CLOSED` hoặc `DISMISSED` thì có được chỉnh sửa hay đính kèm bằng chứng nữa không?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Trách nhiệm giải trình & MLOps Feedback**: Bác bỏ một vi phạm an toàn là quyết định nhạy cảm. Bắt buộc nhập lý do (tối thiểu 3 ký tự) để chống việc cán bộ an toàn lơ là bỏ qua vi phạm thật mà không giải trình, đồng thời lý do này là nhãn dữ liệu quan trọng phục vụ phân loại mẫu khó (Hard Negatives) cho huấn luyện lại AI. Khi xác nhận (CONFIRMED), hệ thống tự gán lý do mặc định.  
  > 2) **Tính đóng băng bất biến (Immutability)**: Khi sự cố đã CLOSED hoặc DISMISSED, Service chặn toàn bộ các thao tác chỉnh sửa, gán thêm bằng chứng hoặc phân công (ném lỗi 400), bảo toàn tính toàn vẹn pháp lý của hồ sơ thanh tra."*

---

### 🔹 Câu 29 (Task BE-06: `incident.repository.ts`): Xử lý BigInt Serialization & Atomicity trong Repository
* **Câu hỏi**: *"Tại sao trong `incident.repository.ts` em phải viết hàm `serializeEvidence` ép kiểu `fileSize` từ `bigint` sang `Number`? Và tại sao `transitionStatus` phải bọc trong `db.$transaction`?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Khắc phục lỗi BigInt Serialization của V8 Engine**: Trong PostgreSQL, cột `file_size` có kiểu BIGINT (8 bytes) và Prisma map sang kiểu native `BigInt` của JavaScript. `JSON.stringify` mặc định không thể parse `BigInt` và sẽ ném lỗi runtime `TypeError: Do not know how to serialize a BigInt`, gây sập response 500 nếu không serialize về Number an toàn.  
  > 2) **Tính nguyên tử (Atomicity & Audit Trail)**: Cập nhật trạng thái sự cố và ghi nhật ký `incident_status_history` phải nằm trong cùng 1 transaction nguyên tử. Nếu không dùng transaction, giả sử update status thành công nhưng ghi log history bị crash/lỗi mạng, hệ thống sẽ bị mất vết kiểm toán (Audit Trail) - không ai biết ai đã đổi trạng thái, khi nào và vì lý do gì, vi phạm tiêu chuẩn bảo mật dữ liệu."*

---

### 🔹 Câu 30 (Task BE-06: `incident.server.ts`): Dual-Mounting Microservice & 3-Step Graceful Shutdown
* **Câu hỏi**: *"Tại sao Incident Service vừa có `incident.server.ts` chạy cổng 8893, vừa được mount vào Monolith? Cơ chế Graceful Shutdown hoạt động ra sao?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Triển khai linh hoạt theo Strangler Fig**: Dual-Mounting giúp dự án linh hoạt tối đa — khi dev local hoặc máy ít RAM có thể chạy monolithic `pnpm dev` (:8888) gọn nhẹ không tốn tài nguyên; khi triển khai Docker/Traefik hoặc production có thể chạy tách process độc lập (:8893) để chịu tải cao mà không phải sửa code nghiệp vụ.  
  > 2) **Graceful Shutdown 3 bước chuẩn công nghiệp**: Khi nhận SIGTERM, server đóng `closeIdleConnections()`, dừng nhận request mới, hoàn tất các request đang dang dở, ngắt kết nối `incidentPrisma.$disconnect()` và có watchdog timer 10s để ép thoát nếu bị treo, chống rò rỉ kết nối và mất mát dữ liệu."*

---

### 🔹 Câu 31 (Task BE-06: `incident.service.ts`): Zero-Latency Evidence Access Logging & Chống Path Traversal
* **Câu hỏi**: *"Tại sao việc ghi log `logEvidenceAccess` khi xem bằng chứng lại chạy bất đồng bộ fire-and-forget? Và tại sao `storageKey` phải kiểm tra cấm `..`?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Tối ưu độ trễ (Zero Latency Impact)**: Ghi vết truy cập bằng chứng (Audit Access Log) là tác vụ phụ trợ (side-effect). Việc gọi fire-and-forget không `await` giúp API trả URL bằng chứng về cho client ngay lập tức (tiết kiệm 10-20ms DB roundtrip), bảo đảm trải nghiệm xem mượt mà; nếu ghi log lỗi thì chỉ log warn, không làm crash request xem ảnh của người dùng.  
  > 2) **Chống Path Traversal (CWE-22)**: Chặn `..` trong `storageKey` ngăn chặn attacker truyền các đường dẫn tương đối độc hại như `../../etc/passwd` hoặc trỏ vượt ra ngoài bucket/thư mục bằng chứng được chỉ định khi backend sinh Presigned URL hoặc đọc file từ MinIO/ổ cứng cục bộ."*

---

### 🔹 Câu 32 (Task BE-06: Live Demo Incident Lifecycle): Kịch bản Demo 2 phút trên Swagger UI
* **Câu hỏi**: *"Hãy trình bày kịch bản Live Demo 2 phút trên Swagger UI để chứng minh trọn vẹn vòng đời xử lý sự cố từ PENDING_REVIEW -> CONFIRMED -> RESOLVED -> CLOSED?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Hội đồng, em xin demo trực tiếp luồng 4 bước chuẩn trên Swagger UI (`/api/docs`):  
  > 1. **Tạo sự cố**: Gọi `POST /api/v1/incidents` tạo vi phạm `NO_HELMET` kèm ảnh bằng chứng; hệ thống tự gán `PENDING_REVIEW` và sinh bản ghi audit đầu tiên trong `statusHistory`.  
  > 2. **Human Review**: Đăng nhập tài khoản `officer@ppe.local` (SAFETY_OFFICER) gọi `POST /incidents/{id}/review` với `decision: 'CONFIRMED'`.  
  > 3. **Xử lý vi phạm**: Gọi `POST /incidents/{id}/resolve` với `resolutionNote`, hệ thống gán `resolvedAt` và chuyển sang `RESOLVED`.  
  > 4. **Đóng sự cố**: Gọi `POST /incidents/{id}/close` đưa về `CLOSED`; sau đó gọi thử API sửa thông tin để chứng minh hệ thống chặn 400 bảo vệ tính bất biến của hồ sơ."*

---

## 🔒 7. CHUYÊN ĐỀ SÂU: 5 CÂU HỎI VẤN ĐÁP TỪ MODULE EVIDENCE STORAGE (TASK BE-07)

### 🔹 Câu 33 (Task BE-07: `evidence-storage.service.ts`): Presigned Upload PUT URL vs Direct Multipart Upload
* **Câu hỏi**: *"Tại sao em thiết kế cả 2 phương thức tải bằng chứng: Cấp Presigned PUT URL (`requestEvidenceUploadUrl`) và Tải trực tiếp Multipart (`uploadEvidenceDirect`)? Presigned URL giải quyết bài toán nghẽn cổ chai I/O và RAM của Backend như thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Presigned Upload URL (Tối ưu tải trọng)**: AI Edge / Client tải trực tiếp video clip hoặc ảnh lớn thẳng lên MinIO/S3 mà KHÔNG đi qua Backend. Việc này giúp Backend giảm 100% băng thông I/O và RAM, tránh nghẽn cổ chai khi hàng chục camera cùng gửi video cùng lúc.  
  > 2) **Direct Multipart Upload (Tiện ích & Fallback)**: Dùng cho các client không hỗ trợ gọi 2 bước (ví dụ: upload nhanh từ Web Admin hoặc thiết bị di động), Backend tự động dùng Sharp trích xuất kích thước ảnh (width, height), tính SHA-256 Checksum và lưu CSDL trong 1 request duy nhất. Hệ thống hỗ trợ cả 2 để vừa tối ưu hiệu năng vừa linh hoạt cho tích hợp."*

---

### 🔹 Câu 34 (Task BE-07: `evidence-storage.service.ts`): Streaming SHA-256 Checksum (Chống OOM) & crypto.timingSafeEqual
* **Câu hỏi**: *"Tại sao khi tính toán SHA-256 từ Object Storage, em lại đọc qua Stream (`for await chunk`) thay vì nạp toàn bộ tệp vào Buffer RAM? Và tại sao khi so khớp mã băm lại dùng `crypto.timingSafeEqual` thay vì toán tử `===`?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Chống tràn bộ nhớ RAM (OOM Crash)**: Các video clip vi phạm có thể lên tới hàng trăm MB hoặc GB. Nếu nạp toàn bộ vào RAM Buffer, nhiều request đồng thời sẽ gây tràn Heap bộ nhớ của Node.js (Out-Of-Memory) làm sập container. Xử lý qua Stream (`for await chunk`) giúp bộ nhớ tiêu thụ luôn cố định O(1) (vài chục KB) bất kể dung lượng file.  
  > 2) **Chống tấn công Timing Attack**: Toán tử `===` dừng ngay ở ký tự sai đầu tiên, khiến thời gian so sánh chênh lệch và có thể bị hacker đo đạc để đoán chuỗi hash. `crypto.timingSafeEqual` so sánh với thời gian hằng số (Constant Time), bảo đảm chuẩn an toàn mật mã học."*

---

### 🔹 Câu 35 (Task BE-07: `evidence-storage.service.ts`): Tiêu đề ResponseContentDisposition chuẩn RFC 5987 & Chống Double-Logging
* **Câu hỏi**: *"Trong `getPresignedDownloadUrl`, tiêu đề `ResponseContentDisposition` với `inline` vs `attachment` và `filename*=UTF-8` giải quyết bài toán gì cho UX và tên file tiếng Việt? Tại sao trong Service em cố tình không truyền `actorId` vào `getEvidenceById` trước khi ghi log DOWNLOAD?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Chuẩn hóa hiển thị & Tên file tiếng Việt**: Nếu dùng link S3 trần, trình duyệt sẽ tự động ép tải file về (attachment) hoặc hiện tên UUID ngẫu nhiên khó hiểu. Cấu hình RFC 5987 (`inline` vs `attachment` và `filename*=UTF-8`) giúp: khi Giám sát viên muốn xem trước trên Web Dashboard thì ảnh/clip hiển thị trực tiếp trong thẻ `<img>`/`<video>`, khi bấm Tải về thì lưu đúng tên file tiếng Việt có dấu.  
  > 2) **Chống ghi đúp log truy vết (Double Logging Guard)**: Hàm `getEvidenceById` mặc định tự ghi log `VIEW` nếu có `actorId`. Khi người dùng thực hiện hành động `DOWNLOAD`, nếu truyền `actorId` vào `getEvidenceById` thì hệ thống sẽ ghi 2 bản ghi log liên tiếp (`VIEW` rồi `DOWNLOAD`), làm sai lệch số liệu thống kê truy vết thanh tra."*

---

### 🔹 Câu 36 (Task BE-07: `evidence-storage.service.ts`): Thẩm định Tính toàn vẹn Pháp lý (verify-checksum) & Xóa tệp vật lý S3
* **Câu hỏi**: *"Endpoint `GET /api/v1/evidences/:id/verify-checksum` hoạt động như thế nào để chứng minh trước cơ quan thanh tra rằng bằng chứng không bị can thiệp? Khi xóa một bằng chứng (`DELETE /evidences/:id`), hệ thống giải quyết rác lưu trữ (Orphan Objects) trên MinIO ra sao?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Quy trình xác thực toàn vẹn**: Khi gọi `GET /evidences/:id/verify-checksum`, Backend tải trực tiếp tệp từ MinIO/S3 qua stream, tính toán lại mã SHA-256 thực tế (`actualChecksum`), rồi so khớp bằng `crypto.timingSafeEqual` với mã `expectedChecksum` đã được băm bất biến ngay lúc AI ghi nhận sự cố. API trả về `{ isValid: true/false, actualChecksum, expectedChecksum, verifiedAt }` chứng minh bằng chứng số còn nguyên bản.  
  > 2) **Dọn dẹp tệp vật lý đồng bộ**: Khi xóa bằng chứng, Service xóa bản ghi trong CSDL `ppe_incident_db` đồng thời gọi `storage.deleteObject(storageKey)` để xóa tệp vật lý trên MinIO S3, triệt tiêu hoàn toàn rác file mồ côi (Orphan Objects)."*

---

### 🔹 Câu 37 (Task BE-07: Live Demo Evidence Storage): Kịch bản Demo 2 phút Bằng chứng số & Checksum
* **Câu hỏi**: *"Hãy trình bày kịch bản Live Demo 2 phút trên Swagger UI để chứng minh: 1) Tải lên bằng chứng có băm SHA-256, 2) Lấy link xem trước an toàn có log truy vết, và 3) Thẩm định tính toàn vẹn (verify-checksum) trước Hội đồng?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Hội đồng, em xin demo luồng 3 bước thực chiến trên Swagger UI (`/api/docs`):  
  > 1. **Tải lên có băm mật mã**: Gọi `POST /api/v1/evidences/direct-upload` (hoặc `POST /upload-url`), tải tệp ảnh vi phạm; hệ thống tự dùng Sharp đo đạc (width, height), băm SHA-256 Checksum, lưu MinIO và CSDL.  
  > 2. **Xem trước & Truy vết**: Gọi `GET /evidences/{id}/download-url?action=VIEW`, mở URL vừa nhận trên tab mới để xem ảnh trực tiếp (inline); đồng thời kiểm tra bảng `evidence_access_logs` cho thấy hệ thống đã tự động ghi log VIEW.  
  > 3. **Thẩm định pháp lý**: Gọi `GET /evidences/{id}/verify-checksum`, hệ thống đọc stream từ MinIO, băm lại và trả về `isValid: true` cùng thời điểm `verifiedAt`, chứng minh bằng chứng số toàn vẹn 100% trước hội đồng."*

---

## 📢 8. CHUYÊN ĐỀ SÂU: 5 CÂU HỎI VẤN ĐÁP TỪ MODULE NOTIFICATION & REALTIME SSE (TASK BE-08)

### 🔹 Câu 38 (Task BE-08: `notification.service.ts`): Phân luồng Cảnh báo Đa kênh & Ma trận Trọng số Nghiêm trọng (Chống Alert Fatigue)
* **Câu hỏi**: *"Trong môi trường công trường thực tế, hệ thống camera AI có thể phát hiện hàng trăm vi phạm mỗi ngày. Nếu thông báo được bắn liên tục, cán bộ an toàn sẽ gặp hiện tượng 'Alert Fatigue' (kiệt quệ cảnh báo, spam email) dẫn đến bỏ sót các tai nạn nguy kịch. Em đã thiết kế kiến trúc phân luồng cảnh báo đa kênh và cơ chế lọc ngưỡng nghiêm trọng trong Notification Service như thế nào để khắc phục triệt để vấn đề này?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Ma trận trọng số độ nghiêm trọng (`SEVERITY_WEIGHT`)**: Em định lượng các cấp độ cảnh báo thành số nguyên so sánh được: `LOW: 1, NORMAL: 2, MEDIUM: 2, HIGH: 3, CRITICAL: 4`.  
  > 2) **Phân tầng đa kênh (Multi-channel Tiering)**:  
  >    - **Kênh thời gian thực In-App SSE**: Mặc định nhận ngưỡng từ `LOW` trở lên để hiển thị trực quan ngay lập tức trên màn hình giám sát trực ban mà không gây ồn ào hay tốn chi phí.  
  >    - **Kênh ngoại vi tốn kém & dễ gây phiền (Email/Zalo/Webhook)**: Mặc định chỉ kích hoạt khi mức độ đạt từ `HIGH` hoặc `CRITICAL` (ví dụ: vi phạm không mũ bảo hiểm trong vùng nguy hiểm cao hoặc xâm nhập vùng cấm nguy hiểm tính mạng).  
  > 3) **Tùy biến theo Cán bộ (`NotificationPreference`)**: Mỗi giám sát viên có thể tự cấu hình ngưỡng `minSeverity` riêng cho từng kênh tùy theo ca trực và vị trí phụ trách.  
  > 4) **Lọc từ nguồn AI Pipeline**: Ở tầng Rule Engine (Site Service) đã thiết lập `cooldownDuration` (30s) và `confirmationDuration` (2s) để dập tắt vi phạm ảo ngay tại biên trước khi chuyển vào luồng thông báo."*

---

### 🔹 Câu 39 (Task BE-08: `notification.controller.ts`): Bắt tay SSE An toàn qua Short-Lived Stream Ticket (RFC-Compliant)
* **Câu hỏi**: *"Khi triển khai SSE (Server-Sent Events) đẩy cảnh báo thời gian thực về browser, API chuẩn `EventSource` không hỗ trợ custom header `Authorization: Bearer <token>`. Nếu truyền Access Token thẳng lên Query Param (`?token=...`), rủi ro bảo mật là gì và em đã giải quyết bài toán Handshake SSE an toàn này như thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Rủi ro rò rỉ token khi truyền URL Query Param**: Việc đưa JWT Access Token dài hạn vào query string khiến token bị lưu dạng văn bản rõ (plaintext) trong Access Log của Traefik Reverse Proxy, lịch sử duyệt web (browser history), header Referer, và các hệ thống CDN/Logging trung gian. Bất kỳ ai có quyền xem log đều có thể chiếm quyền tài khoản.  
  > 2) **Giải pháp Short-Lived Stream Ticket**:  
  >    - **Bước 1**: Trình duyệt gọi `POST /api/v1/notifications/stream-ticket` mang theo `Authorization: Bearer <access_token>` chuẩn mực.  
  >    - **Bước 2**: Backend xác thực danh tính và cấp phát một vé tạm thời (`JWT_PURPOSE.SSE_STREAM_TICKET`) có hạn dùng cực ngắn (60 giây), ký bằng secret riêng và chỉ chứa `userId`.  
  >    - **Bước 3**: Trình duyệt dùng `new EventSource('/api/v1/notifications/stream?ticket=' + ticket)` để mở luồng kết nối `text/event-stream`.  
  >    - **Bước 4**: Backend chỉ chấp nhận token có đúng mục đích `SSE_STREAM_TICKET`. Dù URL có bị ghi log thì ticket này cũng hết hạn sau 60s và hoàn toàn không có quyền gọi bất kỳ REST API nghiệp vụ nào khác."*

---

### 🔹 Câu 40 (Task BE-08: `notification.repository.ts`): Triệt tiêu Lỗi N+1 Query & Safe Fallback Default Preferences
* **Câu hỏi**: *"Khi một sự cố nguy hiểm xảy ra ở công trường lớn có hàng chục cán bộ an toàn phụ trách, làm thế nào hệ thống của em giải quyết bài toán hiệu năng tránh N+1 Query khi đọc cấu hình thông báo (`NotificationPreference`)? Trường hợp cán bộ mới chưa từng cài đặt preference thì hệ thống xử lý như thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Triệt tiêu N+1 Query bằng Batching**: Khi cần thông báo cho N cán bộ, em tuyệt đối không chạy vòng lặp gọi `findUnique` N lần. Thay vào đó, em thiết kế `findPreferencesByUserIds(userIds)` dùng toán tử SQL `WHERE userId IN (...)` gom tất cả vào đúng 1 câu query duy nhất đến database.  
  > 2) **Tra cứu in-memory O(1)**: Kết quả truy vấn được map vào một bảng băm `Map<string, NotificationPreference>` trên RAM để tra cứu cấu hình theo `userId` với độ phức tạp $O(1)$.  
  > 3) **Pattern Safe Fallback**: Đối với các cán bộ mới chưa từng tạo bản ghi cấu hình, hệ thống không bỏ rơi người dùng mà tự động fallback về hằng số `DEFAULT_PREFERENCES` (In-App: LOW, Email: HIGH). Cách làm này đảm bảo không phát sinh bản ghi rác trong CSDL mà mọi cán bộ vẫn luôn nhận được cảnh báo bảo vệ an toàn."*

---

### 🔹 Câu 41 (Task BE-08: `incident.service.ts` & `notification-dispatcher.service.ts`): Cô lập Lỗi (Fault Isolation) & Luồng Bất đồng bộ Non-blocking
* **Câu hỏi**: *"Giả sử máy chủ gửi Mail (SMTP/SendGrid) bị mất mạng hoặc timeout kéo dài 10-15 giây, sự cố an toàn lao động (Incident) vừa được camera AI phát hiện có bị ảnh hưởng hoặc rollback không? Em đã thiết kế kiến trúc cô lập lỗi (Fault Isolation) giữa Incident Service và Notification Service như thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Độc lập tính toàn vẹn (Zero Rollback)**: Bản ghi sự cố và bằng chứng số mang tính pháp lý tuyệt đối KHÔNG bao giờ bị hủy hoặc rollback vì lỗi của các dịch vụ bên ngoài. Sự cố được lưu thành công vào CSDL `ppe_incident_db` trước tiên.  
  > 2) **Cô lập lỗi (Fault Isolation)**: Lệnh kích hoạt thông báo được tách biệt hoàn toàn ra khỏi transaction ghi nhận sự cố. `IncidentService` gọi `NotificationDispatcherService` theo cơ chế Non-blocking có khối `try...catch` bọc ngoài độc lập; nếu việc gửi email hay SSE thất bại, hệ thống chỉ ghi log `warn/error` mà không throw ngoại lệ làm gián đoạn API của Incident.  
  > 3) **Quản lý trạng thái (`EMAIL_STATUS`)**: Mọi email gửi đi được theo dõi bằng trạng thái `PENDING`, `SENT`, `FAILED`. Các email thất bại do sự cố mạng tạm thời có thể được quét lại bởi cơ chế Retry Worker mà không làm treo luồng tiếp nhận sự cố thời gian thực."*

---

### 🔹 Câu 42 (Task BE-08: Live Demo Notification & SSE): Kịch bản Demo 2 phút trên Swagger UI & Trình duyệt
* **Câu hỏi**: *"Trong 2 phút thuyết trình đồ án, em sẽ thiết kế kịch bản Live Demo như thế nào để chứng minh trực quan toàn bộ sức mạnh của Notification Service (từ bắt tay SSE bằng Stream Ticket, đẩy thông báo thời gian thực, đến kiểm tra hộp thư thông báo) ngay trên giao diện Swagger/Browser?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Hội đồng, em xin demo luồng 4 bước liên hoàn trong 2 phút trên Swagger UI (`/api/docs`) và trình duyệt:  
  > 1. **Cấp Stream Ticket**: Đăng nhập tài khoản `officer@ppe.local` (Safety Officer), gọi `POST /api/v1/notifications/stream-ticket` để nhận Ticket tạm thời có hiệu lực 60 giây.  
  > 2. **Mở kênh lắng nghe SSE**: Mở tab trình duyệt mới truy cập `GET /api/v1/notifications/stream?ticket=<ticket>`, màn hình hiển thị kết nối `text/event-stream` sống và nhận sự kiện `connected` với `clientId`.  
  > 3. **Mô phỏng vi phạm tức thời**: Tại tab Incident trên Swagger, gọi `POST /api/v1/incidents` tạo vi phạm `NO_HELMET` mức độ `HIGH`. Ngay lập tức tab SSE bên cạnh nhận được gói tin JSON `incident_notification` thời gian thực mà không cần tải lại trang.  
  > 4. **Quản lý Inbox & Đánh dấu đã đọc**: Gọi `GET /api/v1/notifications/my` để thấy thông báo mới trong hòm thư, sau đó gọi `PATCH /api/v1/notifications/{id}/read` để cập nhật trạng thái `READ`, chứng minh quy trình khép kín hoàn hảo từ lúc phát hiện đến lúc cán bộ an toàn xử lý."*

---

## ⚙️ 9. CHUYÊN ĐỀ SÂU: 5 CÂU HỎI VẤN ĐÁP TỪ MODULE SAFETY RULE & AI CONFIG ENGINE (TASK BE-10)

### 🔹 Câu 43 (Task BE-10: `safety-rule.service.ts`): Thứ bậc Phân giải Cấu hình An toàn 3 Cấp (Hierarchical Resolution)
* **Câu hỏi**: *"Trong một đại công trường, các vị trí đặt camera có mức độ rủi ro rất khác nhau (ví dụ: camera hố móng sâu cần độ nhạy cao và thời gian xác nhận vi phạm nhanh, trong khi camera cổng ra vào chỉ cần mức cảnh báo thông thường). Em đã thiết kế thứ bậc phân giải cấu hình an toàn (Hierarchical Configuration Resolution) như thế nào giữa Camera Override, Site Level và System Default? API cung cấp cho cụm AI Edge nhận biết nguồn cấu hình ra sao?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô, em thiết kế cơ chế phân giải cấu hình thứ bậc 3 cấp (3-Tier Hierarchical Resolution) chặt chẽ:  
  > 1) **Cấp 1 (Ưu tiên cao nhất - `CAMERA_OVERRIDE`)**: Cấu hình ghi đè riêng cho từng camera (nằm tại `CameraConfig`), áp dụng cho các vị trí nguy hiểm đặc thù hoặc góc quay nhạy cảm cần tinh chỉnh ngưỡng riêng.  
  > 2) **Cấp 2 (`SITE_LEVEL`)**: Cấu hình an toàn chung của toàn bộ công trường (`SiteSafetyConfig`) do Ban chỉ huy công trường thiết lập cho toàn thể cán bộ công nhân viên.  
  > 3) **Cấp 3 (Hạ tầng an toàn - `SYSTEM_DEFAULT`)**: Hằng số an toàn mặc định của hệ thống (`confidence: 0.8, confirmation: 2s, cooldown: 30s`) đảm bảo camera luôn có cấu hình vận hành ngay cả khi cán bộ chưa kịp thiết lập.  
  > API `GET /effective` tự động gom và đối soát từ trên xuống dưới, trả về cấu hình hiệu dụng cuối cùng kèm trường `source` (`CAMERA_OVERRIDE` | `SITE_LEVEL` | `SYSTEM_DEFAULT`) để AI Edge biết chính xác nguồn gốc áp dụng."*

---

### 🔹 Câu 44 (Task BE-10: `safety-rule.service.ts`): Tích hợp Toàn diện Ngữ cảnh AI (AI Model Version & Vùng cấm Polygon)
* **Câu hỏi**: *"Đối với cụm xử lý AI biên (AI Edge Inferencing), việc nhận diện vi phạm đòi hỏi đồng thời: Ngưỡng lọc vi phạm, Metadata phiên bản mô hình AI (YOLO/TensorRT classes) và Tọa độ đa giác vùng cấm (Restricted Area Polygons). Tại sao em lại gom trọn vẹn các thông tin này vào một phản hồi duy nhất của `GET /safety-rules/effective`? Em kiểm soát tính toàn vẹn của Model Version như thế nào?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô, việc tích hợp toàn bộ vào một API duy nhất (`GET /safety-rules/effective`) giải quyết 3 bài toán trọng yếu của AI Pipeline:  
  > 1) **Tính nhất quán nguyên tử (Atomic Snapshot)**: Cụm AI Edge nhận trọn vẹn ngữ cảnh thực thi (ngưỡng an toàn, đa giác vùng cấm theo Zone/Site, và metadata mô hình AI như `inputResolution`, `classes`) tại cùng một thời điểm, triệt tiêu `race-condition` giữa cấu hình và mô hình.  
  > 2) **Tối ưu hóa độ trễ kết nối biên**: Loại bỏ `Network Chatter`, AI Edge chỉ cần 1 HTTP round-trip duy nhất khi khởi động hoặc reconnect luồng RTSP.  
  > 3) **Thẩm định toàn vẹn Model**: Hệ thống bắt buộc `modelVersionId` phải tồn tại và đang kích hoạt (`isActive: true`) trong CSDL; nếu phiên bản mô hình bị vô hiệu hóa hoặc không hợp lệ, hệ thống từ chối cập nhật ngay từ tầng Service (trả về 404 NOT_FOUND)."*

---

### 🔹 Câu 45 (Task BE-10: `safety-rule-cache.service.ts`): Cấu trúc In-Memory Cache Phân cấp & Xóa Cache Bậc thang (Cascading Invalidation)
* **Câu hỏi**: *"Tại sao việc lưu cache cấu hình an toàn hiệu dụng lại cần thiết cho cụm AI? Em đã thiết kế cấu trúc Cache Key và cơ chế Xóa cache bậc thang (Cascading Invalidation) như thế nào khi cấu hình ở cấp độ Công trường (Site) thay đổi để ngăn chặn triệt để hiện tượng dữ liệu cũ (Stale Cache) trên các camera con?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Sự cần thiết của Cache**: Cụm AI Edge liên tục truy vấn cấu hình hiệu dụng khi khởi động lại luồng stream hoặc kiểm tra định kỳ; việc cache trên RAM (`SafetyRuleCacheService`) giúp phản hồi dưới 1ms, loại bỏ hoàn toàn tải truy vấn đa bảng (Site, Camera, AIModel, RestrictedArea) lên cơ sở dữ liệu.  
  > 2) **Cấu trúc Cache Key phân cấp (Hierarchical Keying)**: `effective:site:{siteId}` cho cấu hình chung và `effective:site:{siteId}:camera:{cameraId}` cho từng camera.  
  > 3) **Cascading Invalidation**: Khi cập nhật cấu hình Site, hàm `invalidateSite(siteId)` xóa sạch cả key của site lẫn toàn bộ các key có tiền tố `effective:site:{siteId}:camera:*`. Nhờ đó, mọi camera đang kế thừa cấu hình từ công trường lập tức được làm mới (Cache Busting) mà không bao giờ bị lưu dữ liệu cũ (Stale Cache). Ngược lại, khi cập nhật camera riêng lẻ, `invalidateCamera` chỉ xóa đúng cache của camera đó nhằm bảo toàn hiệu năng tối đa."*

---

### 🔹 Câu 46 (Task BE-10: `safety-rule.validation.ts`): Phòng thủ Biên Giới hạn (Zod Limits) & Cơ chế Hủy Ghi đè (Nullable Overrides)
* **Câu hỏi**: *"Tại sao trong Zod Schema, em lại khống chế chặt chẽ giới hạn ngưỡng tin cậy 'confidenceThreshold' trong đoạn [0.01, 0.99] thay vì cho phép nhập 0 hoặc 1.0? Việc hỗ trợ giá trị 'null' trong Camera Safety Config giải quyết bài toán nghiệp vụ gì khi quản lý thiết bị?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Thầy/Cô:  
  > 1) **Giới hạn [0.01, 0.99] (Defense-in-depth)**: Trong mạng nơ-ron nhận diện ảnh, đầu ra Softmax/Sigmoid hiếm khi đạt 1.0 tuyệt đối. Nếu đặt ngưỡng bằng 1.0, hệ thống sẽ bị 'mù' hoàn toàn (bỏ sót 100% tai nạn). Ngược lại nếu đặt bằng 0, mọi nhiễu hình ảnh đều biến thành vi phạm gây bão cảnh báo làm sập hàng đợi. Do đó, Zod Schema khóa cứng ngưỡng trong khoảng `[0.01, 0.99]`, thời gian xác nhận `[1, 60]` giây và thời gian cooldown `[5, 300]` giây.  
  > 2) **Cơ chế Nullable Overrides**: Khi cập nhật cấu hình camera, việc truyền `null` cho một trường cụ thể (hoặc gọi `DELETE /cameras/:id/safety-config`) cho phép người dùng hủy bỏ ghi đè trường đó để camera tự động quay về kế thừa (revert to inherit) giá trị từ Công trường (Site-level) mà không phải nhập lại dữ liệu thủ công, đồng thời có Audit Trail ghi nhận đầy đủ."*

---

### 🔹 Câu 47 (Task BE-10: Live Demo Safety Rule): Kịch bản Live Demo 2 phút luồng Safety Rule & Phân giải Hiệu dụng trên Swagger UI
* **Câu hỏi**: *"Em hãy trình bày kịch bản Live Demo 2 phút trên Swagger UI để chứng minh: Cơ chế phân giải thứ bậc (Effective Resolution), Ghi đè từng phần cho Camera (Partial Override), Tự động xóa Cache thời gian thực và Khôi phục kế thừa khi hủy ghi đè?"*
* **Câu trả lời chuẩn**:
  > *"Dạ thưa Hội đồng, em xin demo kịch bản 4 bước thực chiến trong 2 phút trên Swagger UI (`/api/docs`):  
  > 1. **Truy vấn kế thừa ban đầu**: Gọi `GET /api/v1/safety-rules/effective?cameraId={camId}`, chỉ ra trường `source: 'SITE_LEVEL'` kèm ngưỡng mặc định (0.8), danh sách đa giác vùng cấm `restrictedAreas` và `modelVersion` hợp lệ.  
  > 2. **Thực hiện Partial Override**: Gọi `PUT /api/v1/safety-rules/cameras/{camId}` cập nhật `{ confidenceThreshold: 0.92, enableNoVest: false }`. Swagger trả về 200, tự động bust cache và ghi nhận Audit Log.  
  > 3. **Kiểm chứng phân giải tức thời**: Gọi lại `GET /effective?cameraId={camId}`, hệ thống trả về `source: 'CAMERA_OVERRIDE'` với ngưỡng 0.92 mới nhưng vẫn giữ nguyên các quy tắc không bị override (như `enableNoHelmet: true`) từ Site, chứng minh cơ chế ghi đè từng phần hoạt động hoàn hảo.  
  > 4. **Xóa override & Tự phục hồi**: Gọi `DELETE /api/v1/safety-rules/cameras/{camId}`, truy vấn lại `GET /effective` thấy cấu hình lập tức hoàn nguyên về `SITE_LEVEL` ban đầu mà không hề dính Stale Cache."*

---

## 🛠️ 10. CHECKLIST CHUẨN BỊ TRƯỚC GIỜ BẢO VỆ

- [ ] **Môi trường máy tính**:
  - Đã nạp sẵn Docker images (`postgres:16-alpine`, `confluentinc/cp-kafka:7.5.0`, `provectuslabs/kafka-ui`, `minio/minio`).
  - Kiểm tra các cổng không bị xung đột: Postgres (5433), Kafka (9092), Kafka UI (8088), MinIO (9000 / 9001), API Gateway Traefik (80/443), Monolith App API (9999), Site Service (8891), Camera Service (8892), Incident Service (8893), Notification Service (8894).
- [ ] **Tài khoản Demo chuẩn PPE (Database Seeded)**:
  - `admin@ppe.local` / `Admin@123456` (`ADMIN`)
  - `manager@ppe.local` / `Manager@123456` (`SAFETY_MANAGER`)
  - `officer@ppe.local` / `Officer@123456` (`SAFETY_OFFICER`)
- [ ] **Tài liệu & Trình duyệt chuẩn bị sẵn các tab**:
  - Tab 1: Slide thuyết trình (Canva / PowerPoint).
  - Tab 2: Swagger UI (`http://localhost:8888/api/docs` hoặc cổng `app-api` :9999).
  - Tab 3: Kafka UI (`http://localhost:8088` - sẵn sàng ở topic `ppe.violation.detected`).
  - Tab 4: MinIO Console (`http://localhost:9001` - bucket `ppe-evidences`).
  - Tab 5: Traefik Dashboard (`http://localhost:8080` - routers & services status).
- [ ] **Terminal chuẩn bị sẵn**:
  - Cửa sổ 1: Đang chạy `docker compose -f docker-compose.infra.yml ps`.
  - Cửa sổ 2: Thư mục dự án sẵn sàng gõ `pnpm test`.


