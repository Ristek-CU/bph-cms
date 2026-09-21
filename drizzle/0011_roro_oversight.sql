-- Oversight Roro (RORO-OVERSIGHT): jejak aktivitas + error + upaya prompt-injection
-- per percakapan, dibaca lintas divisi oleh akun Ristek (allowlist email).
-- Terpisah dari audit_logs (yang mencatat aksi admin) — tabel ini mencatat
-- perilaku Roro secara operasional: tiap giliran chat, tool call, error LLM,
-- kuota habis, upaya injeksi prompt yang diblokir, dsb. Dipangkas 90 hari
-- (sama dengan audit_logs) oleh cron.
CREATE TABLE IF NOT EXISTS ai_events (
	id TEXT PRIMARY KEY,
	conversation_id TEXT,
	user_id TEXT,
	user_email TEXT,
	division_id TEXT,
	-- chat_turn | tool_use | proposal | confirm | error | llm_unavailable |
	-- injection_blocked | code_blocked | quota_exceeded | rescue | fake_call |
	-- promise_without_tool | flag
	event_type TEXT NOT NULL,
	-- info | warn | error
	level TEXT NOT NULL,
	message TEXT NOT NULL,
	metadata TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_events_user_idx ON ai_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS ai_events_type_idx ON ai_events (event_type, created_at);
CREATE INDEX IF NOT EXISTS ai_events_recent_idx ON ai_events (created_at);
CREATE INDEX IF NOT EXISTS ai_events_conv_idx ON ai_events (conversation_id, created_at);
