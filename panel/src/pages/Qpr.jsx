import { useCallback, useEffect, useState } from "react";
import QprFill from "./QprFill.jsx";
import QprEditor, { editorDrafts } from "./QprEditor.jsx";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QprSection, QprReview, QprProgress, complete } from "../components/QprForm.jsx";
import { api, apiRaw, errText } from "../api.js";
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
	const [search, setSearch] = useState("");
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
			{!err && detail?.requestedPeriodId === periodId && detail.retry === retry ? <div className="card qpr-participation" style={{ marginTop: 12 }}>
				<h2>{detail.period.title}</h2><p>{detail.done_entries} sudah mengisi · {detail.pending_entries} belum mengisi · {detail.total_entries} anggota</p><ParticipationMeter done={detail.done_entries} total={detail.total_entries} /><p><span className={`badge ${detail.period.status}`}>{STATUS_LABEL[detail.period.status]}</span></p>{detail.period.status === "open" && <a className="btn" href={`#/qpr/${periodId}`}>Buka form pengisian</a>}<label className="field-label" htmlFor="participation-search">Cari anggota</label><input id="participation-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
				<label htmlFor="participation-filter">Status</label>
				<select id="participation-filter" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Semua</option><option value="done">Sudah mengisi</option><option value="pending">Belum mengisi</option></select>
				<ul>{detail.entries.filter((e) => (filter === "all" || e.done === (filter === "done")) && e.name.toLocaleLowerCase("id-ID").includes(search.toLocaleLowerCase("id-ID"))).map((e, i) => <li key={i}>{e.display_name || e.name}{e.role ? ` (${e.role})` : ""} — {e.done ? "Sudah mengisi" : "Belum mengisi"}</li>)}</ul>
			</div> : !err && <SkeletonCard />}
		</>}
	</>;
}

const DIVISIONS = ["bph", "ristek", "ukm", "advo", "bnp", "icd", "pr", "media"];
const isSnapshot = (questions) => !Array.isArray(questions) && Array.isArray(questions?.sections);
const isFrozen = (period) => Boolean(period.firstOpenedAt);
const legacyQuestionKey = (question) => JSON.stringify([question.label, question.category]);

