-- Deleted chats disappear from the user history immediately. Ristek can audit
-- them for 90 days; the scheduled cleanup then removes their messages too.
ALTER TABLE ai_conversations ADD COLUMN deleted_at TEXT;
CREATE INDEX ai_conversations_deleted_idx ON ai_conversations(deleted_at);
