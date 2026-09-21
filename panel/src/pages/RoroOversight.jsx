import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api.js";
import { useToast, SkeletonCard, ErrorState, Confirm } from "../components/ui.jsx";

// Oversight Roro — dashboard khusus akun Ristek untuk audit penggunaan Roro
// lintas divisi: statistik real-time, daftar percakapan, jejak event/error,
// dan breakdown penggunaan per user. Backend di-gate RORO_OVERSIGHT_EMAILS.

const LEVEL_BADGE = {
	info: "ok",
	warn: "warn",
	error: "err",
};

const TYPE_LABEL = {
	chat_turn: "Giliran chat",
	tool_use: "Tool dipanggil",
	proposal: "Proposal dibuat",
	confirm: "Proposal dikonfirmasi",
	error: "Error",
	llm_unavailable: "LLM tidak tersedia",
	injection_blocked: "Injeksi diblokir",
	code_blocked: "Permintaan kode diblokir",
	quota_exceeded: "Kuota habis",
	rescue: "Tool-call teks di-rescue",
	fake_call: "Panggilan tool palsu",
	promise_without_tool: "Janji tanpa tool",
	flag: "Ditandai Ristek",
};

const fmtRel = (iso) => {
	if (!iso) return "—";
	const d = new Date(iso);
	const diff = Date.now() - d.getTime();
	if (diff < 60_000) return "baru saja";
	if (diff < 3600_000) return `${Math.floor(diff / 60_000)} mnt lalu`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} jam lalu`;
	return d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};
const fmtTime = (iso) => {
	if (!iso) return "—";
	return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

function StatCard({ label, value, hint, tone }) {
	return (
		<div className={`card stat-card ${tone ? `tone-${tone}` : ""}`}>
			<div className="stat-value">{value}</div>
			<div className="stat-label">{label}</div>
			{hint && <div className="stat-hint muted small">{hint}</div>}
		</div>
	);
}

export default function RoroOversight() {
	const [tab, setTab] = useState("feed");
	const [stats, setStats] = useState(null);
	const [statsErr, setStatsErr] = useState("");

	const loadStats = useCallback(async () => {
		setStatsErr("");
		try {
			setStats(await api("/admin/assistant/oversight/stats"));
		} catch (e) {
			setStatsErr(errText(e));
		}
	}, []);
	useEffect(() => {
		loadStats();
		// Auto-refresh ringan tiap 30 dtk untuk nuansa real-time (tanpa WebSocket).
		const t = setInterval(loadStats, 30_000);
		return () => clearInterval(t);
	}, [loadStats]);

	if (statsErr) return <ErrorState title="Oversight belum bisa dimuat" message={statsErr} onRetry={loadStats} />;
	if (!stats) return <SkeletonCard lines={4} />;

	return (
		<>
			<div className="page-intro">
				<h2>Pantau Roro, real-time.</h2>
				<p>Audit penggunaan Roro lintas divisi — lihat percakapan, jejak aktivitas, error, dan upaya injeksi yang diblokir. Update otomatis tiap 30 detik.</p>
			</div>

			<div className="stats-grid">
				<StatCard label="Percakapan" value={stats.conversations} tone="info" />
				<StatCard label="Total pesan" value={stats.messages} />
				<StatCard label="Chat hari ini" value={stats.chats_today} tone="info" hint={`Bulan ini: ${stats.chats_month}`} />
				<StatCard label="Token hari ini" value={fmtTokens(stats.tokens_today)} hint={`Bulan ini: ${fmtTokens(stats.tokens_month)}`} />
				<StatCard label="Event hari ini" value={stats.events_today} tone="info" hint={`Total event: ${stats.events}`} />
				<StatCard label="Error" value={stats.errors} tone={stats.errors > 0 ? "err" : ""} />
				<StatCard label="Injeksi diblokir" value={stats.injections_blocked} tone={stats.injections_blocked > 0 ? "warn" : ""} />
				<StatCard label="Permintaan kode diblokir" value={stats.code_blocked} tone={stats.code_blocked > 0 ? "warn" : ""} />
			</div>

			<div className="toolbar" aria-label="Bagian oversight Roro">
				{[["feed", "Jejak real-time"], ["conversations", "Percakapan"], ["usage", "Penggunaan"]].map(([id, label]) => (
					<button key={id} className={`chip ${tab === id ? "active" : ""}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
				))}
			</div>

			{tab === "feed" && <EventsTab />}
			{tab === "conversations" && <ConversationsTab />}
			{tab === "usage" && <UsageTab />}
		</>
	);
}

