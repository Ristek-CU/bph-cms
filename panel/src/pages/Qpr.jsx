import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiRaw, errText } from "../api.js";
import { useToast, Confirm, SkeletonCard, Card, copyText, ErrorState, useEscape, useFocusTrap } from "../components/ui.jsx";

// QPR v2 — tanpa login (model kejujuran). BPH kelola periode + roster nama;
// anggota buka link publik, pilih namanya dari dropdown, isi skala 1-5,
// submit → nama hilang dari daftar (tanda sudah isi).
const STATUS_LABEL = { draft: "Draft", open: "Berlangsung", closed: "Selesai" };

const PUBLIC_BASE = "https://cms.sga-cakrawala.org/#/qpr";

// ponytail: fitur belum dirilis — wall maintenance untuk panel + halaman publik.
// Aktifkan fitur: ganti jadi false (badge nav "Segera" di Shell.jsx ikut dikembalikan).
// VITE_QPR_MAINTENANCE=false untuk dev lokal; window.__QPR_MAINTENANCE__ = false
// untuk test UI (Playwright) yang tidak me-restart Vite.
const QPR_MAINTENANCE = typeof window !== "undefined" && window.__QPR_MAINTENANCE__ === false
	? false
	: import.meta.env.VITE_QPR_MAINTENANCE !== "false";

function MaintenanceNote() {
	return (
		<div className="empty-state" style={{ maxWidth: 560, margin: "0 auto" }}>
			<p><strong>Fitur QPR sedang dalam tahap pengembangan.</strong></p>
			<p className="muted small">Penilaian QPR belum bisa diakses. Nantikan pengumuman dari BPH.</p>
		</div>
	);
}

export default function Qpr({ user }) {
	if (QPR_MAINTENANCE) return <MaintenanceNote />;
	const canManage = user?.permissions?.includes("qpr.manage");
	return canManage ? <AdminView /> : <NoManage />;
}

