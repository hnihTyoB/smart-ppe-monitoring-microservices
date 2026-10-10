-- Migration: 20261011032000_add_notification_full_text_search_gin_index
-- Description: Thêm chỉ mục GIN (Generalized Inverted Index) phục vụ tối ưu hóa PostgreSQL Full-Text Search cho bảng notifications (title, content)

-- 1. Create GIN index for Full-Text Search on notifications table (title, content)
CREATE INDEX IF NOT EXISTS "idx_notifications_fts" ON "notifications" USING gin (
    to_tsvector('simple', coalesce("title", '') || ' ' || coalesce("content", ''))
);
