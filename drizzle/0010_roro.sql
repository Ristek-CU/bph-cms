-- Roro AI assistant (RORO-PLAN.md §3.2): percakapan per akun + memori + kuota.
CREATE TABLE ai_conversations (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT 'Percakapan baru',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (user_id, updated_at);

CREATE TABLE ai_messages (
	id TEXT PRIMARY KEY,
	conversation_id TEXT NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
	-- 'user' | 'assistant'
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	-- Draf tool tulis yang menunggu konfirmasi (create_event/create_form).
	proposal_json TEXT,
	-- 'pending' | 'executed' | 'rejected' | NULL
	proposal_status TEXT,
	tool_name TEXT,
	result_resource_id TEXT,
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, created_at);

-- Memori markdown per akun (RORO-PLAN.md §3.5).
CREATE TABLE ai_memories (
	user_id TEXT PRIMARY KEY,
	memory_md TEXT NOT NULL DEFAULT '',
	updated_at TEXT NOT NULL
);

-- Pelacak kuota per user per hari (RORO-PLAN.md §3.6).
CREATE TABLE ai_usage (
	user_id TEXT NOT NULL,
	day TEXT NOT NULL,
	requests INTEGER NOT NULL DEFAULT 0,
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, day)
);
