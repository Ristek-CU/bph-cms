-- Internal Event (D-AK): agenda internal organisasi — rapat, koordinasi, pencatatan.
--
-- Tabel TERPISAH dari `events`, bukan kolom `visibility` di tabel yang sama.
-- Alasannya: `events` dibaca tiga jalur publik (publicEventService.list /
-- getBySlug / calendar) yang dikonsumsi sga-cakrawala.org. Satu filter yang
-- kelewat = agenda internal tampil ke mahasiswa. Tabel terpisah membuat
-- kebocoran itu mustahil secara struktur, bukan cuma secara disiplin.
--
-- Paritas kolom penuh dengan `events`, dengan SATU perbedaan disengaja:
-- division_id NOT NULL + ON DELETE RESTRICT. Di `events` kolomnya nullable
-- dengan ON DELETE SET NULL, dan kalender lintas divisi memakai INNER JOIN ke
-- divisions — akibatnya event yatim hilang diam-diam tanpa error. Internal
-- event wajib punya pemilik.
CREATE TABLE IF NOT EXISTS internal_events (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	description TEXT,
	cover_image_url TEXT,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	-- Cermin epoch ms dari starts_at/ends_at. String ISO ber-offset tidak bisa
	-- dibandingkan di SQL; kolom ms membuat filter/sort jadi satu perbandingan
	-- ter-index (alasan sama dengan events.starts_at_ms, PLAN.md D5).
	starts_at_ms INTEGER NOT NULL,
	ends_at_ms INTEGER NOT NULL,
	location TEXT NOT NULL,
	location_url TEXT,
	registration_url TEXT,
	registration_open INTEGER DEFAULT true NOT NULL,
	organizer TEXT,
	-- draft = privat divisi pemilik; published = terbaca semua pengurus SGA (K-2).
	-- "published" di sini TIDAK pernah berarti tampil di situs publik.
	status TEXT DEFAULT 'draft' NOT NULL,
	division_id TEXT NOT NULL REFERENCES divisions (id) ON DELETE RESTRICT,
	created_by_user_id TEXT,
	updated_by_user_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS internal_events_division_status_starts_idx
	ON internal_events (division_id, status, starts_at_ms);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS internal_events_status_starts_idx
	ON internal_events (status, starts_at_ms);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS internal_events_starts_at_idx ON internal_events (starts_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS internal_event_sessions (
	id TEXT PRIMARY KEY,
	internal_event_id TEXT NOT NULL REFERENCES internal_events (id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	starts_at TEXT NOT NULL,
	ends_at TEXT NOT NULL,
	starts_at_ms INTEGER NOT NULL,
	ends_at_ms INTEGER NOT NULL,
	speaker TEXT,
	location TEXT,
	description TEXT,
	sort_order INTEGER DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS internal_event_sessions_event_idx
	ON internal_event_sessions (internal_event_id, starts_at);