const fmtTokens = (t) => {
	const { input, output } = t || { input: 0, output: 0 };
	const tot = input + output;
	if (tot >= 1_000_000) return `${(tot / 1_000_000).toFixed(1)}M`;
	if (tot >= 1000) return `${(tot / 1000).toFixed(1)}k`;
	return String(tot);
};

function EventsTab() {
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");
	const [filter, setFilter] = useState("");
	const [page, setPage] = useState(1);

	const load = useCallback(async () => {
		setErr("");
		try {
			const params = new URLSearchParams();
			if (filter) params.set("level", filter);
			params.set("limit", "50");
			params.set("page", String(page));
			const data = await api(`/admin/assistant/oversight/events?${params}`);
			setRows(Array.isArray(data) ? data : data?.items || []);
		} catch (e) {
			setErr(errText(e));
		}
	}, [filter, page]);
	useEffect(() => {
		load();
	}, [load]);
	// Auto-refresh tiap 15 dtk untuk nuansa real-time.
	useEffect(() => {
		const t = setInterval(load, 15_000);
		return () => clearInterval(t);
	}, [load]);

	if (err) return <ErrorState message={err} onRetry={load} />;
	if (rows === null) return <SkeletonCard lines={5} />;

	return (
		<div className="card">
			<div className="events-toolbar">
				<h3>Jejak aktivitas &amp; error</h3>
				<select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} aria-label="Filter level">
					<option value="">Semua level</option>
					<option value="error">Error</option>
					<option value="warn">Peringatan</option>
					<option value="info">Info</option>
				</select>
				<button className="btn ghost" onClick={load}>Segarkan</button>
			</div>
			{rows.length === 0 ? (
				<p className="muted">Belum ada jejak aktivitas. Kirim pesan ke Roro dari akun mana pun untuk melihat event muncul di sini.</p>
			) : (
				<ul className="event-list">
					{rows.map((e) => (
						<li key={e.id} className={`event-row level-${e.level}`}>
							<div className="event-time">{fmtTime(e.created_at)}</div>
							<div className="event-body">
								<span className={`badge ${LEVEL_BADGE[e.level] ?? ""}`}>{TYPE_LABEL[e.event_type] ?? e.event_type}</span>
								<span className="event-msg">{e.message}</span>
								{e.user_email && <span className="muted small event-actor">· {e.user_email}{e.division_name ? ` (${e.division_name})` : ""}</span>}
							</div>
							<div className="event-rel">{fmtRel(e.created_at)}</div>
						</li>
					))}
				</ul>
			)}
			{rows.length > 0 && (
				<div className="pager">
					<button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Sebelumnya</button>
					<span className="muted small">Hal. {page}</span>
					<button className="btn ghost" disabled={rows.length < 50} onClick={() => setPage((p) => p + 1)}>Berikutnya</button>
				</div>
			)}
		</div>
	);
}

