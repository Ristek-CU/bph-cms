import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api.js";
import { useToast } from "../components/ui.jsx";

// QPR v2 — tanpa login (model kejujuran). BPH kelola periode + roster nama;
// anggota buka link publik, pilih namanya dari dropdown, isi skala 1-5,
// submit → nama hilang dari daftar (tanda sudah isi).
const STATUS_LABEL = { draft: "Draft", open: "Berlangsung", closed: "Selesai" };

const PUBLIC_BASE = "https://cms.sga-cakrawala.org/#/qpr";

export default function Qpr({ user }) {
	const canManage = useMemo(() => user?.permissions?.includes("qpr.manage"), [user]);
	return canManage ? <AdminView /> : <NoManage />;
}

function NoManage() {
	// Non-BPH tidak kelola — pengisian lewat link publik, bukan panel.
	return (
		<div className="empty-state">
			<p>Kamu tidak punya akses kelola QPR. Buka link publik periode yang sedang berjalan untuk mengisi penilaian.</p>
			<p className="muted small">Contoh: {PUBLIC_BASE}/&lt;id-periode&gt;</p>
		</div>
	);
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
		const desc = window.prompt("Yang dinilai (mis. Menilai: Ketua Ristek) — boleh kosong:") ?? "";
		try {
			// Pertanyaan default sesuai PRD §4.3 — bisa diubah via PUT.
			await api("/admin/qpr/periods", {
				method: "POST",
				json: {
					title: title.trim(),
					description: desc.trim() || null,
					questions: [
						{ label: "Menyelesaikan tugas tepat waktu", category: "Kinerja" },
						{ label: "Berkolaborasi dengan baik", category: "Kolaborasi" },
						{ label: "Menunjukkan inisiatif", category: "Inisiatif" },
					],
				},
			});
			toast("Periode draft dibuat — tambahkan nama pengisi lalu buka.");
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

	const addEntries = async () => {
		const raw = window.prompt(
			"Nama pengisi (satu per baris; opsional tambah divisi):\nContoh:\nRaka Pratama | Ristek\nSinta Dewi | Ristek",
		);
		if (!raw?.trim()) return;
		const items = raw.trim().split("\n").map((line) => {
			const [name, division] = line.split("|").map((s) => s.trim());
			return { name, division: division || null };
		}).filter((a) => a.name);
		if (!items.length) { toast("Format tidak terbaca.", "err"); return; }
		await act(async () => {
			await api(`/admin/qpr/periods/${period.id}/entries`, { method: "POST", json: { entries: items } });
			setDetail(await api(`/admin/qpr/periods/${period.id}`));
		});
	};

	const copyLink = () => {
		const link = `${PUBLIC_BASE}/${period.id}`;
		navigator.clipboard?.writeText(link).then(
			() => toast("Link publik disalin — bagikan ke anggota."),
			() => toast("Tidak bisa menyalin link.", "err"),
		);
	};

	return (
		<div className="card">
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
				<div style={{ cursor: "pointer", minWidth: 0 }} onClick={toggle}>
					<strong>{period.title}</strong>
					<div className="muted small">
						{STATUS_LABEL[period.status] ?? period.status}
						{period.description ? ` · ${period.description}` : ""}
						{period.closes_at ? ` · tutup ${new Date(period.closes_at).toLocaleDateString("id-ID")}` : ""}
						{` · ${period.done_entries}/${period.total_entries} sudah isi`}
					</div>
				</div>
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
					<button className="btn ghost" disabled={busy} onClick={toggle}>{open ? "Tutup detail" : "Kelola"}</button>
					<button className="btn ghost" disabled={busy} onClick={showRecap}>Rekap</button>
					{period.status !== "draft" && (
						<button className="btn ghost" disabled={busy} onClick={copyLink}>Salin link</button>
					)}
					{period.status === "draft" && (
						<button className="btn" disabled={busy || period.total_entries === 0}
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
					<button className="btn ghost" disabled={busy} onClick={addEntries}>+ Tambah nama</button>
					<table className="tbl" style={{ marginTop: 8 }}>
						<thead><tr><th>Nama</th><th>Divisi</th><th>Status</th><th></th></tr></thead>
						<tbody>
							{detail.entries.map((e) => (
								<tr key={e.id}>
									<td>{e.name}</td>
									<td>{e.division || "—"}</td>
									<td>{e.done ? `Sudah isi${e.submitted_at ? ` · ${new Date(e.submitted_at).toLocaleString("id-ID")}` : ""}` : "Belum"}</td>
									<td>
										<button className="btn ghost" disabled={busy} onClick={() => {
											if (window.confirm("Hapus nama ini?")) act(() => api(`/admin/qpr/periods/${period.id}/entries/${e.id}`, { method: "DELETE" }));
										}}>Hapus</button>
									</td>
								</tr>
							))}
							{detail.entries.length === 0 && <tr><td colSpan={4} className="muted">Belum ada nama. Klik "+ Tambah nama".</td></tr>}
						</tbody>
					</table>
				</div>
			)}
			{open && recap && (
				<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
					<div className="muted small" style={{ marginBottom: 6 }}>
						Rekap — {recap.done_entries}/{recap.total_entries} sudah isi
						{recap.overall_average !== null ? ` · rata-rata keseluruhan ${recap.overall_average}` : ""}
					</div>
					{recap.pending.length > 0 && (
						<div className="small" style={{ marginBottom: 8 }}>
							<strong>Belum isi:</strong> {recap.pending.map((p) => p.name).join(", ")}
						</div>
					)}
					<table className="tbl">
						<thead><tr><th>Kategori</th><th>Rata-rata</th></tr></thead>
						<tbody>
							{Object.entries(recap.category_averages).map(([k, v]) => (
								<tr key={k}><td>{k}</td><td>{v}</td></tr>
							))}
							{Object.keys(recap.category_averages).length === 0 && <tr><td colSpan={2} className="muted">Belum ada penilaian masuk.</td></tr>}
						</tbody>
					</table>
					{recap.notes.length > 0 && (
						<div className="small" style={{ marginTop: 8 }}>
							<strong>Catatan:</strong>
							<ul style={{ margin: "4px 0 0 18px" }}>
								{recap.notes.map((n, i) => <li key={i}>{n}</li>)}
							</ul>
						</div>
					)}
					<button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setRecap(null)}>Tutup rekap</button>
				</div>
			)}
		</div>
	);
}

