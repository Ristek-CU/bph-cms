import { useCallback, useEffect, useState } from "react";
import QprFill from "./QprFill.jsx";
import { api, apiRaw, errText, isoToInput, toIsoWib } from "../api.js";
import { useToast, Confirm, SkeletonCard, Card, copyText, ErrorState, useEscape, useFocusTrap } from "../components/ui.jsx";

// QPR v2 — tanpa login (model kejujuran). BPH kelola periode + roster nama;
// anggota buka link publik, pilih namanya dari dropdown, isi skala 1-5,
// submit → nama hilang dari daftar (tanda sudah isi).
const STATUS_LABEL = { draft: "Draft", open: "Berlangsung", closed: "Selesai" };

const PUBLIC_BASE = "https://cms.sga-cakrawala.org/#/qpr";

export default function Qpr({ user }) {
	const canManage = user?.division?.slug === "bph" && user?.permissions?.includes("qpr.manage");
	return canManage ? <AdminView key={user.division.id} /> : <ParticipationView key={user?.division?.id || user?.division?.slug} />;
}

function ParticipationView() {
	const [periods, setPeriods] = useState(null);
	const [periodId, setPeriodId] = useState("");
	const [detail, setDetail] = useState(null);
	const [filter, setFilter] = useState("all");
	const [err, setErr] = useState("");
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		let active = true;
		api("/qpr-participation").then((rows) => {
			if (active) { setPeriods(rows); setPeriodId(rows[0]?.id || ""); setErr(""); }
		}).catch((e) => active && setErr(errText(e)));
		return () => { active = false; };
	}, [retry]);
	useEffect(() => {
		let active = true;
		if (periodId) api(`/qpr-participation/${periodId}`).then((data) => {
			if (active) { setDetail({ ...data, requestedPeriodId: periodId, retry }); setErr(""); }
		}).catch((e) => active && setErr(errText(e)));
		return () => { active = false; };
	}, [periodId, retry]);
	return <>
		<div className="page-intro"><h2>Status pengisian QPR</h2><p>Partisipasi anggota divisi aktif. Draft tetap dihitung belum mengisi.</p></div>
		{err && <ErrorState message={err} onRetry={() => setRetry((n) => n + 1)} />}
		{!err && periods === null ? <SkeletonCard /> : periods?.length === 0 ? <p>Belum ada periode yang dipublikasikan.</p> : periods && <>
			<label className="field-label" htmlFor="participation-period">Periode</label>
			<select id="participation-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</select>
			{!err && detail?.requestedPeriodId === periodId && detail.retry === retry ? <div className="card" style={{ marginTop: 12 }}>
				<p>{detail.done_entries} sudah mengisi · {detail.pending_entries} belum mengisi · {detail.total_entries} anggota</p>
				<label htmlFor="participation-filter">Status</label>
				<select id="participation-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Semua</option><option value="done">Sudah mengisi</option><option value="pending">Belum mengisi</option></select>
				<ul>{detail.entries.filter((e) => filter === "all" || e.done === (filter === "done")).map((e, i) => <li key={i}>{e.display_name || e.name}{e.role ? ` (${e.role})` : ""} — {e.done ? "Sudah mengisi" : "Belum mengisi"}</li>)}</ul>
			</div> : !err && <SkeletonCard />}
		</>}
	</>;
}

const DIVISIONS = ["bph", "ristek", "ukm", "advo", "bnp", "icd", "pr", "media"];
const TARGET_IDS = ["controller1", "controller2", "controller3", "controller4", "bendum1", "bendum2", "sekum1", "sekum2", "ketum", "waketum"];
const isSnapshot = (questions) => !Array.isArray(questions) && Array.isArray(questions?.sections);
const isFrozen = (period) => Boolean(period.firstOpenedAt);