function ConversationsTab() {
	const toast = useToast();
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [meta, setMeta] = useState({ total: 0, per_page: 25 });
	const [detail, setDetail] = useState(null);
	const [detailErr, setDetailErr] = useState("");
	const [flagOpen, setFlagOpen] = useState(false);
	const [flagNote, setFlagNote] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		setErr("");
		try {
			const params = new URLSearchParams();
			if (search) params.set("q", search);
			params.set("page", String(page));
			params.set("per_page", "25");
			const data = await api(`/admin/assistant/oversight/conversations?${params}`);
			setRows(data.items || []);
			setMeta(data.meta || { total: 0, per_page: 25 });
		} catch (e) {
			setErr(errText(e));
		}
	}, [search, page]);
	useEffect(() => {
		load();
	}, [load]);

	const openDetail = async (id) => {
		setDetailErr("");
		setDetail(null);
		try {
			setDetail(await api(`/admin/assistant/oversight/conversations/${id}`));
		} catch (e) {
			setDetailErr(errText(e));
		}
	};

	const submitFlag = async () => {
		if (!detail || !flagNote.trim()) return;
		setBusy(true);
		try {
			await api(`/admin/assistant/oversight/conversations/${detail.conversation.id}/flag`, { method: "POST", json: { note: flagNote.trim() } });
			toast("Percakapan ditandai untuk ditindak.");
			setFlagOpen(false);
			setFlagNote("");
			await openDetail(detail.conversation.id);
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	if (err) return <ErrorState message={err} onRetry={load} />;
	if (rows === null) return <SkeletonCard lines={5} />;

	return (
		<div className="grid-2">
			<div className="card">
				<div className="events-toolbar">
					<h3>Percakapan lintas divisi</h3>
					<input placeholder="Cari judul/email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Cari percakapan" />
				</div>
				{rows.length === 0 ? (
					<p className="muted">Belum ada percakapan.</p>
				) : (
					<ul className="conv-list">
						{rows.map((c) => (
							<li key={c.id}>
								<button className={`conv-row ${detail?.conversation?.id === c.id ? "active" : ""}`} onClick={() => openDetail(c.id)}>
									<div className="conv-title">{c.title || "(tanpa judul)"}</div>
									<div className="conv-meta muted small">
										{c.user_email || "user"} · {c.division_name || "—"} · {c.message_count} pesan · {fmtRel(c.updated_at)}
									</div>
								</button>
							</li>
						))}
					</ul>
				)}
				<div className="pager">
					<button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Sebelumnya</button>
					<span className="muted small">{meta.total} total · Hal. {page}</span>
					<button className="btn ghost" disabled={rows.length < meta.per_page} onClick={() => setPage((p) => p + 1)}>Berikutnya</button>
				</div>
			</div>

			<div className="card">
				{detailErr ? (
					<ErrorState message={detailErr} onRetry={() => detail && openDetail(detail.conversation.id)} />
				) : !detail ? (
					<p className="muted">Pilih percakapan di kiri untuk membaca isi pesan + jejak event-nya.</p>
				) : (
					<>
						<div className="conv-detail-head">
							<div>
								<h3 style={{ marginBottom: 4 }}>{detail.conversation.title}</h3>
								<p className="muted small">{detail.conversation.user_email || "user"} · {detail.conversation.division_name || "—"} · {detail.messages.length} pesan</p>
							</div>
							<button className="btn ghost" onClick={() => { setFlagOpen(true); setFlagNote(""); }}>Tandai</button>
						</div>
						<div className="conv-messages">
							{detail.messages.map((m) => (
								<div key={m.id} className={`msg msg-${m.role}`}>
									<div className="msg-role">{m.role === "user" ? "User" : "Roro"}{m.proposal_status ? ` · ${m.proposal_status}` : ""}{m.tool_name ? ` · ${m.tool_name}` : ""}</div>
									<div className="msg-content">{m.content}</div>
								</div>
							))}
						</div>
						<h4 style={{ marginTop: 14, marginBottom: 6 }}>Jejak event ({detail.events.length})</h4>
						{detail.events.length === 0 ? (
							<p className="muted small">Tidak ada event tercatat untuk percakapan ini.</p>
						) : (
							<ul className="event-list compact">
								{detail.events.map((e) => (
									<li key={e.id} className={`event-row level-${e.level}`}>
										<div className="event-time">{fmtTime(e.created_at)}</div>
										<div className="event-body">
											<span className={`badge ${LEVEL_BADGE[e.level] ?? ""}`}>{TYPE_LABEL[e.event_type] ?? e.event_type}</span>
											<span className="event-msg">{e.message}</span>
										</div>
									</li>
								))}
							</ul>
						)}
					</>
				)}
			</div>

			<Confirm
				open={flagOpen}
				title="Tandai percakapan untuk ditindak"
				confirmLabel={busy ? "Menyimpan…" : "Tandai"}
				onConfirm={submitFlag}
				onCancel={() => setFlagOpen(false)}
			>
				<p className="muted small" style={{ marginBottom: 8 }}>Catatan akan tercatat sebagai event "flag" untuk audit Ristek.</p>
				<textarea value={flagNote} onChange={(e) => setFlagNote(e.target.value)} placeholder="Mis. percakapan menunjukkan Roro halusinasi data — perlu diperbaiki prompt-nya" rows={3} maxLength={500} style={{ width: "100%" }} />
			</Confirm>
		</div>
	);
}

function UsageTab() {
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");

	const load = useCallback(async () => {
		setErr("");
		try {
			setRows(await api("/admin/assistant/oversight/usage"));
		} catch (e) {
			setErr(errText(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	if (err) return <ErrorState message={err} onRetry={load} />;
	if (!rows) return <SkeletonCard lines={5} />;

	const maxReq = Math.max(1, ...rows.map((r) => r.requests));
	return (
		<div className="card">
			<h3 style={{ marginBottom: 10 }}>Penggunaan Roro per user (bulan ini)</h3>
			{rows.length === 0 ? (
				<p className="muted">Belum ada penggunaan tercatat bulan ini.</p>
			) : (
				<ul className="usage-list">
					{rows.map((r) => (
						<li key={r.user_id} className="usage-row">
							<div className="usage-meta">
								<strong>{r.user_email || r.user_id}</strong>
								<span className="muted small">{r.division_name || "—"}</span>
							</div>
							<div className="usage-bar">
								<div className="usage-bar-fill" style={{ width: `${(r.requests / maxReq) * 100}%` }} />
							</div>
							<div className="usage-nums">
								<span><strong>{r.requests}</strong> chat</span>
								<span className="muted small">{fmtTokens({ input: r.input_tokens, output: r.output_tokens })} tok</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}