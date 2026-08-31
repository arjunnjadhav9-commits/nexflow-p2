-- Step 4 — Notifications (Phase 7)
-- Enables Realtime postgres_changes events for p2_notifications — required
-- for the navbar bell's live badge update on INSERT. Without this, the bell
-- still works fully (count/list/mark-read all query normally); it just won't
-- update live until the next page load.
ALTER PUBLICATION supabase_realtime ADD TABLE p2_notifications;
