import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errText } from "../api.js";
import { useToast } from "../components/ui.jsx";

// Student Voice Studio — terinspirasi Campaign & Polling di Dashboard Advokasi:
// daftar form sebagai kartu (jumlah pertanyaan/respons terlihat), builder dan
// analitik sebagai halaman URL sendiri supaya bisa di-bookmark & back tidak reset.
const FIELD_TYPES = [
	["short_text", "Jawaban singkat"],
	["paragraph", "Paragraf"],
	["email", "Email"],
	["number", "Angka"],
	["multiple_choice", "Pilihan ganda"],
	["checkboxes", "Kotak centang"],
	["dropdown", "Dropdown"],
	["linear_scale", "Skala linear"],
	["date", "Tanggal"],
	["file", "Upload file"],
];
const CHOICE_TYPES = ["multiple_choice", "checkboxes", "dropdown"];
const STATUS_LABEL = { draft: "Draft", published: "Terbit", closed: "Ditutup" };

const emptyField = () => ({ label: "", description: "", type: "short_text", required: false, options: "", sort_order: 0 });

const publicFormLink = (slug) => `https://sga-cakrawala.org/student-voice/${slug}`;

export default function Forms({ user }) {
	const [forms, setForms] = useState(null);
	const [err, setErr] = useState("");
	const [newTitle, setNewTitle] = useState("");
	const [newDesc, setNewDesc] = useState("");
	const [creating, setCreating] = useState(false);
	const toast = useToast();
	const canManage = useMemo(
		() =>
			user?.permissions?.some((p) => p.startsWith("forms.create") || p.startsWith("forms.update") || p.startsWith("forms.publish")),
		[user],
	);
	const canSeeSubmissions = useMemo(() => user?.permissions?.some((p) => p.startsWith("forms.submissions")), [user]);

	const load = useCallback(async () => {
		try {
			setForms(await api("/admin/forms"));
			setErr("");
		} catch (e) {
			setErr(errText(e));
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const createForm = async (e) => {
		e.preventDefault();
		if (!newTitle.trim()) return;
		setCreating(true);
		try {
			const created = await api("/admin/forms", { method: "POST", json: { title: newTitle.trim(), description: newDesc.trim() || null } });
			toast("Form draft dibuat — susun pertanyaannya.");
			await load();
			window.location.hash = `#/forms/${created.id}`;
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setCreating(false);
		}
	};

	return (
		<>
			{/* Hero ala advo Campaign & Polling */}
			<div className="studio-hero">
				<p className="studio-kicker">Student Voice Studio</p>
				<h2>Form &amp; Polling</h2>
				<p className="muted">
					Setiap form punya pertanyaan, link publik, respons, dan ruang analitik sendiri.
				</p>
			</div>

			{err && <div className="card err-text">{err}</div>}

			<div className="studio-grid">
				<div className="studio-cards">
					{forms === null ? (
						<div className="card muted">Memuat form…</div>
					) : forms.length === 0 ? (
						<div className="empty-state studio-empty">
							<p>Belum ada form. Buat form pertama dari panel di samping.</p>
						</div>
					) : (
						forms.map((f) => (
							<FormCard key={f.id} form={f} canManage={canManage} canSeeSubmissions={canSeeSubmissions} toast={toast} />
						))
					)}
				</div>

				{canManage && (
					<div className="card studio-create">
						<div className="create-icon" aria-hidden>+</div>
						<h3>Form baru</h3>
						<p className="muted small">Mulai sebagai draft. Link publik aktif setelah diterbitkan.</p>
						<form onSubmit={createForm} style={{ display: "grid", gap: 10, marginTop: 12 }}>
							<div>
								<label className="field-label" htmlFor="nf-title">Nama form</label>
								<input id="nf-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={160} placeholder="Aspirasi Mahasiswa September" required />
							</div>
							<div>
								<label className="field-label" htmlFor="nf-desc">Deskripsi</label>
								<textarea id="nf-desc" rows={3} value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Tujuan dan konteks form…" />
							</div>
							<button className="btn gold" type="submit" disabled={creating || !newTitle.trim()}>
								{creating ? "Membuat…" : "Buat dan susun form"}
							</button>
						</form>
					</div>
				)}
			</div>
		</>
	);
}

function FormCard({ form, canManage, canSeeSubmissions, toast }) {
	const copyLink = () => {
		if (form.status === "draft") {
			toast("Link aktif setelah form diterbitkan.");
			return;
		}
		navigator.clipboard?.writeText(publicFormLink(form.slug)).then(
			() => toast("Link publik disalin."),
			() => toast("Tidak bisa menyalin link.", "err"),
		);
	};

	return (
		<div className="card form-card">
			<div className="accent" />
			<div className="form-card-body">
				<div className="title-row">
					<div style={{ minWidth: 0 }}>
						<h3 className="form-card-title">{form.title}</h3>
						<span className="slug">/{form.slug}</span>
					</div>
					<span className={`badge ${form.status}`}>{STATUS_LABEL[form.status] ?? form.status}</span>
				</div>
				<p className="muted small form-card-desc">
					{form.description || "Belum ada deskripsi form."}
				</p>
				<div className="form-card-counts">
					<span><strong>{form.fields.length}</strong> pertanyaan</span>
					<span><strong>{form.submission_count ?? 0}</strong> respons</span>
				</div>
				<div className="form-card-actions">
					<button className="btn ghost sm" onClick={copyLink}>Salin link</button>
					<Link className="btn sec sm" to={`/forms/${form.id}`}>Edit form</Link>
					{canSeeSubmissions && (
						<Link className="btn sm" to={`/forms/${form.id}/analytics`}>Analitik</Link>
					)}
				</div>
			</div>
		</div>
	);
}

/* ── Builder: halaman tersendiri #/forms/:formId ─────────────────────────── */
export function FormBuilderRoute({ user, loadForms }) {
	const { formId } = useParams();
	const navigate = useNavigate();
	const toast = useToast();
	const [form, setForm] = useState(undefined); // undefined = loading, null = 404

	const load = useCallback(async () => {
		try {
			setForm(await api(`/admin/forms/${formId}`));
		} catch {
			setForm(null);
		}
	}, [formId]);
	useEffect(() => {
		load();
	}, [load]);

	const canManage = useMemo(
		() => user?.permissions?.some((p) => p.startsWith("forms.update") || p.startsWith("forms.publish")),
		[user],
	);

	if (form === undefined) return <div className="card muted">Memuat form…</div>;
	if (form === null)
		return (
			<div className="empty-state">
				<p>Form tidak ditemukan — mungkin sudah dihapus.</p>
				<Link className="btn" to="/forms">Kembali ke daftar form</Link>
			</div>
		);

	return (
		<>
			<div className="studio-crumbrow">
				<Link className="btn ghost sm" to="/forms">← Semua form</Link>
				<span className={`badge ${form.status}`}>{STATUS_LABEL[form.status] ?? form.status}</span>
			</div>
			<Editor form={form} canManage={canManage} toast={toast} onSaved={async () => { await load(); await loadForms?.(); }} onDelete={() => navigate("/forms")} />
		</>
	);
}

/* ── Analitik: halaman penuh #/forms/:formId/analytics ───────────────────── */
export function FormAnalyticsRoute({ user }) {
	const { formId } = useParams();
	const toast = useToast();
	const canSeeSubmissions = useMemo(() => user?.permissions?.some((p) => p.startsWith("forms.submissions")), [user]);
	const [data, setData] = useState(undefined);

	useEffect(() => {
		if (!canSeeSubmissions) return;
		api(`/admin/forms/${formId}/analytics`)
			.then(setData)
			.catch((e) => {
				toast(errText(e), "err");
				setData(null);
			});
	}, [formId, toast, canSeeSubmissions]);

	if (!canSeeSubmissions)
		return (
			<div className="empty-state">
				<p>Akun ini tidak punya akses analitik.</p>
				<Link className="btn" to="/forms">Kembali</Link>
			</div>
		);
	if (data === undefined) return <div className="card muted">Memuat analitik…</div>;
	if (data === null)
		return (
			<div className="empty-state">
				<p>Analitik tidak tersedia.</p>
				<Link className="btn" to="/forms">Kembali ke daftar form</Link>
			</div>
		);

	return (
		<>
			<div className="studio-crumbrow">
				<Link className="btn ghost sm" to="/forms">← Semua form</Link>
				<span className={`badge ${data.status}`}>{STATUS_LABEL[data.status] ?? data.status}</span>
			</div>
			<Analytics data={data} />
			<SubmissionsSection formId={formId} toast={toast} />
		</>
	);
}

function SubmissionsSection({ formId, toast }) {
	const [subs, setSubs] = useState(undefined);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api(`/admin/forms/${formId}/submissions`)
			.then((d) => setSubs(d.items || []))
			.catch((e) => {
				toast(errText(e), "err");
				setSubs([]);
			});
	}, [formId, toast]);

	const setStatus = async (id, status) => {
		setBusy(true);
		try {
			await api(`/admin/forms/submissions/${id}`, { method: "PUT", json: { status } });
			setSubs((ss) => ss.map((s) => (s.id === id ? { ...s, status } : s)));
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id) => {
		if (!window.confirm("Hapus respons ini permanen?")) return;
		setBusy(true);
		try {
			await api(`/admin/forms/submissions/${id}`, { method: "DELETE" });
			setSubs((ss) => ss.filter((s) => s.id !== id));
			toast("Respons dihapus.");
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	if (subs === undefined) return <div className="card muted">Memuat respons…</div>;

	return (
		<div className="card" style={{ marginTop: 16 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
				<h3>Respons masuk ({subs.length})</h3>
				<button className="btn ghost sm" disabled={busy || subs.length === 0} onClick={() => exportCsv(subs, formId, toast)}>Ekspor CSV</button>
			</div>
			{subs.length === 0 ? (
				<p className="muted">Belum ada respons.</p>
			) : (
				<div style={{ display: "grid", gap: 10 }}>
					{subs.map((s) => (
						<div key={s.id} className="sess">
							<div className="sess-head">
								<strong>{new Date(s.created_at).toLocaleString("id-ID")}</strong>
								<span style={{ display: "flex", gap: 6, alignItems: "center" }}>
									<select disabled={busy} value={s.status} onChange={(e) => setStatus(s.id, e.target.value)} aria-label="Status respons">
										<option value="new">new</option>
										<option value="reviewed">reviewed</option>
										<option value="archived">archived</option>
									</select>
									<button className="btn danger sm" disabled={busy} onClick={() => remove(s.id)}>Hapus</button>
								</span>
							</div>
							<table className="tbl">
								<tbody>
									{s.answers.map((a, i) => (
										<tr key={i}>
											<td style={{ width: "40%" }}>{a.label}</td>
											<td>{Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

/* ── Editor form (builder) ────────────────────────────────────────────────── */
function Editor({ form, canManage, toast, onSaved, onDelete }) {
	const [title, setTitle] = useState(form.title);
	const [description, setDescription] = useState(form.description || "");
	const [thankYou, setThankYou] = useState(form.thank_you_message || "");
	const [opensAt, setOpensAt] = useState(form.opens_at ? form.opens_at.slice(0, 16) : "");
	const [closesAt, setClosesAt] = useState(form.closes_at ? form.closes_at.slice(0, 16) : "");
	const [fields, setFields] = useState(form.fields.map((f) => ({ ...f, options: optionsToInput(f) })));
	const [openMap, setOpenMap] = useState(() => new Set(form.fields.slice(0, 3).map((f) => f.id)));
	const [busy, setBusy] = useState(false);
	const [askDelete, setAskDelete] = useState(false);

	const setField = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
	const moveField = (i, dir) =>
		setFields((fs) => {
			const next = [...fs];
			const [x] = next.splice(i, 1);
			next.splice(i + dir, 0, x);
			return next.map((f, j) => ({ ...f, sort_order: j }));
		});
	const toggleOpen = (id) =>
		setOpenMap((m) => {
			const next = new Set(m);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const save = async () => {
		setBusy(true);
		try {
			const body = {
				title,
				description: description || null,
				thank_you_message: thankYou || undefined,
				opens_at: opensAt ? `${opensAt}:00+07:00` : null,
				closes_at: closesAt ? `${closesAt}:00+07:00` : null,
				fields: fields.map((f, i) => ({
					label: f.label,
					description: f.description || null,
					type: f.type,
					required: Boolean(f.required),
					options: parseOptionsInput(f),
					sort_order: i,
				})),
			};
			await api(`/admin/forms/${form.id}`, { method: "PUT", json: body });
			toast("Form tersimpan.");
			await onSaved();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	const publish = async () => {
		setBusy(true);
		try {
			await api(`/admin/forms/${form.id}/publish`, { method: "POST" });
			toast("Form diterbitkan — link publik aktif.");
			await onSaved();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	const doDelete = async () => {
		setBusy(true);
		try {
			await api(`/admin/forms/${form.id}`, { method: "DELETE" });
			toast("Form dihapus.");
			onDelete();
		} catch (e) {
			toast(errText(e), "err");
			setBusy(false);
			setAskDelete(false);
		}
	};

	return (
		<>
			<div className="card">
				<div className="section">
					<div className="section-head">
						<div className="section-num">1</div>
						<div>
							<h2>Detail form</h2>
							<p>Identitas yang dilihat pengisi di halaman publik.</p>
						</div>
					</div>
					<label className="field-label">Judul</label>
					<input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} />
					<label className="field-label">Deskripsi</label>
					<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage} />
					<div className="grid-2">
						<div>
							<label className="field-label">Buka (WIB)</label>
							<input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} disabled={!canManage} />
						</div>
						<div>
							<label className="field-label">Tutup (WIB)</label>
							<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} disabled={!canManage} />
						</div>
					</div>
					<label className="field-label">Pesan terima kasih</label>
					<input value={thankYou} onChange={(e) => setThankYou(e.target.value)} disabled={!canManage} />
				</div>

				<div className="section">
					<div className="section-head">
						<div className="section-num">2</div>
						<div>
							<h2>Susunan pertanyaan</h2>
							<p>Klik pertanyaan untuk membuka editornya. Jawaban lama menyimpan snapshot label.</p>
						</div>
					</div>
					{fields.map((f, i) => (
						<div key={f.id ?? i} className="field-block">
							<button type="button" className="field-block-head" onClick={() => toggleOpen(f.id)} aria-expanded={openMap.has(f.id)}>
								<span className="field-num">{i + 1}</span>
								<span className="field-block-label">{f.label || "(pertanyaan kosong)"}</span>
								{Boolean(f.required) && <span className="badge published">Wajib</span>}
								<span className="badge draft">{FIELD_TYPES.find(([v]) => v === f.type)?.[1] ?? f.type}</span>
							</button>
							{openMap.has(f.id) && (
								<div className="field-block-body">
									<label className="field-label">Pertanyaan</label>
									<input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Pertanyaan…" disabled={!canManage} />
									<label className="field-label">Deskripsi/caption</label>
									<input value={f.description || ""} onChange={(e) => setField(i, { description: e.target.value })} placeholder="Opsional" disabled={!canManage} />
									<div className="grid-2">
										<div>
											<label className="field-label">Tipe</label>
											<select value={f.type} onChange={(e) => setField(i, { type: e.target.value })} disabled={!canManage}>
												{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
											</select>
										</div>
										<div className="check-row" style={{ marginTop: 26 }}>
											<input id={`req-${f.id ?? i}`} type="checkbox" checked={Boolean(f.required)} onChange={(e) => setField(i, { required: e.target.checked })} disabled={!canManage} />
											<label htmlFor={`req-${f.id ?? i}`} className="field-label" style={{ margin: 0 }}>Wajib diisi</label>
										</div>
									</div>
									{(CHOICE_TYPES.includes(f.type) || f.type === "linear_scale") && (
										<>
											<label className="field-label">{f.type === "linear_scale" ? "Skala" : "Opsi"}</label>
											<input
												placeholder={f.type === "linear_scale" ? "1-5" : "Pisahkan dengan ; (mis. Ya;Tidak)"}
												value={f.options || ""}
												onChange={(e) => setField(i, { options: e.target.value })}
												disabled={!canManage}
											/>
										</>
									)}
									<div style={{ display: "flex", gap: 6, marginTop: 10 }}>
										<button type="button" className="btn ghost sm" disabled={!canManage || i === 0} onClick={() => moveField(i, -1)}>↑ Naik</button>
										<button type="button" className="btn ghost sm" disabled={!canManage || i === fields.length - 1} onClick={() => moveField(i, 1)}>↓ Turun</button>
										<button type="button" className="btn danger sm" disabled={!canManage} onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>Hapus</button>
									</div>
								</div>
							)}
						</div>
					))}
					{canManage && (
						<button type="button" className="btn sec" onClick={() => setFields((fs) => [...fs, { ...emptyField(), sort_order: fs.length }])}>
							+ Pertanyaan
						</button>
					)}
				</div>

				<div className="sticky-bar">
					<button className="btn" disabled={busy || !canManage || !title.trim()} onClick={save}>{busy ? "Menyimpan…" : "Simpan"}</button>
					{canManage && form.status === "draft" && (
						<button className="btn gold" disabled={busy} onClick={publish}>Terbitkan</button>
					)}
					{canManage && form.status === "published" && (
						<button className="btn sec" disabled={busy} onClick={() => api(`/admin/forms/${form.id}/close`, { method: "POST" }).then(onSaved).catch((e) => toast(errText(e), "err"))}>Tutup</button>
					)}
					<Link className="btn ghost" to={`/forms/${form.id}/analytics`}>Analitik &amp; respons</Link>
					{canManage && (
						<button className="btn danger" style={{ marginLeft: "auto" }} onClick={() => setAskDelete(true)}>Hapus</button>
					)}
				</div>
			</div>

			{askDelete && (
				<div className="modal-backdrop" onClick={() => setAskDelete(false)}>
					<div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
						<h3>Hapus form "{form.title}"?</h3>
						<p>Form yang masih punya respons tidak bisa dihapus — hapus responsnya dulu.</p>
						<div className="row-actions">
							<button className="btn ghost" onClick={() => setAskDelete(false)}>Batal</button>
							<button className="btn danger" onClick={doDelete}>Ya, hapus</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
}

function optionsToInput(field) {
	if (field.type === "linear_scale" && field.options && typeof field.options === "object") {
		return `${field.options.min}-${field.options.max}`;
	}
	if (Array.isArray(field.options)) return field.options.join(";");
	return "";
}

function parseOptionsInput(field) {
	const raw = (field.options || "").trim();
	if (!raw) return null;
	if (field.type === "linear_scale") {
		const m = raw.match(/^(\d+)\s*-\s*(\d+)$/);
		return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
	}
	if (CHOICE_TYPES.includes(field.type)) {
		return raw.split(";").map((s) => s.trim()).filter(Boolean);
	}
	return null;
}

/* ── Analitik (gaya advo Campaign Analytics) ─────────────────────────────── */
function Analytics({ data }) {
	const maxDay = Math.max(1, ...data.last_7_days.map((d) => d.count));
	const week = data.last_7_days.reduce((s, d) => s + d.count, 0);

	return (
		<div className="studio-analytics">
			<div className="stat-grid">
				<div className="stat hero"><div className="num">{data.total_submissions}</div><div className="lbl">Total respons</div></div>
				<div className="stat"><div className="num">{week}</div><div className="lbl">Respons 7 hari</div></div>
				<div className="stat"><div className="num">{data.fields.length}</div><div className="lbl">Pertanyaan</div></div>
				<div className="stat"><div className="num">{STATUS_LABEL[data.status] ?? data.status}</div><div className="lbl">Status</div></div>
			</div>

			<div className="card">
				<h3 style={{ marginBottom: 12 }}>Tren respons 7 hari</h3>
				<div className="trend-row">
					{data.last_7_days.map((d) => (
						<div key={d.date} className="trend-col" title={`${d.date}: ${d.count}`}>
							<span className="small" style={{ fontWeight: 600 }}>{d.count || ""}</span>
							<div className="trend-bar" style={{ height: `${Math.max(4, (d.count / maxDay) * 120)}px` }} />
							<span className="muted" style={{ fontSize: 11 }}>
								{new Date(d.date).toLocaleDateString("id-ID", { weekday: "short" })}
							</span>
						</div>
					))}
				</div>
			</div>

			<h3 style={{ margin: "4px 0 2px" }}>Analytics per pertanyaan</h3>
			<p className="muted small" style={{ marginBottom: 10 }}>Distribusi pilihan tampil sebagai bar; jawaban bebas menampilkan respons terbaru.</p>
			<div className="studio-analytics-grid">
				{data.fields.map((f) => (
					<FieldAnalytics key={f.id} field={f} total={data.total_submissions} />
				))}
			</div>
		</div>
	);
}

function FieldAnalytics({ field, total }) {
	return (
		<div className="card" style={{ marginBottom: 0 }}>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
				<strong className="small">{field.label}</strong>
				<span className="badge upcoming">{field.response_rate}% dijawab</span>
			</div>
			{field.distribution && (
				<div style={{ marginTop: 10, display: "grid", gap: 5 }}>
					{Object.entries(field.distribution).map(([opt, count]) => {
						const max = Math.max(1, ...Object.values(field.distribution));
						return (
							<div key={opt} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 200px) 1fr 40px", alignItems: "center", gap: 8 }}>
								<span className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt}</span>
								<div style={{ background: "#eef2f5", borderRadius: 4, height: 10 }}>
									<div style={{ background: "var(--teal)", width: `${(count / max) * 100}%`, height: "100%", borderRadius: 4 }} />
								</div>
								<span className="muted small" style={{ textAlign: "right" }}>{count}</span>
							</div>
						);
					})}
				</div>
			)}
			{field.average !== null && (
				<div style={{ marginTop: 10 }}>
					<span className="small"><strong>Rata-rata: {Math.round(field.average * 100) / 100}</strong></span>
					<div style={{ background: "#eef2f5", borderRadius: 4, height: 10, marginTop: 4, maxWidth: 300 }}>
						<div style={{ background: "var(--gold)", width: `${Math.min(100, (field.average / 5) * 100)}%`, height: "100%", borderRadius: 4 }} />
					</div>
				</div>
			)}
			{!field.distribution && field.average === null && field.recent.length > 0 && (
				<div style={{ marginTop: 10, display: "grid", gap: 6 }}>
					{field.recent.slice(0, 5).map((v, i) => (
						<blockquote key={i} className="answer-quote">{typeof v === "string" && v.length > 120 ? `${v.slice(0, 120)}…` : String(v)}</blockquote>
					))}
				</div>
			)}
			{total === 0 && <div className="muted small" style={{ marginTop: 8 }}>Belum ada respons.</div>}
		</div>
	);
}

/* ── Ekspor CSV (halaman analitik) ────────────────────────────────────────── */
async function exportCsv(subs, formId, toast) {
	try {
		const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		let all = subs;
		if (subs.length >= 100) {
			// Banyak respons — ambil semua halaman sebelum menyusun CSV.
			all = [];
			for (let page = 1; ; page++) {
				const d = await api(`/admin/forms/${formId}/submissions?page=${page}&per_page=100`);
				all = all.concat(d.items || []);
				if (!d.items || d.items.length < 100) break;
			}
		}
		if (!all.length) { toast("Belum ada respons untuk diekspor.", "err"); return; }
		const headerSet = [];
		for (const s of all) for (const a of s.answers) if (!headerSet.includes(a.label)) headerSet.push(a.label);
		const rows = [
			["waktu", "status", ...headerSet].map(csvEscape).join(","),
			...all.map((s) => [
				new Date(s.created_at).toLocaleString("id-ID"),
				s.status,
				...headerSet.map((label) => {
					const a = s.answers.find((x) => x.label === label);
					if (!a) return "";
					return Array.isArray(a.value) ? a.value.join("; ") : String(a.value);
				}).map(csvEscape),
			].join(",")),
		];
		const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `form-respons-${formId.slice(0, 8)}.csv`;
		link.click();
		URL.revokeObjectURL(url);
		toast(`${all.length} respons diekspor.`);
	} catch (e) {
		toast(errText(e), "err");
	}
}
