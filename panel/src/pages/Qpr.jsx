import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api.js";
import { useToast } from "../components/ui.jsx";

// QPR v1 (docs/QPR-PRD.md §5): skala 1-5 + catatan, penugasan manual,
// rekap rata-rata sederhana. Kelola khusus BPH (qpr.manage);
// semua user login bisa lihat penugasan miliknya (/qpr/my).
const STATUS_LABEL = { draft: "Draft", open: "Berlangsung", closed: "Selesai" };

export default function Qpr({ user }) {
	const canManage = useMemo(() => user?.permissions?.includes("qpr.manage"), [user]);
	return canManage ? <AdminView /> : <MyAssignments />;
}

function AdminView() {
	const toast = useToast();
	const [periods, setPeriods] = useState(null);
	const [err, setErr] = useState("");
	const [openId, setOpenId] = useState(null);

	const load = useCallback(async () => {
		try {
			setPeriods(await api("/admin/qpr/periods"));
			setErr("");
		} catch (e) {
			setErr(errText(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const createPeriod = async () => {
		const title = window.prompt("Judul periode (mis. Penilaian September 2026):");
		if (!title?.trim()) return;
		try {
			// Pertanyaan default sesuai PRD §4.3 — bisa diedit via API/put, UI editor menyusul.
			await api("/admin/qpr/periods", {
				method: "POST",
				json: {
					title: title.trim(),
					questions: [
						{ label: "Menyelesaikan tugas tepat waktu", category: "Kinerja" },
						{ label: "Berkolaborasi dengan baik", category: "Kolaborasi" },
						{ label: "Menunjukkan inisiatif", category: "Inisiatif" },
					],
				},
			});
			toast("Periode draft dibuat — klik Kelola untuk atur penugasan.");
			await load();
		} catch (e) {
			toast(errText(e), "err");
		}
	};

	return (
		<>
			{err && <div className="card err-text">{err}</div>}
			<div className="toolbar" style={{ marginBottom: 12 }}>
				<button className="btn gold" onClick={createPeriod}>+ Periode baru</button>
			</div>
			{periods === null ? (
				<div className="card muted">Memuat periode…</div>
			) : periods.length === 0 ? (
				<div className="empty-state"><p>Belum ada periode penilaian.</p></div>
			) : (
				<div className="card-list">
					{periods.map((p) => (
						<PeriodRow key={p.id} period={p} open={openId === p.id}
							onToggle={() => setOpenId(openId === p.id ? null : p.id)} onDone={load} toast={toast} />
					))}
				</div>
			)}
		</>
	);
}

function PeriodRow({ period, open, onToggle, onDone, toast }) {
	const [detail, setDetail] = useState(null);
	const [recap, setRecap] = useState(null);
	const [busy, setBusy] = useState(false);

	const act = async (fn) => {
		setBusy(true);
		try { await fn(); await onDone(); } catch (e) { toast(errText(e), "err"); } finally { setBusy(false); }
	};

	const toggle = async () => {
		onToggle();
		if (!open) {
			setDetail(null); setRecap(null);
			try { setDetail(await api(`/admin/qpr/periods/${period.id}`)); } catch (e) { toast(errText(e), "err"); }
		}
	};

	const showRecap = async () => {
		onToggle();
		if (!open) {
			setDetail(null);
			try { setRecap(await api(`/admin/qpr/periods/${period.id}/recap`)); } catch (e) { toast(errText(e), "err"); }
		}
	};

	const addAssignments = async () => {
		const raw = window.prompt(
			"Penugasan (satu per baris): email-penilai | Nama yang dinilai | Peran\nContoh:\nristek@cakrawala.com | Raka Pratama | Anggota Ristek",
		);
		if (!raw?.trim()) return;
		const items = raw.trim().split("\n").map((line) => {
			const [email, name, role] = line.split("|").map((s) => s.trim());
			return { reviewer_user_id: email, reviewer_email: email, reviewee_name: name, reviewee_role: role || null };
		}).filter((a) => a.reviewer_email && a.reviewee_name);
		if (!items.length) { toast("Format tidak terbaca.", "err"); return; }
		await act(async () => {
			await api(`/admin/qpr/periods/${period.id}/assignments`, { method: "POST", json: { assignments: items } });
			setDetail(await api(`/admin/qpr/periods/${period.id}`));
		});
	};

	return (
		<div className="card">
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
				<div style={{ cursor: "pointer", minWidth: 0 }} onClick={toggle}>
					<strong>{period.title}</strong>
					<div className="muted small">
						{STATUS_LABEL[period.status] ?? period.status}
						{period.opens_at ? ` · buka ${new Date(period.opens_at).toLocaleDateString("id-ID")}` : ""}
						{period.closes_at ? ` · tutup ${new Date(period.closes_at).toLocaleDateString("id-ID")}` : ""}
						{` · ${period.done_assignments}/${period.total_assignments} penugasan selesai`}
					</div>
				</div>
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
					<button className="btn ghost" disabled={busy} onClick={toggle}>{open ? "Tutup detail" : "Kelola"}</button>
					<button className="btn ghost" disabled={busy} onClick={showRecap}>Rekap</button>
					{period.status === "draft" && (
						<button className="btn" disabled={busy || period.total_assignments === 0}
							onClick={() => act(() => api(`/admin/qpr/periods/${period.id}/open`, { method: "POST" }))}>Buka</button>
					)}
					{period.status === "open" && (
						<button className="btn" disabled={busy} onClick={() => act(() => api(`/admin/qpr/periods/${period.id}/close`, { method: "POST" }))}>Tutup</button>
					)}
					<button className="btn ghost" disabled={busy} onClick={() => {
						if (window.confirm(`Hapus periode "${period.title}"?`)) act(() => api(`/admin/qpr/periods/${period.id}`, { method: "DELETE" }));
					}}>Hapus</button>
				</div>
			</div>
			{open && detail && (
				<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
					<div className="muted small" style={{ marginBottom: 6 }}>
						Pertanyaan: {detail.questions.map((q) => `${q.category} — ${q.label}`).join(" · ")}
					</div>
					<button className="btn ghost" disabled={busy} onClick={addAssignments}>+ Tambah penugasan</button>
					<table className="tbl" style={{ marginTop: 8 }}>
						<thead><tr><th>Penilai</th><th>Yang dinilai</th><th>Status</th><th></th></tr></thead>
						<tbody>
							{detail.assignments.map((a) => (
								<tr key={a.id}>
									<td>{a.reviewer_email}</td>
									<td>{a.revieweeName}{a.revieweeRole ? ` — ${a.revieweeRole}` : ""}</td>
									<td>{a.status === "done" ? "Selesai" : "Belum"}</td>
									<td>
										<button className="btn ghost" disabled={busy} onClick={() => {
											if (window.confirm("Hapus penugasan ini?")) act(() => api(`/admin/qpr/periods/${period.id}/assignments/${a.id}`, { method: "DELETE" }));
										}}>Hapus</button>
									</td>
								</tr>
							))}
							{detail.assignments.length === 0 && <tr><td colSpan={4} className="muted">Belum ada penugasan.</td></tr>}
						</tbody>
					</table>
				</div>
			)}
			{open && recap && (
				<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
					<div className="muted small" style={{ marginBottom: 6 }}>Rekap — {recap.total_responses} respons masuk</div>
					<table className="tbl">
						<thead><tr><th>Nama</th><th>Rata-rata</th><th>Per kategori</th><th>Catatan</th></tr></thead>
						<tbody>
							{recap.reviewees.map((r) => (
								<tr key={r.reviewee_name}>
									<td>{r.reviewee_name}</td>
									<td>{r.average ?? "—"}</td>
									<td className="small">{Object.entries(r.categories).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</td>
									<td className="small">{r.notes.join(" | ") || "—"}</td>
								</tr>
							))}
							{recap.reviewees.length === 0 && <tr><td colSpan={4} className="muted">Belum ada penilaian masuk.</td></tr>}
						</tbody>
					</table>
					<button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setRecap(null)}>Tutup rekap</button>
				</div>
			)}
		</div>
	);
}

/** Tampilan pengisi: penugasan milik user login + form penilaian skala 1-5. */
export function MyAssignments() {
	const toast = useToast();
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");
	const [filling, setFilling] = useState(null); // assignment aktif
	const [scores, setScores] = useState({});
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			setRows(await api("/admin/qpr/my"));
			setErr("");
		} catch (e) {
			setErr(errText(e));
		}
	}, []);
	useEffect(() => { load(); }, [load]);

	const submit = async () => {
		setBusy(true);
		try {
			const answers = filling.questions
				.filter((q) => !q.note_only)
				.map((q) => ({ label: q.label, category: q.category, score: scores[q.label] }));
			if (answers.some((a) => !a.score)) { toast("Isi semua skala dulu.", "err"); setBusy(false); return; }
			if (note.trim()) answers.push({ label: "Catatan", category: "Catatan", score: 5, note: note.trim() });
			await api(`/admin/qpr/assignments/${filling.id}/submit`, { method: "POST", json: { answers } });
			toast("Penilaian terkirim.");
			setFilling(null); setScores({}); setNote("");
			await load();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	if (err) return <div className="card err-text">{err}</div>;
	if (rows === null) return <div className="card muted">Memuat penugasan…</div>;
	if (rows.length === 0) return <div className="empty-state"><p>Tidak ada penugasan penilaian untuk kamu.</p></div>;

	const isOpen = (r) => r.periodStatus === "open";

	return (
		<div className="card-list">
			{rows.map((r) => (
				<div key={r.id} className="card">
					<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
						<div>
							<strong>{r.revieweeName}</strong>
							<div className="muted small">{r.periodTitle} · {r.revieweeRole || ""} · {isOpen(r) ? "periode terbuka" : "periode tidak terbuka"}</div>
						</div>
						<div className="muted small">{r.status === "done" ? "Selesai ✓ (boleh revisi)" : "Belum dinilai"}</div>
					</div>
					{filling?.id === r.id ? (
						<div style={{ marginTop: 10, display: "grid", gap: 10 }}>
							{r.questions.filter((q) => !q.note_only).map((q) => (
								<div key={q.label}>
									<div className="small" style={{ marginBottom: 4 }}><strong>{q.category}</strong> — {q.label}</div>
									<div style={{ display: "flex", gap: 6 }}>
										{[1, 2, 3, 4, 5].map((n) => (
											<label key={n} className="small" style={{ cursor: "pointer" }}>
												<input type="radio" name={`q_${r.id}_${q.label}`} checked={scores[q.label] === n}
													onChange={() => setScores((s) => ({ ...s, [q.label]: n }))} /> {n}
											</label>
										))}
									</div>
								</div>
							))}
							<textarea rows={2} placeholder="Catatan untuk yang dinilai (opsional)" value={note} onChange={(e) => setNote(e.target.value)} />
							<div style={{ display: "flex", gap: 6 }}>
								<button className="btn" disabled={busy} onClick={submit}>Kirim penilaian</button>
								<button className="btn ghost" disabled={busy} onClick={() => setFilling(null)}>Batal</button>
							</div>
						</div>
					) : (
						isOpen(r) && (
							<button className="btn ghost" style={{ marginTop: 8 }} onClick={() => { setFilling(r); setScores({}); setNote(""); }}>
								{r.status === "done" ? "Revisi" : "Nilai"}
							</button>
						)
					)}
				</div>
			))}
		</div>
	);
}
