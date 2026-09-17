import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText } from "../api.js";
import { useToast, Confirm, SkeletonCard, Card, copyText } from "../components/ui.jsx";

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
	const [showCreate, setShowCreate] = useState(false);

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

	return (
		<>
			{err && <div className="card err-text">{err}</div>}
			<div className="toolbar" style={{ marginBottom: 12 }}>
				<button className="btn gold" onClick={() => setShowCreate(true)}>+ Periode baru</button>
			</div>
			{periods === null ? (
				<SkeletonCard />
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
			<CreatePeriodModal open={showCreate} onClose={() => setShowCreate(false)} onDone={load} toast={toast} />
		</>
	);
}

/** Modal buat periode — pertanyaan default PRD §4.3, bisa diubah via PUT nanti. */
function CreatePeriodModal({ open, onClose, onDone, toast }) {
	const [title, setTitle] = useState("");
	const [desc, setDesc] = useState("");
	const [busy, setBusy] = useState(false);
	if (!open) return null;

	const submit = async (e) => {
		e.preventDefault();
		setBusy(true);
		try {
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
			setTitle(""); setDesc("");
			onClose();
			await onDone();
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Periode baru">
				<h3>Periode baru</h3>
				<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
					<div>
						<label className="field-label" htmlFor="qp-title">Judul periode</label>
						<input id="qp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Penilaian September 2026" required maxLength={160} />
					</div>
					<div>
						<label className="field-label" htmlFor="qp-desc">Yang dinilai (opsional)</label>
						<input id="qp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Menilai: Ketua Ristek" />
					</div>
					<p className="muted small">Pertanyaan bawaan: Kinerja, Kolaborasi, Inisiatif (skala 1–5).</p>
				</div>
				<div className="row-actions" style={{ marginTop: 14 }}>
					<button type="button" className="btn ghost" onClick={onClose}>Batal</button>
					<button className="btn gold" type="submit" disabled={busy || !title.trim()}>{busy ? "Menyimpan…" : "Buat periode"}</button>
				</div>
			</form>
		</div>
	);
}

function PeriodRow({ period, open, onToggle, onDone, toast }) {
	const [detail, setDetail] = useState(null);
	const [recap, setRecap] = useState(null);
	const [busy, setBusy] = useState(false);
	const [askDelete, setAskDelete] = useState(false);
	const [askEntryDelete, setAskEntryDelete] = useState(null);
	const [showAdd, setShowAdd] = useState(false);
	const [showEdit, setShowEdit] = useState(false);

	const act = async (fn) => {
		setBusy(true);
		try { await fn(); await onDone(); } catch (e) { toast(errText(e), "err"); } finally { setBusy(false); }
	};

	// M4: toggle dan rekap PISAH — dulu showRecap ikut memanggil onToggle lalu
	// membaca prop `open` yang stale, jadi tombol rekap kadang malah menutup detail.
	const toggle = async () => {
		onToggle();
		if (!open) {
			setDetail(null); setRecap(null);
			try { setDetail(await api(`/admin/qpr/periods/${period.id}`)); } catch (e) { toast(errText(e), "err"); }
		}
	};

	const showRecap = async () => {
		// Detail dan rekap saling eksklusif — dulu keduanya tampil bersamaan.
		setDetail(null);
		setRecap(null);
		if (!open) onToggle();
		try { setRecap(await api(`/admin/qpr/periods/${period.id}/recap`)); } catch (e) { toast(errText(e), "err"); }
	};

	const copyLink = () => {
		const link = `${PUBLIC_BASE}/${period.id}`;
		copyText(link).then(
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
					<button className="btn ghost" disabled={busy} onClick={() => setAskDelete(true)}>Hapus</button>
				</div>
			</div>
			{open && detail && (
				<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
					<div className="muted small" style={{ marginBottom: 6 }}>
						Pertanyaan: {detail.questions.map((q) => `${q.category} — ${q.label}`).join(" · ")}
					</div>
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
						<button className="btn ghost" disabled={busy} onClick={() => setShowAdd(true)}>+ Tambah nama</button>
						<button className="btn ghost" disabled={busy || period.status === "closed"} onClick={() => setShowEdit(true)}>Edit periode</button>
					</div>
					<EditPeriodModal
						open={showEdit}
						period={detail}
						onClose={() => setShowEdit(false)}
						onSaved={async () => {
							setDetail(await api(`/admin/qpr/periods/${period.id}`));
							await onDone();
						}}
						toast={toast}
					/>
					<AddEntriesModal
						open={showAdd}
						periodId={period.id}
						onClose={() => setShowAdd(false)}
						onAdded={async () => { setDetail(await api(`/admin/qpr/periods/${period.id}`)); await onDone(); }}
						toast={toast}
					/>
					<div className="tbl-wrap">
						<table className="tbl">
						<thead><tr><th>Nama</th><th>Divisi</th><th>Status</th><th></th></tr></thead>
						<tbody>
							{detail.entries.map((e) => (
								<tr key={e.id}>
									<td>{e.name}</td>
									<td>{e.division || "—"}</td>
									<td>{e.done ? `Sudah isi${e.submitted_at ? ` · ${new Date(e.submitted_at).toLocaleString("id-ID")}` : ""}` : "Belum"}</td>
									<td>
										<button className="btn ghost" disabled={busy} onClick={() => setAskEntryDelete(e)}>Hapus</button>
									</td>
								</tr>
							))}
							{detail.entries.length === 0 && <tr><td colSpan={4} className="muted">Belum ada nama. Klik "+ Tambah nama".</td></tr>}
						</tbody>
						</table>
					</div>
				</div>
			)}
			{recap && (
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
					<div className="tbl-wrap">
						<table className="tbl">
						<thead><tr><th>Kategori</th><th>Rata-rata</th></tr></thead>
						<tbody>
							{Object.entries(recap.category_averages).map(([k, v]) => (
								<tr key={k}><td>{k}</td><td>{v}</td></tr>
							))}
							{Object.keys(recap.category_averages).length === 0 && <tr><td colSpan={2} className="muted">Belum ada penilaian masuk.</td></tr>}
						</tbody>
						</table>
					</div>
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
			<Confirm
				open={askDelete}
				title={`Hapus periode "${period.title}"?`}
				confirmLabel="Ya, hapus"
				danger
				onConfirm={() => { setAskDelete(false); act(() => api(`/admin/qpr/periods/${period.id}`, { method: "DELETE" })); }}
				onCancel={() => setAskDelete(false)}
			>
				Periode yang sudah punya penilaian tidak bisa dihapus.
			</Confirm>
			<Confirm
				open={Boolean(askEntryDelete)}
				title={`Hapus nama "${askEntryDelete?.name ?? ""}"?`}
				confirmLabel="Ya, hapus"
				danger
				onConfirm={() => {
					const e = askEntryDelete;
					setAskEntryDelete(null);
					act(async () => {
						await api(`/admin/qpr/periods/${period.id}/entries/${e.id}`, { method: "DELETE" });
						setDetail(await api(`/admin/qpr/periods/${period.id}`));
					});
				}}
				onCancel={() => setAskEntryDelete(null)}
			>
				Nama yang sudah mengisi tetap tercatat di rekap jika periodenya masih ada.
			</Confirm>
		</div>
	);
}

/** Modal edit periode — PUT /admin/qpr/periods/:id (judul/deskripsi/pertanyaan). */
function EditPeriodModal({ open, period, onClose, onSaved, toast }) {
	const [title, setTitle] = useState(period.title);
	const [desc, setDesc] = useState(period.description || "");
	// Pertanyaan editable sebagai "Kategori | Label" per baris.
	const [qraw, setQraw] = useState(period.questions.map((q) => `${q.category} | ${q.label}`).join("\n"));
	const [busy, setBusy] = useState(false);
	if (!open) return null;

	const submit = async (e) => {
		e.preventDefault();
		const questions = qraw.trim().split("\n").map((line) => {
			const [category, label] = line.split("|").map((s) => s.trim());
			return { category: category || "Umum", label };
		}).filter((q) => q.label);
		if (!questions.length) { toast("Minimal satu pertanyaan.", "err"); return; }
		setBusy(true);
		try {
			await api(`/admin/qpr/periods/${period.id}`, {
				method: "PUT",
				json: { title: title.trim(), description: desc.trim() || null, questions },
			});
			toast("Periode diperbarui.");
			onClose();
			await onSaved();
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Edit periode">
				<h3>Edit periode</h3>
				<div style={{ display: "grid", gap: 10, marginTop: 10 }}>
					<div>
						<label className="field-label" htmlFor="qe-title">Judul periode</label>
						<input id="qe-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
					</div>
					<div>
						<label className="field-label" htmlFor="qe-desc">Yang dinilai (opsional)</label>
						<input id="qe-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
					</div>
					<div>
						<label className="field-label" htmlFor="qe-q">Pertanyaan (satu per baris, "Kategori | Label")</label>
						<textarea id="qe-q" rows={5} value={qraw} onChange={(e) => setQraw(e.target.value)} required />
					</div>
					{period.status === "closed" && <p className="muted small">Periode selesai — judul/pertanyaan terkunci, hanya meta.</p>}
				</div>
				<div className="row-actions" style={{ marginTop: 14 }}>
					<button type="button" className="btn ghost" onClick={onClose}>Batal</button>
					<button className="btn" type="submit" disabled={busy || !title.trim()}>{busy ? "Menyimpan…" : "Simpan"}</button>
				</div>
			</form>
		</div>
	);
}

/** Modal tambah nama pengisi — textarea "Nama | Divisi" per baris. */
function AddEntriesModal({ open, periodId, onClose, onAdded, toast }) {
	const [raw, setRaw] = useState("");
	const [busy, setBusy] = useState(false);
	if (!open) return null;

	const submit = async (e) => {
		e.preventDefault();
		const items = raw.trim().split("\n").map((line) => {
			const [name, division] = line.split("|").map((s) => s.trim());
			return { name, division: division || null };
		}).filter((a) => a.name);
		if (!items.length) { toast("Format tidak terbaca.", "err"); return; }
		setBusy(true);
		try {
			await api(`/admin/qpr/periods/${periodId}/entries`, { method: "POST", json: { entries: items } });
			toast(`${items.length} nama ditambahkan.`);
			setRaw("");
			onClose();
			await onAdded();
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="modal-backdrop" onClick={onClose}>
			<form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Tambah nama pengisi">
				<h3>Tambah nama pengisi</h3>
				<div style={{ marginTop: 10 }}>
					<label className="field-label" htmlFor="qp-entries">Nama (satu per baris, opsional "Nama | Divisi")</label>
					<textarea id="qp-entries" rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Raka Pratama | Ristek\nSinta Dewi | Ristek"} required />
				</div>
				<div className="row-actions" style={{ marginTop: 14 }}>
					<button type="button" className="btn ghost" onClick={onClose}>Batal</button>
					<button className="btn" type="submit" disabled={busy || !raw.trim()}>{busy ? "Menyimpan…" : "Tambah"}</button>
				</div>
			</form>
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

	if (err) return <Card className="err-text">{err}</Card>;
	if (doneMsg) return <div className="empty-state"><p>{doneMsg}</p></div>;
	if (!roster) return <SkeletonCard lines={5} />;

	const questions = roster.questions.filter((q) => !q.note_only);

	return (
		<Card style={{ maxWidth: 560, margin: "0 auto" }}>
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
					// fieldset/legend: grup radio satu pertanyaan terhubung semantik
					// (screen reader baca legend per grup, bukan label lepas).
					<fieldset key={q.label} className="qpr-question" style={{ margin: 0, padding: "8px 10px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
						<legend className="small" style={{ padding: "0 4px" }}><strong>{q.category}</strong> — {q.label}</legend>
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
							{[1, 2, 3, 4, 5].map((n) => (
								<label key={n} className="qpr-scale" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 24, padding: "2px 8px" }}>
									<input type="radio" name={`q_${q.label}`} checked={scores[q.label] === n}
										onChange={() => setScores((s) => ({ ...s, [q.label]: n }))} /> {n}
								</label>
							))}
						</div>
					</fieldset>
				))}
				<div>
					<label className="field-label" htmlFor="qpr-note">Catatan (opsional)</label>
					<textarea id="qpr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
				</div>
				<div>
					<button className="btn" disabled={busy || !name} onClick={submit}>{busy ? "Mengirim…" : "Kirim penilaian"}</button>
				</div>
			</div>
		</Card>
	);
}