function AdminView() {
	const toast = useToast();
	const [periods, setPeriods] = useState(null);
	const [err, setErr] = useState("");
	const [search, setSearch] = useState("");
	const [status, setStatus] = useState("all");
	const [showCreate, setShowCreate] = useState(false);
	const load = useCallback(async () => {
		try { setPeriods(await api("/admin/qpr/periods")); setErr(""); }
		catch (e) { setErr(errText(e)); }
	}, []);
	useEffect(() => { load(); }, [load]);
	const visible = periods?.filter((p) => (status === "all" || p.status === status) && p.title.toLocaleLowerCase("id-ID").includes(search.toLocaleLowerCase("id-ID")));
	return <>
		<div className="qpr-page-head"><div><p className="studio-kicker">QUARTERLY PERFORMANCE REVIEW</p><h1>Kampanye QPR</h1><p className="muted">Susun penilaian, bagikan form, pantau partisipasi.</p></div><button className="btn gold" onClick={() => setShowCreate(true)}>+ Periode baru</button></div>
		<div className="qpr-filter-row"><label>Cari kampanye<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari judul periode" /></label><label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Semua status</option>{Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
		{err ? <ErrorState message={err} onRetry={load} /> : periods === null ? <SkeletonCard /> : !visible.length ? <div className="empty-state"><h2>Belum ada kampanye yang cocok</h2><p>Buat periode baru atau ubah pencarian.</p></div> : <div className="qpr-campaign-list">{visible.map((p) => <article className="card qpr-campaign" key={p.id}><div className="qpr-question-top"><span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span><span className="muted small">{p.closesAt ? `Tutup ${new Date(p.closesAt).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "Tanpa jadwal tutup"}</span></div><h2><Link to={`/qpr/periods/${p.id}`}>{p.title}</Link></h2><p className="muted">{p.description || "Penilaian pengurus SGA"}</p><ParticipationMeter done={p.done_entries} total={p.total_entries} /><div className="row-actions"><Link className="btn" to={`/qpr/periods/${p.id}`}>Kelola</Link><Link className="btn ghost" to={`/qpr/periods/${p.id}?tab=responses`}>Rekap</Link></div></article>)}</div>}
		<CreatePeriodModal open={showCreate} onClose={() => setShowCreate(false)} onDone={load} toast={toast} />
	</>;
}

function ParticipationMeter({ done, total }) {
	return <div className="qpr-participation-meter"><div><strong>{done} / {total}</strong><span className="muted"> respons final · {total ? Math.round(done / total * 100) : 0}%</span></div><progress aria-label="Progres respons final" value={done} max={total || 1} /><p className="muted small">{Math.max(0, total - done)} belum mengirim · draft tidak dihitung final</p></div>;
}

/** Modal buat periode — pertanyaan default PRD §4.3, bisa diubah via PUT nanti. */
function CreatePeriodModal({ open, onClose, onDone, toast }) {
	const navigate = useNavigate();
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
			const created = await api("/admin/qpr/periods", {
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
			toast("Periode draft dibuat — lengkapi form dan pengisi.");
			setTitle(""); setDesc("");
			onClose();
			await onDone();
			navigate(`/qpr/periods/${created.id}?tab=questions`);
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
								<span><strong>QPR Penilaian BPH</strong><span className="muted small" style={{ display: "block" }}>10 bagian penilaian (4 Controller, 2 Bendahara, 2 Sekretaris, Ketua, Wakil) — jalur otomatis per jabatan pengisi.</span></span>
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
	const [target, setTarget] = useState(recap.sections[0]?.id || "");
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
			<label className="field-label" htmlFor="qpr-response-target">Target penilaian</label><select id="qpr-response-target" value={target} onChange={(e) => setTarget(e.target.value)}>{recap.sections.map((s) => <option key={s.id} value={s.id}>{s.target_label || s.title}</option>)}</select>
			{recap.sections.filter((s) => s.id === target).map((s) => (
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

export function QprWorkspace({ user }) {
	const { periodId } = useParams();
	const canManage = user?.division?.slug === "bph" && user?.permissions?.includes("qpr.manage");
	return canManage ? <Workspace key={`${user.division.id}-${periodId}`} periodId={periodId} draftKey={JSON.stringify([user.id, user.division.id, periodId])} /> : <><p className="login-notice">Pengelolaan dan hasil QPR khusus BPH.</p><ParticipationView key={user?.division?.id} /></>;
}

function Workspace({ periodId, draftKey }) {
	const toast = useToast();
	const [params, setParams] = useSearchParams();
	const tabs = { overview: "Ringkasan", questions: "Pertanyaan", entries: "Pengisi", preview: "Pratinjau", responses: "Respons" };
	const tab = Object.hasOwn(tabs, params.get("tab")) ? params.get("tab") : "overview";
	const [period, setPeriod] = useState(null);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [preview, setPreview] = useState(null);
	const [recap, setRecap] = useState(null);
	const [showAdd, setShowAdd] = useState(false);
	const [remove, setRemove] = useState(null);
	const [confirmStatus, setConfirmStatus] = useState(null);
	const [dirty, setDirty] = useState(false);
	const [editorReset, setEditorReset] = useState(0);
	const [search, setSearch] = useState("");
	const [filter, setFilter] = useState("all");
	const [division, setDivision] = useState("all");
	const load = useCallback(async () => {
		try { setPeriod(await api(`/admin/qpr/periods/${periodId}`)); setError(""); }
		catch (e) { setError(errText(e)); }
	}, [periodId]);
	useEffect(() => { load(); }, [load]);
	const act = async (action) => {
		if (busy) return;
		setBusy(true); setError("");
		try { await action(); await load(); }
		catch (e) { setError(errText(e)); }
		finally { setBusy(false); }
	};
	const changeTab = async (next) => {
		if (next === tab) return;
		if (dirty && !window.confirm("Perubahan form belum disimpan. Pindah tab akan membuang edit lokal. Lanjutkan?")) return;
		if (dirty) editorDrafts.delete(draftKey);
		setDirty(false); setParams({ tab: next }, { replace: true }); setError("");
	};
	useEffect(() => {
		let active = true;
		if (tab === "preview" && period) {
			api(`/admin/qpr/periods/${periodId}/preview`).then((data) => { if (active) setPreview(data); }).catch((e) => { if (active) setError(errText(e)); });
		}
		if (tab === "responses" && period) {
			api(`/admin/qpr/periods/${periodId}/${isSnapshot(period.questions) ? "recap-v2" : "recap"}`).then((data) => { if (active) setRecap(data); }).catch((e) => { if (active) setError(errText(e)); });
		}
		return () => { active = false; };
	}, [tab, periodId, period]);
	const exportCsv = async () => {
		try {
			const response = await apiRaw(`/admin/qpr/periods/${periodId}/export`);
			const url = URL.createObjectURL(await response.blob());
			const link = document.createElement("a"); link.href = url; link.download = `qpr-${periodId.slice(0, 8)}.csv`; link.click(); URL.revokeObjectURL(url);
		} catch (e) { toast(errText(e), "err"); }
	};
	if (!period) return error ? <ErrorState message={error} onRetry={load} /> : <SkeletonCard lines={5} />;
	const frozen = isFrozen(period);
	const entries = period.entries;
	const done = entries.filter((e) => e.done).length;
	const divisions = [...new Set(entries.map((e) => e.divisionSlug || e.division || "Belum dipetakan"))];
	const visible = entries.filter((e) => (filter === "all" || e.done === (filter === "done")) && (division === "all" || (e.divisionSlug || e.division || "Belum dipetakan") === division) && `${e.name} ${e.memberKey || ""}`.toLocaleLowerCase("id-ID").includes(search.toLocaleLowerCase("id-ID")));
	return <div className="qpr-workspace">
		<Link className="qpr-back" to="/qpr">← Semua kampanye</Link>
		<header className="qpr-page-head"><div><p className="studio-kicker">WORKSPACE QPR</p><h1>{period.title}</h1><p className="muted">{entries.length} pengisi · {done} respons final</p></div><span className={`badge ${period.status}`}>{STATUS_LABEL[period.status]}</span></header>
		<nav className="qpr-tabs" aria-label="Bagian kampanye">{Object.entries(tabs).map(([key, label]) => <button key={key} type="button" className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => changeTab(key)}>{label}{key === "responses" ? ` (${done})` : ""}</button>)}</nav>
		{error && <ErrorState message={error} onRetry={() => { setError(""); load(); }} />}
		{tab === "overview" && <>
			<div className="card qpr-overview"><h2>Progres pengisian</h2><ParticipationMeter done={done} total={entries.length} /><p>{period.description || "Belum ada deskripsi."}</p><p className="muted small">{period.opensAt ? `Buka: ${new Date(period.opensAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "Buka manual"} · {period.closesAt ? `Tutup: ${new Date(period.closesAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : "Tutup manual"}</p>
				<div className="row-actions"><button className="btn gold" disabled={busy} onClick={() => setConfirmStatus(period.status === "open" ? "close" : "open")}>{period.status === "open" ? "Tutup pengisian" : period.status === "closed" ? "Buka kembali" : "Buka kampanye"}</button><button className="btn ghost" onClick={() => copyText(`${PUBLIC_BASE}/${periodId}`).then(() => toast("Link disalin."), () => toast("Tidak bisa menyalin link.", "err"))}>Salin link</button><button className="btn ghost" onClick={() => changeTab("questions")}>Edit form</button></div>
				{frozen ? <p className="login-notice">Snapshot dan roster terkunci sejak kampanye pertama dibuka. Metadata tetap dapat diedit melalui tab Pertanyaan.</p> : <p className="muted small">Sebelum membuka: lengkapi nama target, pertanyaan, dan roster. Periksa Pratinjau.</p>}
			</div>
			<div className="card"><h2>Partisipasi per divisi</h2><div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Divisi</th><th scope="col">Final / Pengisi</th><th scope="col">Progres</th></tr></thead><tbody>{divisions.map((name) => { const rows = entries.filter((e) => (e.divisionSlug || e.division || "Belum dipetakan") === name); const count = rows.filter((e) => e.done).length; return <tr key={name}><td>{name}</td><td>{count} / {rows.length}</td><td>{Math.round(count / rows.length * 100)}%</td></tr>; })}{!entries.length && <tr><td colSpan={3}>Belum ada pengisi.</td></tr>}</tbody></table></div></div>
		</>}
		{tab === "questions" && <QprEditor key={`${period.updatedAt}-${editorReset}`} period={period} draftKey={draftKey} onDiscard={() => { if (window.confirm("Buang edit lokal dan gunakan form server?")) { editorDrafts.delete(draftKey); setDirty(false); setEditorReset((n) => n + 1); } }} toast={toast} onDirty={setDirty} onSaved={async (updated) => { setPeriod((current) => ({ ...current, ...updated })); setDirty(false); setPreview(null); setRecap(null); }} />}
		{tab === "entries" && <>
			<div className="qpr-page-head"><div><h2>Daftar pengisi</h2><p className="muted">Draft tetap berstatus belum mengirim.</p></div><button className="btn" disabled={frozen || busy} onClick={() => setShowAdd(true)}>+ Tambah nama</button></div>
			<div className="qpr-filter-row"><label>Cari pengisi<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label>Divisi<select value={division} onChange={(e) => setDivision(e.target.value)}><option value="all">Semua divisi</option>{divisions.map((d) => <option key={d}>{d}</option>)}</select></label><label>Status<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Semua</option><option value="done">Sudah mengisi</option><option value="pending">Belum mengisi</option></select></label></div>
			<div className="card tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Nama / Identitas</th><th scope="col">Divisi</th><th scope="col">Jabatan</th><th scope="col">Status</th><th scope="col">Aksi</th></tr></thead><tbody>{visible.map((e) => <tr key={e.id}><td>{e.name}<small className="qpr-entry-key">{e.memberKey}</small></td><td>{e.division || e.divisionSlug || "—"}</td><td>{e.memberRole || "—"}</td><td><span className={`badge ${e.done ? "open" : "draft"}`}>{e.done ? "Sudah mengisi" : "Belum mengisi"}</span>{e.submittedAt && <small className="qpr-entry-key">{new Date(e.submittedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</small>}</td><td><button className="btn ghost" disabled={frozen || busy || e.done} onClick={() => setRemove(e)}>Hapus</button></td></tr>)}{!visible.length && <tr><td colSpan={5}>Tidak ada pengisi yang cocok.</td></tr>}</tbody></table></div>
		</>}
		{tab === "preview" && (preview ? <><div className="card"><h2>Kesiapan kampanye</h2>{preview.blockers.length ? <ul>{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul> : <p>Tidak ada blocker.</p>}</div><QprPreview key={JSON.stringify(preview)} preview={preview} title={period.title} /></> : !error && <SkeletonCard />)}
		{tab === "responses" && (recap ? <div className="card"><h2>Respons kampanye</h2>{recap.sections ? <RecapV2 recap={recap} onExport={exportCsv} onExportDisabled={busy} /> : <><ParticipationMeter done={recap.done_entries} total={recap.total_entries} /><button className="btn ghost" disabled={busy} onClick={exportCsv}>Ekspor CSV</button><dl>{Object.entries(recap.category_averages).map(([key, mean]) => <div key={key}><dt>{key}</dt><dd>{mean}</dd></div>)}</dl>{recap.notes.map((note, index) => <blockquote key={index}>{note}</blockquote>)}</>}</div> : !error && <SkeletonCard />)}
		<AddEntriesModal open={showAdd} periodId={periodId} version={period.questions?.version} onClose={() => setShowAdd(false)} onAdded={async () => { setPreview(null); await load(); }} toast={toast} />
		<Confirm open={Boolean(remove)} title={`Hapus nama "${remove?.name || ""}"?`} confirmLabel="Ya, hapus" danger onCancel={() => setRemove(null)} onConfirm={() => { const entry = remove; setRemove(null); act(async () => { await api(`/admin/qpr/periods/${periodId}/entries/${entry.id}`, { method: "DELETE" }); setPreview(null); }); }}>Nama hanya dapat dihapus sebelum kampanye pertama dibuka.</Confirm>
		<Confirm open={Boolean(confirmStatus)} title={confirmStatus === "open" ? "Buka kampanye QPR?" : "Tutup pengisian QPR?"} confirmLabel={confirmStatus === "open" ? "Ya, buka" : "Ya, tutup"} onCancel={() => setConfirmStatus(null)} onConfirm={() => { const action = confirmStatus; setConfirmStatus(null); act(async () => { if (action === "open") { const check = await api(`/admin/qpr/periods/${periodId}/preview`); setPreview(check); if (check.blockers.length) { setParams({ tab: "preview" }); throw new Error("Konfigurasi belum lengkap. Periksa blocker."); } } await api(`/admin/qpr/periods/${periodId}/${action}`, { method: "POST" }); }); }}>{confirmStatus === "open" ? "Pertanyaan, target, dan roster terkunci permanen setelah pertama dibuka. Pastikan pratinjau sudah benar." : "Pengisi tidak dapat menyimpan atau mengirim saat kampanye ditutup. Kampanye dapat dibuka kembali tanpa mengubah snapshot."}</Confirm>
	</div>;
}

function QprPreview({ preview, title }) {
	const [entryId, setEntryId] = useState(preview.entries[0]?.id || "");
	const [step, setStep] = useState(0);
	const [answers, setAnswers] = useState({});
	const entry = preview.entries.find((e) => e.id === entryId);
	const sections = entry?.sections || [];
	const required = sections.flatMap((s) => s.questions).filter((q) => q.required);
	return <div className="qpr-preview"><p className="login-notice">Mode pratinjau. Jawaban hanya lokal dan tidak dikirim sebagai respons.</p><label className="field-label" htmlFor="qpr-preview-entry">Pratinjau sebagai pengisi</label><select id="qpr-preview-entry" value={entryId} onChange={(e) => { setEntryId(e.target.value); setStep(0); setAnswers({}); }}>{preview.entries.map((e) => <option key={e.id} value={e.id}>{e.display_name || e.name} · {e.role} · {e.required} wajib</option>)}</select>{!entry ? <p>Tambahkan pengisi untuk melihat jalur form.</p> : <div className="qpr-form-canvas"><div className="card qpr-form-header"><h1 className="qpr-title">{title}</h1><p>{entry.display_name || entry.name}</p><QprProgress filled={required.filter((q) => complete(q, answers)).length} total={required.length} /></div>{step < sections.length ? <QprSection section={sections[step]} answers={answers} legend={preview.scale_legend} onChange={(id, value) => setAnswers((a) => ({ ...a, [id]: value }))} /> : <QprReview sections={sections} answers={answers} onEdit={setStep} />}<div className="row-actions">{step > 0 && <button className="btn ghost" onClick={() => setStep(step - 1)}>Kembali</button>}{step < sections.length && <button className="btn" onClick={() => setStep(step + 1)}>{step === sections.length - 1 ? "Tinjau jawaban" : "Berikutnya"}</button>}</div></div>}</div>;
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
	return isSnapshot(roster.questions) ? <QprFill periodId={periodId} initialRoster={roster} /> : <PublicFillForm periodId={periodId} />;
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
		if (questions.some((q) => !scores[legacyQuestionKey(q)])) { toast("Isi semua skala dulu.", "err"); return; }
		setBusy(true);
		try {
			const answers = questions.map((q) => ({ label: q.label, category: q.category, score: scores[legacyQuestionKey(q)] }));
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
		<div className="qpr-form-canvas"><Card>
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
					<fieldset key={legacyQuestionKey(q)} className="qpr-question">
						<legend className="small" style={{ padding: "0 4px" }}><strong>{q.category}</strong> — {q.label}</legend>
						<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
							{[1, 2, 3, 4, 5].map((n) => (
								<label key={n} className="qpr-scale">
									<input type="radio" disabled={busy} aria-label={`${n} dari 5`} name={legacyQuestionKey(q)} checked={scores[legacyQuestionKey(q)] === n}
										onChange={() => setScores((s) => ({ ...s, [legacyQuestionKey(q)]: n }))} /> {n}
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
					<p className="field-help" role="status">{questions.filter((q) => scores[legacyQuestionKey(q)]).length} dari {questions.length} pertanyaan terisi</p>
					<button className="btn" disabled={busy || !name || questions.some((q) => !scores[legacyQuestionKey(q)])} onClick={submit}>{busy ? "Mengirim…" : "Kirim penilaian"}</button>
				</div>
			</div>}
		</Card></div>
	);
}