function NoManage() {
	// Non-BPH tidak kelola — pengisian lewat link publik, bukan panel.
	return (
		<div className="empty-state">
			<p>Kamu tidak punya akses kelola QPR. Buka link publik periode yang sedang berjalan untuk mengisi penilaian.</p>
			<p className="muted small">Minta link periode aktif kepada pengurus BPH. Kamu bisa mengisi penilaian langsung dari link tersebut.</p>
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
			<div className="page-intro"><h2>Evaluasi untuk tumbuh bersama.</h2><p>Buat periode, tambahkan nama pengisi, lalu bagikan link penilaian.</p></div>
			{err && <ErrorState message={err} onRetry={load} />}
			<div className="toolbar" style={{ marginBottom: 12 }}>
				<button className="btn gold" onClick={() => setShowCreate(true)}>+ Periode baru</button>
			</div>
			{err ? null : periods === null ? (
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
	const modalRef = useFocusTrap(open);
	useEscape(() => open && !busy && onClose());
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
		<div className="modal-backdrop" onClick={() => !busy && onClose()}>
			<form ref={modalRef} tabIndex={-1} className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Periode baru">
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
					<button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Batal</button>
					<button className="btn gold" type="submit" disabled={busy || !title.trim()}>{busy ? "Menyimpan…" : "Buat periode"}</button>
				</div>
			</form>
		</div>
	);
}

/** Rekap v2: partisipasi + distribusi skor per pertanyaan + teks, per section target. */
const SCALE_LABEL = { 1: "Sangat Kurang", 2: "Kurang", 3: "Cukup", 4: "Baik", 5: "Sangat Baik" };

function RecapV2({ recap, onExport, onExportDisabled }) {
	const total = recap.done_entries;
	return (
		<>
			<div className="muted small" style={{ marginBottom: 6 }}>
				Rekap — {recap.done_entries}/{recap.total_entries} sudah isi
			</div>
			{recap.pending.length > 0 && (
				<div className="small" style={{ marginBottom: 8 }}>
					<strong>Belum isi:</strong> {recap.pending.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}
				</div>
			)}
			{total === 0 && <p className="muted small">Belum ada penilaian final.</p>}
			{recap.sections.map((s) => (
				<div key={s.id} style={{ marginBottom: 16 }}>
					<h3 style={{ fontSize: 14, margin: "0 0 6px" }}>{s.target_label || s.title}</h3>
					<div className="tbl-wrap">
						<table className="tbl">
						<thead>
							<tr>
								<th scope="col">Pertanyaan</th>
								<th scope="col" style={{ minWidth: 180 }}>Distribusi skor</th>
								<th scope="col">N</th>
								<th scope="col">Rata-rata</th>
							</tr>
						</thead>
						<tbody>
							{s.questions.map((q) => (
								<tr key={q.id}>
									<td style={{ maxWidth: 340 }}>{q.label}</td>
									{q.type === "scale" ? (
										<>
											<td>
												<div className="poll-bars" role="img" aria-label={q.distribution.map((d) => `${d.value} ${SCALE_LABEL[d.value]}: ${d.count}`).join(", ") || "Belum ada jawaban"}>
													{q.distribution.map((d) => (
														<div key={d.value} className="poll-bar-row">
															<div className="poll-bar-top">
																<span className="poll-bar-name">{d.value} — {SCALE_LABEL[d.value]}</span>
																<strong className="poll-bar-count">{d.count}</strong>
															</div>
															<div className="poll-bar-track">
																<div className="poll-bar-fill" style={{ width: total ? `${(d.count / total) * 100}%` : 0 }} />
															</div>
														</div>
													))}
												</div>
											</td>
											<td>{q.responses}</td>
											<td>{q.mean === null ? "—" : q.mean}</td>
										</>
									) : (
										<>
											<td>
												{q.texts.length === 0 ? (
													<span className="muted small">Belum ada jawaban.</span>
												) : (
													<ul style={{ margin: 0, paddingLeft: 18 }} className="small">
														{q.texts.map((t, i) => <li key={i}>{t}</li>)}
													</ul>
												)}
											</td>
											<td colSpan={2}></td>
										</>
									)}
								</tr>
							))}
						</tbody>
						</table>
					</div>
				</div>
			))}
			<button className="btn ghost sm" disabled={onExportDisabled || total === 0} onClick={onExport}>Ekspor CSV</button>
		</>
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
		// form bph/divisi (snapshot v2) pakai rekap per pertanyaan; legacy → rekap kategori.
		const v2Path = period.formKind && period.formKind !== "legacy" ? "recap-v2" : "recap";
		try { setRecap(await api(`/admin/qpr/periods/${period.id}/${v2Path}`)); } catch (e) { toast(errText(e), "err"); }
	};

	const exportCsv = async () => {
		try {
			const res = await apiRaw(`/admin/qpr/periods/${period.id}/export`);
			const url = URL.createObjectURL(await res.blob());
			const link = document.createElement("a");
			link.href = url;
			link.download = `qpr-${period.id.slice(0, 8)}.csv`;
			link.click();
			URL.revokeObjectURL(url);
			toast("CSV diekspor.");
		} catch (e) { toast(errText(e), "err"); }
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
				<div style={{ minWidth: 0 }}>
					<strong>{period.title}</strong>
					<div className="muted small">
						{STATUS_LABEL[period.status] ?? period.status}
						{period.description ? ` · ${period.description}` : ""}
						{period.closes_at ? ` · tutup ${new Date(period.closes_at).toLocaleDateString("id-ID")}` : ""}
						{` · ${period.done_entries}/${period.total_entries} sudah isi`}
					</div>
				</div>
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
					<button className="btn ghost" disabled={busy} aria-expanded={open} onClick={toggle}>{open ? "Tutup detail" : "Kelola"}</button>
					<button className="btn ghost" disabled={busy} onClick={showRecap}>Rekap</button>
					{period.status !== "draft" && (
						<button className="btn ghost" disabled={busy} onClick={copyLink}>Salin link</button>
					)}
					{period.status === "draft" && (
						<button className="btn" title={period.total_entries === 0 ? "Tambahkan nama pengisi melalui Kelola terlebih dahulu" : undefined} disabled={busy || period.total_entries === 0}
							onClick={() => act(() => api(`/admin/qpr/periods/${period.id}/open`, { method: "POST" }))}>Buka</button>
					)}
					{period.status === "open" && (
						<button className="btn" disabled={busy} onClick={() => act(() => api(`/admin/qpr/periods/${period.id}/close`, { method: "POST" }))}>Tutup</button>
					)}
					<button className="btn ghost" disabled={busy} onClick={() => setAskDelete(true)}>Hapus</button>
				</div>
			</div>
			{open && !detail && !recap && <p role="status" className="muted">Memuat detail…</p>}
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
			{open && recap && (
				<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
					{recap.sections ? (
						<RecapV2 recap={recap} onExport={exportCsv} onExportDisabled={busy} />
					) : (
						<>
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
						</>
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
	const modalRef = useFocusTrap(open);
	useEscape(() => open && !busy && onClose());
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
		<div className="modal-backdrop" onClick={() => !busy && onClose()}>
			<form ref={modalRef} tabIndex={-1} className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Edit periode">
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
					<button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Batal</button>
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
	const modalRef = useFocusTrap(open);
	useEscape(() => open && !busy && onClose());
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
		<div className="modal-backdrop" onClick={() => !busy && onClose()}>
			<form ref={modalRef} tabIndex={-1} className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-label="Tambah nama pengisi">
				<h3>Tambah nama pengisi</h3>
				<div style={{ marginTop: 10 }}>
					<label className="field-label" htmlFor="qp-entries">Nama (satu per baris, opsional "Nama | Divisi")</label>
					<textarea id="qp-entries" rows={5} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"Raka Pratama | Ristek\nSinta Dewi | Ristek"} required />
				</div>
				<div className="row-actions" style={{ marginTop: 14 }}>
					<button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Batal</button>
					<button className="btn" type="submit" disabled={busy || !raw.trim()}>{busy ? "Menyimpan…" : "Tambah"}</button>
				</div>
			</form>
		</div>
	);
}

/** Halaman publik pengisian (no-login): dispatcher format — v2 snapshot vs legacy. */
export function PublicFill({ periodId }) {
	return QPR_MAINTENANCE ? <MaintenanceNote /> : <PublicFillDispatch periodId={periodId} />;
}

function PublicFillDispatch({ periodId }) {
	const [roster, setRoster] = useState(null);
	const [err, setErr] = useState("");
	useEffect(() => {
		if (!periodId) return;
		api(`/qpr/${periodId}`)
			.then((d) => { setRoster(d); setErr(""); })
			.catch((e) => setErr(e?.message || "Periode tidak ditemukan atau sudah ditutup."));
	}, [periodId]);
	if (err) return <ErrorState message={err} />;
	if (!roster) return <SkeletonCard lines={5} />;
	// Snapshot v2: questions berupa {version:2, sections} — renderer bertahap + draft.
	return roster.questions?.version === 2 ? <PublicFillV2 periodId={periodId} /> : <PublicFillForm periodId={periodId} />;
}

function PublicFillForm({ periodId }) {
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
		if (busy) return;
		if (!name) { toast("Pilih namamu dulu.", "err"); return; }
		const questions = roster.questions.filter((q) => !q.note_only);
		if (questions.some((q) => !scores[q.label])) { toast("Isi semua skala dulu.", "err"); return; }
		setBusy(true);
		try {
			const answers = questions.map((q) => ({ label: q.label, category: q.category, score: scores[q.label] }));
			await api(`/qpr/${periodId}/submit`, { method: "POST", json: { name, answers, note: note.trim() || undefined } });
			setDoneMsg("Penilaian terkirim. Terima kasih!");
		} catch (e) {
			toast(errText(e), "err");
			// Nama mungkin sudah diisi orang lain — refresh roster.
			api(`/qpr/${periodId}`).then(setRoster).catch(() => {});
		} finally {
			setBusy(false);
		}
	};

	if (err) return <ErrorState message={err} onRetry={() => { setErr(""); api(`/qpr/${periodId}`).then(setRoster).catch((e) => setErr(errText(e))); }} />;
	if (doneMsg) return <div className="card qpr-success" role="status"><span aria-hidden>✓</span><h2>Terima kasih!</h2><p>{doneMsg}</p><p className="muted">Jawabanmu sudah tersimpan. Halaman ini boleh ditutup.</p></div>;
	if (!roster) return <SkeletonCard lines={5} />;

	const questions = roster.questions.filter((q) => !q.note_only);

	return (
		<Card style={{ maxWidth: 560, margin: "0 auto" }}>
			<p className="studio-kicker">PENILAIAN PENGURUS</p><h1 className="qpr-title">{roster.title}</h1>
			{roster.description && <div className="muted small" style={{ marginTop: 2 }}>{roster.description}</div>}
			<p className="muted small">Pilih nama sendiri dan isi semua pertanyaan. Skala 1 paling rendah, 5 paling tinggi.</p>
			{roster.remaining.length === 0 ? <p className="login-notice">Semua nama telah mengisi penilaian ini.</p> : <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
				<div>
					<label className="field-label" htmlFor="qpr-name">Namamu</label>
					<select disabled={busy} id="qpr-name" value={name} onChange={(e) => setName(e.target.value)}>
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
									<input type="radio" disabled={busy} aria-label={`${n} dari 5`} name={`q_${q.label}`} checked={scores[q.label] === n}
										onChange={() => setScores((s) => ({ ...s, [q.label]: n }))} /> {n}
								</label>
							))}
						</div>
					</fieldset>
				))}
				<div>
					<label className="field-label" htmlFor="qpr-note">Catatan (opsional)</label>
					<textarea id="qpr-note" disabled={busy} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
				</div>
				<div>
					<p className="field-help" role="status">{questions.filter((q) => scores[q.label]).length} dari {questions.length} pertanyaan terisi</p>
					<button className="btn" disabled={busy || !name || questions.some((q) => !scores[q.label])} onClick={submit}>{busy ? "Mengirim…" : "Kirim penilaian"}</button>
				</div>
			</div>}
		</Card>
	);
}