/** Halaman publik pengisian (no-login): dropdown nama + form skala 1-5. */
export function PublicFill({ periodId }) {
	const toast = useToast();
	const [roster, setRoster] = useState(null);
	const [err, setErr] = useState("");
	const [name, setName] = useState("");
	const [scores, setScores] = useState({});
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState(false);
	const [doneMsg, setDoneMsg] = useState("");

	useEffect(() => {
		if (!periodId) return;
		api(`/qpr/${periodId}`)
			.then((d) => { setRoster(d); setErr(""); })
			.catch((e) => setErr(e?.message || "Periode tidak ditemukan atau sudah ditutup."));
	}, [periodId]);

	const submit = async () => {
		if (!name) { toast("Pilih namamu dulu.", "err"); return; }
		const questions = roster.questions.filter((q) => !q.note_only);
		if (questions.some((q) => !scores[q.label])) { toast("Isi semua skala dulu.", "err"); return; }
		setBusy(true);
		try {
			const answers = questions.map((q) => ({ label: q.label, category: q.category, score: scores[q.label] }));
			if (note.trim()) answers.push({ label: "Catatan", category: "Catatan", score: 5, note: note.trim() });
			await api(`/qpr/${periodId}/submit`, { method: "POST", json: { name, answers } });
			setDoneMsg("Penilaian terkirim. Terima kasih!");
		} catch (e) {
			toast(errText(e), "err");
			// Nama mungkin sudah diisi orang lain — refresh roster.
			api(`/qpr/${periodId}`).then(setRoster).catch(() => {});
		} finally {
			setBusy(false);
		}
	};

	if (err) return <div className="card err-text">{err}</div>;
	if (doneMsg) return <div className="empty-state"><p>{doneMsg}</p></div>;
	if (!roster) return <div className="card muted">Memuat…</div>;

	const questions = roster.questions.filter((q) => !q.note_only);

	return (
		<div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
			<strong style={{ fontSize: 18 }}>{roster.title}</strong>
			{roster.description && <div className="muted small" style={{ marginTop: 2 }}>{roster.description}</div>}
			<div style={{ display: "grid", gap: 12, marginTop: 14 }}>
				<div>
					<label className="field-label" htmlFor="qpr-name">Namamu</label>
					<select id="qpr-name" value={name} onChange={(e) => setName(e.target.value)}>
						<option value="" disabled>Pilih namamu…</option>
						{roster.remaining.map((r) => (
							<option key={r.id} value={r.name}>{r.name}{r.division ? ` — ${r.division}` : ""}</option>
						))}
					</select>
					<div className="muted small" style={{ marginTop: 4 }}>{roster.remaining.length} orang belum mengisi</div>
				</div>
				{questions.map((q) => (
					<div key={q.label}>
						<div className="small" style={{ marginBottom: 4 }}><strong>{q.category}</strong> — {q.label}</div>
						<div style={{ display: "flex", gap: 6 }}>
							{[1, 2, 3, 4, 5].map((n) => (
								<label key={n} className="small" style={{ cursor: "pointer" }}>
									<input type="radio" name={`q_${q.label}`} checked={scores[q.label] === n}
										onChange={() => setScores((s) => ({ ...s, [q.label]: n }))} /> {n}
								</label>
							))}
						</div>
					</div>
				))}
				<div>
					<label className="field-label" htmlFor="qpr-note">Catatan (opsional)</label>
					<textarea id="qpr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
				</div>
				<div>
					<button className="btn" disabled={busy || !name} onClick={submit}>{busy ? "Mengirim…" : "Kirim penilaian"}</button>
				</div>
			</div>
		</div>
	);
}
