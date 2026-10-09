# CẨM NANG TOÀN DIỆN: CHIẾN LƯỢC BẢO VỆ ĐỒ ÁN TỐT NGHIỆP
## Đề tài: Hệ thống Giám sát An toàn Lao động Thông minh (Smart PPE Monitoring System)
### Kiến trúc: Microservices & Event-Driven Architecture (Chuẩn Tài liệu D08 & Tasks BE-03, BE-04)

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

## 🔥 4. CHUYÊN ĐỀ MỚI: 6 CÂU HỎI VẤN ĐÁP TRỰC TIẾP TỪ CÁC FILE VỪA TRIỂN KHAI (TASK BE-03 & BE-04)

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

## 🛠️ 5. CHECKLIST CHUẨN BỊ TRƯỚC GIỜ BẢO VỆ

- [ ] **Môi trường máy tính**:
  - Đã nạp sẵn Docker images (`postgres:16-alpine`, `confluentinc/cp-kafka:7.5.0`, `provectuslabs/kafka-ui`, `minio/minio`).
  - Kiểm tra các cổng không bị xung đột: Postgres (5433), Kafka (9092), Kafka UI (8088), MinIO (9000 / 9001), API Gateway Traefik (80/443), Monolith App API (9999), Site Service (8891).
- [ ] **Tài liệu & Trình duyệt chuẩn bị sẵn các tab**:
  - Tab 1: Slide thuyết trình (Canva / PowerPoint).
  - Tab 2: Swagger UI (`http://localhost:8888/api/docs` hoặc cổng `app-api` :9999).
  - Tab 3: Kafka UI (`http://localhost:8088` - sẵn sàng ở topic `ppe.violation.detected`).
  - Tab 4: MinIO Console (`http://localhost:9001` - bucket `ppe-evidence`).
- [ ] **Terminal chuẩn bị sẵn**:
  - Cửa sổ 1: Đang chạy `docker compose -f docker-compose.infra.yml ps`.
  - Cửa sổ 2: Thư mục dự án sẵn sàng gõ `pnpm test`.