/** Halaman publik pengisian v2 (snapshot berversi): pilih nama → draft autosave → submit. */
function PublicFillV2({ periodId }) {
	const toast = useToast();
	const [roster, setRoster] = useState(null);
	const [err, setErr] = useState("");
	// entry = { id, name } terpilih; draft = { answers, version }.
	const [entry, setEntry] = useState(null);
	const [draft, setDraft] = useState(null);
	const [meta, setMeta] = useState(null); // questions, sections, progress, legend
	const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | conflict | error
	const [busy, setBusy] = useState(false);
	const [doneMsg, setDoneMsg] = useState(false);
	const saveTimer = useRef(null);
	const saveSeq = useRef(0);

	useEffect(() => {
		if (!periodId) return;
		api(`/qpr/${periodId}`)
			.then((d) => { setRoster(d); setErr(""); })
			.catch((e) => setErr(e?.message || "Periode tidak ditemukan atau sudah ditutup."));
		return () => setEntry(null); // pindah periode: isolasi state entry sebelumnya
	}, [periodId]);

	// Pilih nama → ambil draft (sumber utama lintas perangkat).
	const pickEntry = async (r) => {
		// Isolasi: batalkan autosave entry sebelumnya.
		clearTimeout(saveTimer.current);
		saveSeq.current += 1;
		setEntry({ id: r.id, name: r.name });
		setDraft(null); setSaveState("idle");
		try {
			const d = await api(`/qpr/${periodId}/entries/${r.id}/draft`);
			setMeta(d);
			setDraft({ answers: Object.fromEntries(d.draft.map((a) => [a.question_id, a.value])), version: d.draft_version });
		} catch (e) {
			if (e?.statusCode === 409) { toast("Nama ini sudah mengirim penilaian final.", "err"); setEntry(null); }
			else setErr(errText(e));
		}
	};

	// Autosave 800ms setelah perubahan terakhir — satu request dalam satu waktu.
	const scheduleSave = (nextAnswers) => {
		clearTimeout(saveTimer.current);
		setSaveState("saving");
		const seq = ++saveSeq.current;
		saveTimer.current = setTimeout(async () => {
			try {
				const answers = Object.entries(nextAnswers).map(([question_id, value]) => ({ question_id, value }));
				const res = await api(`/qpr/${periodId}/entries/${entry.id}/draft`, {
					method: "PUT", json: { expected_version: draft.version, answers },
				});
				if (seq === saveSeq.current) { setDraft((d) => ({ ...d, version: res.draft_version })); setSaveState("saved"); }
			} catch (e) {
				if (seq !== saveSeq.current) return; // respons entry lama — abaikan
				if (e?.statusCode === 409) {
					setSaveState("conflict");
					toast("Draft diperbarui perangkat lain — muat ulang halaman untuk melihat versi terbaru.", "err");
				} else { setSaveState("error"); toast(errText(e), "err"); }
			}
		}, 800);
	};

	const setAnswer = (questionId, value) => {
		const next = { ...draft.answers, [questionId]: value };
		setDraft((d) => ({ ...d, answers: next }));
		scheduleSave(next);
	};

	const submitFinal = async () => {
		if (busy) return;
		setBusy(true);
		try {
			clearTimeout(saveTimer.current);
			const answers = Object.entries(draft.answers).map(([question_id, value]) => ({ question_id, value }));
			await api(`/qpr/${periodId}/submit-v2`, { method: "POST", json: { entry_id: entry.id, answers } });
			setDoneMsg(true);
		} catch (e) {
			toast(errText(e), "err");
			if (e?.statusCode === 422 || e?.statusCode === 409) api(`/qpr/${periodId}`).then(setRoster).catch(() => {});
		} finally { setBusy(false); }
	};

	if (err) return <ErrorState message={err} onRetry={() => { setErr(""); api(`/qpr/${periodId}`).then(setRoster).catch((e) => setErr(errText(e))); }} />;
	if (doneMsg) return <div className="card qpr-success" role="status"><span aria-hidden>✓</span><h2>Terima kasih!</h2><p>Penilaian terkirim. Terima kasih!</p><p className="muted">Jawabanmu sudah tersimpan. Halaman ini boleh ditutup.</p></div>;
	if (!roster) return <SkeletonCard lines={5} />;
	if (!entry) {
		return (
			<Card style={{ maxWidth: 560, margin: "0 auto" }}>
				<p className="studio-kicker">PENILAIAN PENGURUS</p><h1 className="qpr-title">{roster.title}</h1>
				{roster.description && <div className="muted small" style={{ marginTop: 2 }}>{roster.description}</div>}
				{/* Model kejuhuran — wajib terlihat, jangan sebut anonim. */}
				<p className="login-notice">Form ini tanpa login: pilih namamu dari daftar. Orang lain yang memilih namamu bisa melihat/melanjutkan isianmu, jadi jangan bagikan link di luar anggota SGA.</p>
				{roster.remaining.length === 0 ? <p className="login-notice">Semua nama telah mengisi penilaian ini.</p> : (
					<div style={{ display: "grid", gap: 12, marginTop: 14 }}>
						<div>
							<label className="field-label" htmlFor="qpr-name-v2">Namamu</label>
							<select id="qpr-name-v2" value="" onChange={(e) => { const r = roster.remaining.find((x) => x.id === e.target.value); if (r) pickEntry(r); }}>
								<option value="" disabled>Pilih namamu…</option>
								{roster.remaining.map((r) => (
									<option key={r.id} value={r.id}>{r.name}{r.division ? ` — ${r.division}` : ""}</option>
								))}
							</select>
							<div className="muted small" style={{ marginTop: 4 }}>{roster.remaining.length} orang belum mengisi</div>
						</div>
					</div>
				)}
			</Card>
		);
	}

	const questions = meta?.questions ?? [];
	const progress = meta?.progress ?? { required: questions.filter((q) => q.required).length, filled: 0 };
	const filledCount = questions.filter((q) => q.required && draft?.answers?.[q.id] !== undefined && String(draft.answers[q.id]).trim() !== "").length;

	return (
		<Card style={{ maxWidth: 640, margin: "0 auto" }}>
			<p className="studio-kicker">PENILAIAN PENGURUS</p>
			<h1 className="qpr-title">{roster.title}</h1>
			<p className="muted small">Mengisi sebagai <strong>{entry.name}</strong> · <button className="btn ghost" onClick={() => { clearTimeout(saveTimer.current); setEntry(null); setDraft(null); }}>Ganti nama</button></p>
			<p className="field-help" role="status" aria-live="polite">
				{saveState === "saving" ? "Menyimpan…" : saveState === "saved" ? "Tersimpan" : saveState === "conflict" ? "Gagal tersimpan — versi berubah" : saveState === "error" ? "Gagal tersimpan — coba lagi" : `${filledCount} dari ${progress.required} wajib terisi`}
			</p>
			{(meta?.sections ?? []).map((s) => (
				<section key={s.id} style={{ marginTop: 18 }}>
					<h2 style={{ fontSize: "1.05rem" }}>{s.title}</h2>
					{s.questions.map((q) => (
						<fieldset key={q.id} className="qpr-question" style={{ margin: "0 0 10px", padding: "8px 10px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
							<legend className="small" style={{ padding: "0 4px" }}>{q.label}{q.required ? " *" : ""}</legend>
							{q.type === "scale" ? (
								<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
									{[1, 2, 3, 4, 5].map((n) => (
										<label key={n} className="qpr-scale" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, minHeight: 24, padding: "2px 8px" }}>
											<input type="radio" disabled={busy} aria-label={`${n} — ${meta.scale_legend[n]}`} name={`q_${q.id}`} checked={draft?.answers?.[q.id] === n}
												onChange={() => setAnswer(q.id, n)} /> {n}
										</label>
									))}
									<span className="muted small" style={{ alignSelf: "center" }}>{meta.scale_legend[draft?.answers?.[q.id]] ?? ""}</span>
								</div>
							) : (
								<textarea rows={3} disabled={busy} maxLength={5000} value={typeof draft?.answers?.[q.id] === "string" ? draft.answers[q.id] : ""}
									onChange={(e) => setAnswer(q.id, e.target.value)} />
							)}
						</fieldset>
					))}
				</section>
			))}
			<div style={{ marginTop: 14 }}>
				<p className="field-help" role="status">{filledCount} dari {progress.required} pertanyaan wajib terisi</p>
				<button className="btn" disabled={busy || filledCount < progress.required} onClick={submitFinal}>{busy ? "Mengirim…" : "Kirim penilaian"}</button>
			</div>
		</Card>
	);
}
