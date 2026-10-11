-- Migration: 20261012011500_add_incident_violation_id_index
-- Description: Thêm chỉ mục B-tree cho trường violation_id trên bảng incidents phục vụ tra cứu khử trùng lặp Idempotency nhanh

CREATE INDEX IF NOT EXISTS "incidents_violation_id_idx" ON "incidents"("violation_id");
