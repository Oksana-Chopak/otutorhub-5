-- ============================================================
-- DATA CLEANUP: Remove old data to free disk space
-- Runs once on migration, then scheduled cleanup via trigger
-- ============================================================

-- 1. Delete old read notifications (> 60 days)
DELETE FROM notifications
WHERE read = true
  AND created_at < NOW() - INTERVAL '60 days';

-- 2. Delete all notifications older than 90 days (read or not)
DELETE FROM notifications
WHERE created_at < NOW() - INTERVAL '90 days';

-- 3. Trim paywall_events — keep only last 90 days
-- (analytics data, not business-critical)
DELETE FROM paywall_events
WHERE created_at < NOW() - INTERVAL '90 days';

-- 4. Delete resolved lesson_change_requests older than 30 days
DELETE FROM lesson_change_requests
WHERE status IN ('approved', 'rejected', 'cancelled')
  AND created_at < NOW() - INTERVAL '30 days';

-- 5. Delete old resolved availability_requests (> 60 days)
DELETE FROM availability_requests
WHERE status IN ('approved', 'rejected')
  AND created_at < NOW() - INTERVAL '60 days';

-- 6. Clean up manager_audit_log older than 6 months
-- (keep recent for compliance, delete ancient logs)
DELETE FROM manager_audit_log
WHERE created_at < NOW() - INTERVAL '180 days';

-- 7. Auto-cleanup function for notifications (future inserts)
CREATE OR REPLACE FUNCTION cleanup_old_notifications()
RETURNS void LANGUAGE sql AS $$
  DELETE FROM notifications
  WHERE created_at < NOW() - INTERVAL '90 days';
  DELETE FROM notifications
  WHERE read = true AND created_at < NOW() - INTERVAL '30 days';
$$;

-- 8. VACUUM to reclaim disk space after deletions
-- (Supabase runs auto-vacuum, but this speeds it up)
VACUUM (ANALYZE) notifications;
VACUUM (ANALYZE) paywall_events;
