-- Guard rules Roro (RORO-GUARD-ENGINE): aturan precheck di DB, bukan hardcode.
-- Ristek tambah/ubah pola blokir tanpa deploy. Engine baca saat chat (cache
-- in-memory 60 dtk per isolate). Kosong = fallback pola bawaan engine.
-- matches: substring (huruf besar/kecil tak penting) ATAU regex terbatas ^...$
CREATE TABLE IF NOT EXISTS ai_guard_rules (
	id TEXT PRIMARY KEY,
	-- injection | code
	category TEXT NOT NULL,
	-- pola: kalau diawali "re:" diperlakukan regex (satu baris, flag i),
	-- selain itu substring case-insensitive. Contoh seed ada di bawah.
	pattern TEXT NOT NULL,
	-- penjelasan singkat, tampil di oversight
	signal TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_guard_rules_cat_idx ON ai_guard_rules (category, enabled);

-- Seed: pola inti (setara hardcode lama, minus pola yang bikin false positive
-- produksi: "dan" polos, "lewat sini", "system/sistem" polos). OR IGNORE =
-- idempoten — aturan yang sudah diubah Ristek tidak ditimpa saat re-run.
INSERT OR IGNORE INTO ai_guard_rules (id, category, pattern, signal, enabled, created_at) VALUES
	('gr-01', 'injection', 're:\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|system|your)?\s*(instructions?|prompts?|rules?)\b', 'ignore-previous', 1, '2026-09-21T00:00:00Z'),
	('gr-02', 'injection', 're:\b(system\s*prompt|prompt\s*sistem|instruksi\s*sistem|hidden\s*prompt)\b', 'system-prompt-ref', 1, '2026-09-21T00:00:00Z'),
	('gr-03', 'injection', 're:\b(you\s+are\s+(now|actually)|kamu\s+sekarang\s+adalah|sekarang\s+kamu\s+adalah)\b', 'role-hijack', 1, '2026-09-21T00:00:00Z'),
	('gr-04', 'injection', 're:\b(act\s+as|berperilaku\s+sebagai|bermain\s+sebagai)\s+(a\s+)?(developer|programmer|coder|hacker|admin|root|terminal|shell)', 'act-as-dev', 1, '2026-09-21T00:00:00Z'),
	('gr-05', 'injection', 're:\b(jailbreak|do\s+anything\s+now|break\s+out|keluar\s+dari\s+aturan)\b', 'jailbreak', 1, '2026-09-21T00:00:00Z'),
	('gr-06', 'injection', 're:\bDAN\s+(?:mode|prompt|jailbreak)\b', 'jailbreak-dan', 1, '2026-09-21T00:00:00Z'),
	('gr-07', 'injection', 're:\b(reveal|show|tampilkan|tunjukkan|bocor)(kan)?\s+(your|kamu|the)?\s*(system\s*|hidden\s+)?(prompt|instructions?|system\s+aturan|aturan\s+sistem|instruksi\s+sistem)\b', 'reveal-prompt', 1, '2026-09-21T00:00:00Z'),
	('gr-08', 'injection', 're:\b(override|timpa|lewati|abaikan)\s+(aturan|rules|instructions|prompt|batasan|constraints)\b', 'override-rules', 1, '2026-09-21T00:00:00Z'),
	('gr-09', 'injection', 're:pretend\s+(you\s+(have|can|are)|that\s+there\s+are\s+no)', 'pretend-no-rules', 1, '2026-09-21T00:00:00Z'),
	('gr-10', 'injection', 're:\b(no\s+restrictions?|tanpa\s+batas|tanpa\s+aturan|unrestricted|no\s+rules)\b', 'no-restrictions', 1, '2026-09-21T00:00:00Z'),
	('gr-11', 'injection', 're:\b(exec(ute)?|run|jalankan|eval)\s+(arbitrary|code|perintah|command)\b', 'exec-code', 1, '2026-09-21T00:00:00Z'),
	('gr-12', 'injection', 're:\[?(SYSTEM|SISTEM|ADMIN|DEV)\]?\s*:', 'fake-system-prefix', 1, '2026-09-21T00:00:00Z'),
	('gr-13', 'injection', 're:sebagai\s+(sistem|admin|developer)\s+(kamu|harus|wajib|tolong|silakan)', 'fake-system-instr', 1, '2026-09-21T00:00:00Z'),
	('gr-14', 'code', 're:\b(m{0,2}buat(?:kan|in|ain)?|tulis|kerjakan|bikin|generate|berikan)\b[^\n]{0,40}\b(kode|code|skrip|script|function|fungsi|class|kelas|api|endpoint|component|komponen|python|javascript|typescript|php|java|html|css|react|rust|golang)\b', 'write-code', 1, '2026-09-21T00:00:00Z'),
	('gr-15', 'code', 're:\b(code|kode)\s+(untuk|buat|untuk\s+membuat|generate)', 'code-for', 1, '2026-09-21T00:00:00Z'),
	('gr-16', 'code', 're:\b(debug|perbaiki\s+(bug|error\s+kode|kodenya)|fix\s+the\s+(bug|code)|refactor)\b', 'debug-code', 1, '2026-09-21T00:00:00Z'),
	('gr-17', 'code', 're:\b(sql|query|database\s+schema|migrate|migrasi|migration)\s+(query|untuk|buat|generate|write)', 'sql-query', 1, '2026-09-21T00:00:00Z'),
	('gr-18', 'code', 're:\b(react|javascript|typescript|python|node\.?js|html|css|php|java|rust|go(?:lang)?)\b[^\n]{0,30}\b(kode|code|script|contoh|example|tutorial)', 'lang-code', 1, '2026-09-21T00:00:00Z'),
	('gr-19', 'code', 're:\b(hack|exploit|vulnerability|celah\s+keamanan|reverse\s+engineer|decompile)\b', 'security-attack', 1, '2026-09-21T00:00:00Z'),
	('gr-20', 'code', 're:\b(tuliskan\s+(saya\s+)?(?:sebuah|kode|code|program|fungsi|function))', 'write-code-id', 1, '2026-09-21T00:00:00Z'),
	('gr-21', 'code', 're:\b(jelaskan\s+(bagaimana|cara)\s+(cara\s+)?(menulis|membuat|mengeksekusi|menjalankan)\s+(kode|code|program|sql|script))', 'explain-code', 1, '2026-09-21T00:00:00Z'),
	('gr-22', 'code', 're:\b(explain\s+(how\s+to\s+write|the\s+code|this\s+(code|function)))\b', 'explain-code-en', 1, '2026-09-21T00:00:00Z'),
	('gr-23', 'code', 're:```[a-z]*', 'code-fence-request', 1, '2026-09-21T00:00:00Z'),
	('gr-24', 'code', 're:\b(kerjakan|selesaikan|bantu\s+task|bantu\s+kerjain)\s+(tugas|task|assignment|proyek|project)\b', 'do-assignment', 1, '2026-09-21T00:00:00Z');
