-- ============================================================================
-- PPE MICROSERVICES: DATABASE-PER-SERVICE INITIALIZATION SCRIPT
-- ============================================================================
-- Script này được PostgreSQL container tự động thực thi khi khởi tạo lần đầu
-- thông qua thư mục /docker-entrypoint-initdb.d/.
--
-- Tạo 6 logical databases + 6 database users riêng biệt.
-- Áp dụng cô lập quyền truy cập (REVOKE CONNECT FROM PUBLIC) để đảm bảo
-- mỗi service chỉ kết nối được database thuộc quyền sở hữu của mình.
--
-- LƯU Ý:
-- - Passwords dưới đây là giá trị mặc định cho môi trường development.
-- - Trong production, sử dụng Docker secrets hoặc biến môi trường.
-- - Script chỉ chạy khi database chưa tồn tại (lần đầu khởi tạo volume).
--
-- [SECURITY] CREATEDB PRIVILEGE:
-- Mỗi service user được cấp CREATEDB để cho phép `prisma migrate dev` tạo
-- shadow database (yêu cầu của Prisma khi chạy migrate trong development).
-- ⚠️  DEV ONLY — Trong production, bỏ CREATEDB và sử dụng tài khoản riêng
-- có quyền superuser hoặc CREATEDB chỉ để chạy migration.
-- Tham khảo: https://www.prisma.io/docs/orm/prisma-migrate/workflows/shadow-database
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Identity / Auth Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_identity_user WITH PASSWORD 'ppe_identity_dev_pass' CREATEDB; -- [DEV ONLY] CREATEDB dùng cho prisma migrate dev shadow database
CREATE DATABASE ppe_identity_db OWNER ppe_identity_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_identity_db TO ppe_identity_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Site Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_site_user WITH PASSWORD 'ppe_site_dev_pass' CREATEDB; -- [DEV ONLY]
CREATE DATABASE ppe_site_db OWNER ppe_site_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_site_db TO ppe_site_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Camera Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_camera_user WITH PASSWORD 'ppe_camera_dev_pass' CREATEDB; -- [DEV ONLY]
CREATE DATABASE ppe_camera_db OWNER ppe_camera_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_camera_db TO ppe_camera_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Incident Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_incident_user WITH PASSWORD 'ppe_incident_dev_pass' CREATEDB; -- [DEV ONLY]
CREATE DATABASE ppe_incident_db OWNER ppe_incident_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_incident_db TO ppe_incident_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Notification Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_notification_user WITH PASSWORD 'ppe_notification_dev_pass' CREATEDB; -- [DEV ONLY]
CREATE DATABASE ppe_notification_db OWNER ppe_notification_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_notification_db TO ppe_notification_user;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Reporting Service
-- ────────────────────────────────────────────────────────────────────────────
CREATE USER ppe_reporting_user WITH PASSWORD 'ppe_reporting_dev_pass' CREATEDB; -- [DEV ONLY]
CREATE DATABASE ppe_reporting_db OWNER ppe_reporting_user;
GRANT ALL PRIVILEGES ON DATABASE ppe_reporting_db TO ppe_reporting_user;

-- ============================================================================
-- REVOKE CONNECT FROM PUBLIC: Ngăn cross-database access
-- ============================================================================
-- Mặc định PostgreSQL cho phép mọi user kết nối tới mọi database (qua role PUBLIC).
-- Revoke quyền này rồi chỉ grant lại cho user sở hữu từng database.
-- ============================================================================

REVOKE CONNECT ON DATABASE ppe_identity_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE ppe_site_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE ppe_camera_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE ppe_incident_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE ppe_notification_db FROM PUBLIC;
REVOKE CONNECT ON DATABASE ppe_reporting_db FROM PUBLIC;

GRANT CONNECT ON DATABASE ppe_identity_db TO ppe_identity_user;
GRANT CONNECT ON DATABASE ppe_site_db TO ppe_site_user;
GRANT CONNECT ON DATABASE ppe_camera_db TO ppe_camera_user;
GRANT CONNECT ON DATABASE ppe_incident_db TO ppe_incident_user;
GRANT CONNECT ON DATABASE ppe_notification_db TO ppe_notification_user;
GRANT CONNECT ON DATABASE ppe_reporting_db TO ppe_reporting_user;

-- ============================================================================
-- Kích hoạt uuid-ossp extension trên mỗi database (cho uuid_generate_v7)
-- ============================================================================
-- Cần kết nối vào từng database riêng để CREATE EXTENSION.
-- PostgreSQL init scripts chạy dưới quyền superuser (postgres) nên có thể dùng
-- \connect hoặc phương pháp ON DATABASE ... nhưng CREATE EXTENSION phải chạy
-- trong ngữ cảnh của database đích.
--
-- Với docker-entrypoint-initdb.d, sử dụng psql meta-command \c để chuyển database.
-- ============================================================================

\c ppe_identity_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\c ppe_site_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\c ppe_camera_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\c ppe_incident_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\c ppe_notification_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

\c ppe_reporting_db
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

