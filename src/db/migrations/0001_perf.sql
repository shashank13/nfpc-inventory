-- Performance tuning (see comments in src/db/schema.ts).
-- Trigram matching for the stock-list and activity-log search indexes.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
DROP INDEX "idx_sessions_expires";--> statement-breakpoint
DROP INDEX "idx_audit_created";--> statement-breakpoint
DROP INDEX "idx_audit_cat";--> statement-breakpoint
DROP INDEX "idx_audit_user";--> statement-breakpoint
DROP INDEX "idx_products_recent";--> statement-breakpoint
DROP INDEX "idx_moves_created";--> statement-breakpoint
CREATE INDEX "idx_audit_search" ON "audit_log" USING gin ((target || chr(1) || detail || chr(1) || username || chr(1) || via || chr(1) || event || chr(1) || ip) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_products_search" ON "products" USING gin ((name || chr(1) || sku::text || chr(1) || batch_no || chr(1) || grade || chr(1) || sourced_from || chr(1) || location) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_audit_created" ON "audit_log" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "idx_audit_cat" ON "audit_log" USING btree ("category","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_log" USING btree ("username","created_at");--> statement-breakpoint
CREATE INDEX "idx_products_recent" ON "products" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "idx_moves_created" ON "stock_movements" USING btree ("created_at","qty_change");--> statement-breakpoint
-- Leave free space in each page so frequent updates (stock changes, session refreshes) can be
-- written in place (HOT updates) instead of creating new row versions and index entries.
ALTER TABLE "products" SET (fillfactor = 90);--> statement-breakpoint
ALTER TABLE "sessions" SET (fillfactor = 70);--> statement-breakpoint
ALTER TABLE "users" SET (fillfactor = 90);