function SnapshotQuestions({ snapshot }) {
	return <div><p className="muted small">Pertanyaan template PDF — hanya baca (snapshot v{snapshot.version}).</p>{snapshot.sections.map((s) => <details key={s.id}><summary>{s.title || s.target_label || s.id} · {s.questions.length} pertanyaan</summary><ol>{s.questions.map((q) => <li key={q.id}>{q.label}{q.required ? " (wajib)" : ""}</li>)}</ol></details>)}</div>;
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
	const [formKind, setFormKind] = useState("bph");
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
					form_kind: formKind,
					// form bph: pertanyaan dari template resmi server; legacy: default 3 kategori.
					...(formKind === "legacy" && {
						questions: [
							{ label: "Menyelesaikan tugas tepat waktu", category: "Kinerja" },
							{ label: "Berkolaborasi dengan baik", category: "Kolaborasi" },
							{ label: "Menunjukkan inisiatif", category: "Inisiatif" },
						],
					}),
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
					<fieldset style={{ border: 0, padding: 0, margin: 0 }}>
						<legend className="field-label">Jenis penilaian</legend>
						<div style={{ display: "grid", gap: 6, marginTop: 4 }}>
							<label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
								<input type="radio" name="qp-kind" value="bph" checked={formKind === "bph"} onChange={() => setFormKind("bph")} style={{ marginTop: 3 }} />
								<span><strong>QPR Penilaian BPH</strong><span className="muted small" style={{ display: "block" }}>7 section resmi (Controller, Bendahara, Sekretaris, Ketua, Wakil) — jalur otomatis per jabatan pengisi.</span></span>
							</label>
							<label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
								<input type="radio" name="qp-kind" value="legacy" checked={formKind === "legacy"} onChange={() => setFormKind("legacy")} style={{ marginTop: 3 }} />
								<span><strong>Penilaian sederhana</strong><span className="muted small" style={{ display: "block" }}>3 pertanyaan bawaan: Kinerja, Kolaborasi, Inisiatif (skala 1–5).</span></span>
							</label>
						</div>
					</fieldset>
					<div>
						<label className="field-label" htmlFor="qp-title">Judul periode</label>
						<input id="qp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="QPR BPH Oktober 2026" required maxLength={160} />
					</div>
					<div>
						<label className="field-label" htmlFor="qp-desc">Deskripsi (opsional)</label>
						<input id="qp-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Penilaian pengurus BPH" />
					</div>
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
																<div className="poll-bar-fill" style={{ width: q.responses ? `${(d.count / q.responses) * 100}%` : 0 }} />
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
														{q.texts.map((t, i) => <li key={i}>{q.text_responses?.[i] && <strong>{q.text_responses[i].name} · {q.text_responses[i].division || "—"}: </strong>}{t}</li>)}
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
	const [preview, setPreview] = useState(null);

	const act = async (fn) => {
		setBusy(true);
		try { await fn(); await onDone(); } catch (e) { toast(errText(e), "err"); } finally { setBusy(false); }
	};

	// M4: toggle dan rekap PISAH — dulu showRecap ikut memanggil onToggle lalu
	// membaca prop `open` yang stale, jadi tombol rekap kadang malah menutup detail.
	const toggle = async () => {
		onToggle();
		if (!open) {
			setDetail(null); setRecap(null); setPreview(null);
			try { setDetail(await api(`/admin/qpr/periods/${period.id}`)); } catch (e) { toast(errText(e), "err"); }
		}
	};

	const showRecap = async () => {
		// Detail dan rekap saling eksklusif — dulu keduanya tampil bersamaan.
		setDetail(null);
		setRecap(null);
		if (!open) onToggle();
		// form bph/divisi (snapshot v2) pakai rekap per pertanyaan; legacy → rekap kategori.
		try {
			const current = await api(`/admin/qpr/periods/${period.id}`);
			const path = isSnapshot(current.questions) ? "recap-v2" : "recap";
			setRecap(await api(`/admin/qpr/periods/${period.id}/${path}`));
		} catch (e) { toast(errText(e), "err"); }
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
						{period.closesAt ? ` · tutup ${new Date(period.closesAt).toLocaleDateString("id-ID")}` : ""}
						{` · ${period.done_entries}/${period.total_entries} sudah isi`}
					</div>
				</div>
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
					<button className="btn ghost" disabled={busy} aria-expanded={open} onClick={toggle}>{open ? "Tutup detail" : "Kelola"}</button>
					<button className="btn ghost" disabled={busy} onClick={showRecap}>Rekap</button>
					{period.status !== "draft" && (
						<button className="btn ghost" disabled={busy} onClick={copyLink}>Salin link</button>
					)}
					{(period.status === "draft" || period.status === "closed") && (
						<button className="btn" title={period.total_entries === 0 ? "Tambahkan nama pengisi melalui Kelola terlebih dahulu" : undefined} disabled={busy || period.total_entries === 0}
							onClick={() => act(async () => {
							const check = await api(`/admin/qpr/periods/${period.id}/preview`);
							setPreview(check);
							if (!open) onToggle();
							setDetail(await api(`/admin/qpr/periods/${period.id}`));
							if (check.blockers.length) { toast("Konfigurasi belum lengkap. Periksa blocker.", "err"); return; }
							await api(`/admin/qpr/periods/${period.id}/open`, { method: "POST" });
							setDetail(await api(`/admin/qpr/periods/${period.id}`));
						})}>{period.status === "closed" ? "Buka kembali" : "Buka"}</button>
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
						{isSnapshot(detail.questions) ? <SnapshotQuestions snapshot={detail.questions} /> : <>Pertanyaan: {detail.questions.map((q) => `${q.category} — ${q.label}`).join(" · ")}</>}
					</div>
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
						<button className="btn ghost" disabled={busy || isFrozen(detail)} onClick={() => setShowAdd(true)}>+ Tambah nama</button>
						<button className="btn ghost" disabled={busy} onClick={() => setShowEdit(true)}>Edit periode</button>
					</div>
					<button className="btn ghost" disabled={busy} onClick={() => act(async () => setPreview(await api(`/admin/qpr/periods/${period.id}/preview`)))}>Preview jalur</button>
					{isFrozen(detail) && <p className="muted small">Pernah dibuka — roster, target, dan pertanyaan terkunci. Metadata masih dapat diedit.</p>}
					{preview && <div role="status"><h3>Preview jalur</h3>{preview.blockers.length ? <ul>{preview.blockers.map((b, i) => <li key={i}>{typeof b === "string" ? b : b.message || JSON.stringify(b)}</li>)}</ul> : <p>Tidak ada blocker.</p>}<ul>{preview.entries.map((e) => <li key={e.id}>{e.display_name || e.name} · {e.division_slug} · {e.role} · {e.required} wajib · {e.targets.map((t) => typeof t === "string" ? t : t.label || t.id).join(", ")}</li>)}</ul></div>}
					{showEdit && <EditPeriodModal
						open={showEdit}
						period={detail}
						onClose={() => setShowEdit(false)}
						onSaved={async () => {
							setPreview(null);
							setDetail(await api(`/admin/qpr/periods/${period.id}`));
							await onDone();
						}}
						toast={toast}
					/>}
					<AddEntriesModal
						open={showAdd}
						periodId={period.id}
						version={detail.questions?.version}
						onClose={() => setShowAdd(false)}
						onAdded={async () => { setPreview(null); setDetail(await api(`/admin/qpr/periods/${period.id}`)); await onDone(); }}
						toast={toast}
					/>
					<div className="tbl-wrap">
						<table className="tbl">
						<thead><tr><th>Nama</th><th>Divisi</th><th>Status</th><th></th></tr></thead>
						<tbody>
							{detail.entries.map((e) => (
								<tr key={e.id}>
									<td>{e.display_name || e.name}{e.memberRole || e.role ? ` (${e.memberRole || e.role})` : ""}{e.memberKey ? ` · ${e.memberKey}` : ""}</td>
									<td>{e.division_slug || e.divisionSlug || e.division || "—"}</td>
									<td>{e.done ? `Sudah isi${e.submitted_at ? ` · ${new Date(e.submitted_at).toLocaleString("id-ID")}` : ""}` : "Belum"}</td>
									<td>
										<button className="btn ghost" disabled={busy || isFrozen(detail)} onClick={() => setAskEntryDelete(e)}>Hapus</button>
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
						setPreview(null);
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
	const snapshot = isSnapshot(period.questions);
	const frozen = isFrozen(period);
	const [qraw, setQraw] = useState(Array.isArray(period.questions) ? period.questions.map((q) => `${q.category} | ${q.label}`).join("\n") : "");
	const [config, setConfig] = useState(() => period.questions?.target_config || {
		targets: TARGET_IDS.map((id) => ({ id, label: "", template: id.startsWith("controller") ? "controller" : id })),
		controller_by_division: {},
	});
	const [opensAt, setOpensAt] = useState(isoToInput(period.opensAt));
	const [closesAt, setClosesAt] = useState(isoToInput(period.closesAt));
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
		if (!snapshot && !frozen && !questions.length) { toast("Minimal satu pertanyaan.", "err"); return; }
		if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) { toast("Jadwal tutup harus setelah buka.", "err"); return; }
		setBusy(true);
		try {
			await api(`/admin/qpr/periods/${period.id}`, {
				method: "PUT",
				json: { title: title.trim(), description: desc.trim() || null,
					opens_at: opensAt ? toIsoWib(opensAt) : null,
					closes_at: closesAt ? toIsoWib(closesAt) : null,
					...(!frozen && (snapshot ? period.questions.version === 3 ? { target_config: config } : {} : { questions })),
				},
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
					<div><label className="field-label" htmlFor="qe-opens">Jadwal buka WIB (opsional)</label><input id="qe-opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} /></div>
					<div><label className="field-label" htmlFor="qe-closes">Jadwal tutup WIB (opsional)</label><input id="qe-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
					{snapshot ? <>
						<p className="muted small">Pertanyaan template PDF hanya baca.</p>
						{period.questions.version === 3 && <fieldset disabled={frozen} style={{ minWidth: 0 }}><legend>Target dan pemetaan Controller</legend>
							{config.targets.map((target, i) => <div key={target.id}><label htmlFor={`target-${target.id}`}>Nama {target.id}</label><input id={`target-${target.id}`} value={target.label} maxLength={160} onChange={(e) => setConfig({ ...config, targets: config.targets.map((t, n) => n === i ? { ...t, label: e.target.value } : t) })} /></div>)}
							{DIVISIONS.map((slug) => <div key={slug}><label htmlFor={`controller-${slug}`}>Controller untuk {slug}</label><select id={`controller-${slug}`} value={config.controller_by_division[slug] || ""} onChange={(e) => { const mapping = { ...config.controller_by_division }; if (e.target.value) mapping[slug] = e.target.value; else delete mapping[slug]; setConfig({ ...config, controller_by_division: mapping }); }}><option value="">Belum dipetakan</option>{config.targets.filter((t) => t.template === "controller").map((t) => <option key={t.id} value={t.id}>{t.label || t.id}</option>)}</select></div>)}
						</fieldset>}
					</> : <div><label className="field-label" htmlFor="qe-q">Pertanyaan (satu per baris, "Kategori | Label")</label><textarea id="qe-q" rows={5} value={qraw} onChange={(e) => setQraw(e.target.value)} required disabled={frozen} /></div>}
					{frozen && <p className="muted small">Snapshot dan roster terkunci; hanya metadata yang disimpan.</p>}
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
function AddEntriesModal({ open, periodId, version, onClose, onAdded, toast }) {
	const [raw, setRaw] = useState("");
	const [itemsPreview, setItemsPreview] = useState(null);
	const [busy, setBusy] = useState(false);
	const modalRef = useFocusTrap(open);
	useEscape(() => open && !busy && onClose());
	if (!open) return null;

	const submit = async (e) => {
		e.preventDefault();
		const items = raw.trim().split("\n").map((line) => {
			const [name, division, role, member_key] = line.split("|").map((s) => s.trim());
			return version === 3 ? { name, division_slug: division, role, member_key } : { name, division: division || null, role: role || null };
		}).filter((a) => a.name);
		if (!items.length) { toast("Format tidak terbaca.", "err"); return; }
		if (version === 3 && items.some((item) => !DIVISIONS.includes(item.division_slug) || !["anggota", "kadiv", "wakadiv", "bendiv", "sekdiv", "bendum", "sekum", "controller"].includes(item.role) || !item.member_key)) { toast("Wajib nama, division_slug kanonis, jabatan valid, dan member_key stabil.", "err"); return; }
		if (version === 3 && new Set(items.map((item) => item.member_key)).size !== items.length) { toast("member_key harus unik dalam impor.", "err"); return; }
		if (!itemsPreview) { setItemsPreview(items); return; }
		setBusy(true);
		try {
			await api(`/admin/qpr/periods/${periodId}/entries`, { method: "POST", json: { entries: items } });
			toast(`${items.length} nama ditambahkan.`);
			setRaw(""); setItemsPreview(null);
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
					<label className="field-label" htmlFor="qp-entries">{version === 3 ? "Nama | division_slug | role | member_key (satu per baris)" : "Nama | Divisi | Jabatan (satu per baris)"}</label>
					<textarea id="qp-entries" rows={5} value={raw} onChange={(e) => { setRaw(e.target.value); setItemsPreview(null); }} placeholder={version === 3 ? "Anggota Contoh | ristek | anggota | anggota-001" : "Anggota Contoh | Ristek | anggota"} required />
					<p className="muted small">Jabatan: anggota, kadiv, wakadiv, bendiv, sekdiv, bendum, sekum, controller. Versi 3: divisi kanonis wajib; member_key tetap sama saat impor ulang, berbeda untuk nama kembar.</p>
				</div>
				<div>{itemsPreview && <><h4>Preview impor ({itemsPreview.length})</h4><ul>{itemsPreview.map((item, i) => <li key={i}>{item.name} · {item.division_slug || item.division} · {item.role} · {item.member_key}</li>)}</ul></>}</div>
				<div className="row-actions" style={{ marginTop: 14 }}>
					<button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Batal</button>
					<button className="btn" type="submit" disabled={busy || !raw.trim()}>{busy ? "Menyimpan…" : itemsPreview ? "Impor" : "Preview impor"}</button>
				</div>
			</form>
		</div>
	);
}

/** Halaman publik pengisian (no-login): dispatcher format — v2 snapshot vs legacy. */
export function PublicFill({ periodId }) {
	return <PublicFillDispatch periodId={periodId} />;
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
	return isSnapshot(roster.questions) ? <QprFill periodId={periodId} /> : <PublicFillForm periodId={periodId} />;
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
