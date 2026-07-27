-- Set REPLICA IDENTITY FULL so DELETE events in Realtime include ALL columns,
-- not just the primary key. This allows the chat_id filter on DELETE events
-- to work, so messages are removed in real-time without a reload.
ALTER TABLE messages REPLICA IDENTITY FULL;