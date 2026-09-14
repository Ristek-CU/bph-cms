import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errText } from "../api.js";
import { useToast, useEscape, useFocusTrap, Confirm, SkeletonCard } from "../components/ui.jsx";
import { IconPlus, IconPencil, IconTrash, IconGrip, IconLink, IconCheck } from "../components/Icons.jsx";

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

// ID sementara (temp-N) untuk field baru — tanpa ini semua field baru share
// undefined, openMap (Set of id) toggle semua sekaligus.
let tempFieldSeq = 0;
const emptyField = () => ({ id: `temp-${++tempFieldSeq}`, label: "", description: "", type: "short_text", required: false, options: "", sort_order: 0 });

const publicFormLink = (slug) => `https://sga-cakrawala.org/student-voice/${slug}`;
const fieldTypeName = (t) => FIELD_TYPES.find(([v]) => v === t)?.[1] ?? t;

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
			const d = await api("/admin/forms");
			setForms(d.items || d || []);
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
						<SkeletonCard />
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
export function FormBuilderRoute({ user }) {
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

	if (form === undefined) return <SkeletonCard lines={5} />;
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
			{/* onSaved: refresh detail saja — daftar form di /forms me-load sendiri saat mount,
			    dulu prop loadForms malah memanggil loader events (salah ketik). */}
			<Editor form={form} canManage={canManage} toast={toast} onSaved={load} onDelete={() => navigate("/forms")} />
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
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [busy, setBusy] = useState(false);
	const [askRemove, setAskRemove] = useState(null);
	const perPage = 25;

	const loadPage = useCallback(
		(p) => {
			api(`/admin/forms/${formId}/submissions?page=${p}&per_page=${perPage}`)
				.then((d) => {
					setSubs(d.items || []);
					setTotal(d.meta?.total ?? (d.items || []).length);
				})
				.catch((e) => {
					toast(errText(e), "err");
					setSubs([]);
				});
		},
		[formId, toast],
	);
	useEffect(() => {
		loadPage(page);
	}, [page, loadPage]);

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
		setAskRemove(null);
		setBusy(true);
		try {
			await api(`/admin/forms/submissions/${id}`, { method: "DELETE" });
			setSubs((ss) => ss.filter((s) => s.id !== id));
			setTotal((t) => Math.max(0, t - 1));
			toast("Respons dihapus.");
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	if (subs === undefined) return <SkeletonCard lines={4} />;

	const pages = Math.max(1, Math.ceil(total / perPage));

	return (
		<div className="card" style={{ marginTop: 16 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
				<h3>Respons masuk ({total})</h3>
				<button className="btn ghost sm" disabled={busy || total === 0} onClick={() => exportCsv(formId, toast)}>Ekspor CSV</button>
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
									<button className="btn danger sm" disabled={busy} onClick={() => setAskRemove(s.id)}>Hapus</button>
								</span>
							</div>
							<div className="tbl-wrap">
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
						</div>
					))}
				</div>
			)}
			{pages > 1 && (
				<div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
					<button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Sebelumnya</button>
					<span className="muted small">Halaman {page} / {pages}</span>
					<button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Berikutnya →</button>
				</div>
			)}
			<Confirm
				open={Boolean(askRemove)}
				title="Hapus respons ini?"
				confirmLabel="Ya, hapus"
				danger
				onConfirm={() => remove(askRemove)}
				onCancel={() => setAskRemove(null)}
			>
				Respons dihapus permanen beserta jawabannya.
			</Confirm>
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
	const [busy, setBusy] = useState(false);
	const [askDelete, setAskDelete] = useState(false);

	// Dialog field ala advo: null = tutup, "new" = tambah, object = edit field itu.
	const [dialog, setDialog] = useState(null);
	const [askField, setAskField] = useState(null); // field yang mau dihapus
	const [dragId, setDragId] = useState(null);
	const [overId, setOverId] = useState(null);

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

	// Tutup / batal terbit / buka kembali — satu helper, busy di-handle rapi.
	const setStatus = async (path, okMsg) => {
		setBusy(true);
		try {
			await api(`/admin/forms/${form.id}/${path}`, { method: "POST" });
			toast(okMsg);
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

	// Drag-drop reorder ala advo form-builder (native HTML5, tanpa lib).
	const dropOn = (targetId) => {
		if (dragId !== null && dragId !== targetId) {
			setFields((fs) => {
				const from = fs.findIndex((f) => f.id === dragId);
				const to = fs.findIndex((f) => f.id === targetId);
				if (from < 0 || to < 0) return fs;
				const next = [...fs];
				const [x] = next.splice(from, 1);
				next.splice(to, 0, x);
				return next.map((f, j) => ({ ...f, sort_order: j }));
			});
		}
		setDragId(null);
		setOverId(null);
	};

	return (
		<>
			{/* Header ala advo [id]: back + kicker + judul + badge + meta */}
			<div className="studio-crumbrow">
				<Link className="btn ghost sm" to="/forms">← Semua form</Link>
			</div>
			<div className="builder-head">
				<div className="builder-head-main">
					<p className="studio-kicker">Form workspace</p>
					<div className="builder-title-row">
						<h1>{form.title}</h1>
						<span className={`badge ${form.status}`}>{STATUS_LABEL[form.status] ?? form.status}</span>
					</div>
					<p className="muted small">
						{fields.length} pertanyaan · /{form.slug}
					</p>
				</div>
				<div className="builder-head-actions">
					<a className="btn sec sm" href={form.status === "draft" ? undefined : publicFormLink(form.slug)} target="_blank" rel="noreferrer" aria-disabled={form.status === "draft"} onClick={(e) => e.preventDefault()}>Form publik</a>
					<Link className="btn sm" to={`/forms/${form.id}/analytics`}>Analitik</Link>
				</div>
			</div>

			<ShareCard form={form} toast={toast} />

			<div className="card builder-card">
				<div className="builder-card-head">
					<h2>Konfigurasi &amp; publikasi</h2>
				</div>
				<div className="section" style={{ marginBottom: 0 }}>
					<div className="section-head">
						<div className="section-num">1</div>
						<div>
							<h2>Detail form</h2>
							<p>Identitas yang dilihat pengisi di halaman publik.</p>
						</div>
					</div>
					<label className="field-label" htmlFor="fd-title">Judul</label>
					<input id="fd-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canManage} />
					<label className="field-label" htmlFor="fd-desc">Deskripsi</label>
					<textarea id="fd-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canManage} />
					<div className="grid-2">
						<div>
							<label className="field-label" htmlFor="fd-opens">Buka (WIB)</label>
							<input id="fd-opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} disabled={!canManage} />
						</div>
						<div>
							<label className="field-label" htmlFor="fd-closes">Tutup (WIB)</label>
							<input id="fd-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} disabled={!canManage} />
						</div>
					</div>
					<label className="field-label" htmlFor="fd-thanks">Pesan terima kasih</label>
					<input id="fd-thanks" value={thankYou} onChange={(e) => setThankYou(e.target.value)} disabled={!canManage} />
				</div>
			</div>

			<section className="builder-fields">
				<div className="builder-fields-head">
					<div>
						<h2>Susunan pertanyaan</h2>
						<p className="muted small">Tarik <IconGrip size={13} /> untuk mengubah urutan. Jawaban lama menyimpan snapshot label, jadi histori tetap aman.</p>
					</div>
					{canManage && (
						<button type="button" className="btn" onClick={() => setDialog("new")}>
							<span style={{ display: "inline-flex", marginRight: 6 }}><IconPlus size={15} /></span>
							Tambah Pertanyaan
						</button>
					)}
				</div>
				<ol className="field-list">
					{fields.map((f, i) => (
						<li
							key={f.id}
							className={`field-row${dragId === f.id ? " dragging" : ""}${overId === f.id && dragId !== f.id ? " over" : ""}`}
							draggable={canManage}
							onDragStart={(e) => { setDragId(f.id); e.dataTransfer.effectAllowed = "move"; }}
							onDragOver={(e) => { e.preventDefault(); if (f.id !== dragId) setOverId(f.id); }}
							onDragLeave={() => { if (overId === f.id) setOverId(null); }}
							onDrop={(e) => { e.preventDefault(); dropOn(f.id); }}
							onDragEnd={() => { setDragId(null); setOverId(null); }}
						>
							{canManage && <span className="field-grip" aria-hidden><IconGrip size={15} /></span>}
							<span className="field-num">{i + 1}</span>
							<div className="field-row-main">
								<div className="field-row-badges">
									<span className="field-row-label">{f.label || "(pertanyaan kosong)"}</span>
									{Boolean(f.required) && <span className="req-star">*</span>}
									<span className="badge outline">{fieldTypeName(f.type)}</span>
								</div>
								{f.options && (
									<p className="muted field-row-opts">
										{f.type === "linear_scale" ? "Skala" : "Opsi"}: {f.type === "linear_scale" ? f.options : f.options.split(";").map((s) => s.trim()).filter(Boolean).join(" · ")}
									</p>
								)}
							</div>
							{canManage && (
								<div className="field-row-actions">
									<button type="button" className="icon-btn" onClick={() => setDialog(f)} aria-label={`Edit pertanyaan ${f.label || i + 1}`}><IconPencil size={15} /></button>
									<button type="button" className="icon-btn danger" onClick={() => setAskField(f)} aria-label={`Hapus pertanyaan ${f.label || i + 1}`}><IconTrash size={15} /></button>
								</div>
							)}
						</li>
					))}
				</ol>
				{fields.length === 0 && (
					<div className="empty-state"><p>Belum ada pertanyaan.</p></div>
				)}

				<div className="sticky-bar">
					<button className="btn" disabled={busy || !canManage || !title.trim()} onClick={save}>{busy ? "Menyimpan…" : "Simpan"}</button>
					{canManage && form.status === "draft" && (
						<button className="btn gold" disabled={busy} onClick={publish}>Terbitkan</button>
					)}
					{canManage && form.status === "published" && (
						<button className="btn sec" disabled={busy} onClick={() => setStatus("close", "Form ditutup — tidak menerima respons baru.")}>Tutup</button>
					)}
					{canManage && form.status === "published" && (
						<button className="btn ghost" disabled={busy} onClick={() => setStatus("unpublish", "Form kembali ke draft — link publik mati.")}>Batalkan terbit</button>
					)}
					{canManage && form.status === "closed" && (
						<button className="btn gold" disabled={busy} onClick={() => setStatus("publish", "Form dibuka kembali.")}>Buka kembali</button>
					)}
					{canManage && (
						<button className="btn danger" style={{ marginLeft: "auto" }} onClick={() => setAskDelete(true)}>Hapus form</button>
					)}
				</div>
			</section>

			{dialog !== null && (
				<FieldDialog
					key={dialog === "new" ? "create" : `edit-${dialog.id}`}
					field={dialog === "new" ? null : dialog}
					onSubmit={(draft) => {
						setFields((fs) => {
							if (dialog === "new") return [...fs, { ...emptyField(), ...draft, sort_order: fs.length }];
							return fs.map((f) => (f.id === dialog.id ? { ...f, ...draft } : f));
						});
						setDialog(null);
					}}
					onCancel={() => setDialog(null)}
				/>
			)}

			<Confirm
				open={Boolean(askField)}
				title="Hapus pertanyaan?"
				confirmLabel="Ya, hapus"
				danger
				onConfirm={() => {
					setFields((fs) => fs.filter((f) => f.id !== askField.id).map((f, j) => ({ ...f, sort_order: j })));
					setAskField(null);
				}}
				onCancel={() => setAskField(null)}
			>
				Pertanyaan &quot;{askField?.label}&quot; dihapus dari susunan. Jawaban yang sudah masuk tetap tersimpan.
			</Confirm>

			<Confirm
				open={askDelete}
				title={`Hapus form "${form.title}"?`}
				confirmLabel="Ya, hapus"
				danger
				onConfirm={doDelete}
				onCancel={() => setAskDelete(false)}
			>
				Form yang masih punya respons tidak bisa dihapus — hapus responsnya dulu.
			</Confirm>
		</>
	);
}

/* ── Kartu bagikan link (ala advo CampaignQrCard, tanpa QR) ────────────────── */
function ShareCard({ form, toast }) {
	const [copied, setCopied] = useState(false);
	const url = publicFormLink(form.slug);

	const copy = () => {
		if (form.status === "draft") {
			toast("Link aktif setelah form diterbitkan.");
			return;
		}
		navigator.clipboard?.writeText(url).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1800);
		}, () => toast("Tidak bisa menyalin link.", "err"));
	};

	return (
		<div className="card share-card" id="share-link">
			<div className="share-card-deco" aria-hidden />
			<div className="share-card-icon" aria-hidden><IconLink size={20} /></div>
			<div className="share-card-main">
				<p className="studio-kicker">Bagikan form</p>
				<p className="share-card-tag">Salin, sebar, kumpulkan respons.</p>
				<div className="share-link-row">
					<code>{url}</code>
					<button type="button" className="btn ghost sm" onClick={copy}>
						{copied ? <><IconCheck size={14} /> Tersalin</> : "Salin"}
					</button>
				</div>
				{form.status === "draft" && <p className="muted small">Link baru aktif setelah form diterbitkan.</p>}
				<div className="share-card-actions">
					{form.status !== "draft" && (
						<a className="btn sec sm" href={url} target="_blank" rel="noreferrer">Buka form publik</a>
					)}
				</div>
			</div>
		</div>
	);
}

/* ── Dialog tambah/edit pertanyaan (ala advo FieldDialog) ──────────────────── */
function FieldDialog({ field, onSubmit, onCancel }) {
	const isEdit = Boolean(field);
	// Tipe terkunci saat edit — ganti tipe jawaban field berisi respons merusak data.
	const [label, setLabel] = useState(field?.label || "");
	const [description, setDescription] = useState(field?.description || "");
	const [type, setType] = useState(field?.type || "short_text");
	const [required, setRequired] = useState(Boolean(field?.required));
	const [options, setOptions] = useState(
		field?.type === "linear_scale" ? field.options : String(field?.options || "").split(";").map((s) => s.trim()).filter(Boolean).join("\n"),
	);
	const ref = useFocusTrap(true);
	useEscape(onCancel);
	const showOptions = CHOICE_TYPES.includes(type) || type === "linear_scale";

	const submit = (e) => {
		e.preventDefault();
		if (!label.trim()) return;
		onSubmit({
			label: label.trim(),
			description: description.trim() || "",
			type,
			required,
			options: type === "linear_scale" ? options : options,
		});
	};

	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div ref={ref} className="modal field-dialog" tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isEdit ? "Edit pertanyaan" : "Tambah pertanyaan"}>
				<h3>{isEdit ? "Edit Pertanyaan" : "Tambah Pertanyaan"}</h3>
				<p className="muted small">{isEdit ? `Field "${field.label}"` : "Pertanyaan baru tampil di form publik setelah disimpan."}</p>
				<form onSubmit={submit} style={{ display: "grid", gap: 2 }}>
					<label className="field-label" htmlFor="dlg-label">Pertanyaan *</label>
					<input id="dlg-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={500} placeholder="Contoh: Jurusan/Prodi" required autoFocus />
					<label className="field-label" htmlFor="dlg-desc">Deskripsi/caption</label>
					<input id="dlg-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opsional" />
					<label className="field-label" htmlFor="dlg-type">Tipe *</label>
					<select id="dlg-type" value={type} onChange={(e) => setType(e.target.value)} disabled={isEdit}>
						{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
					</select>
					{isEdit && <p className="field-help">Tipe terkunci saat edit agar jawaban lama tetap konsisten.</p>}
					{showOptions && (
						<>
							<label className="field-label" htmlFor="dlg-opts">{type === "linear_scale" ? "Skala (min-maks)" : "Opsi (satu per baris)"}</label>
							{type === "linear_scale" ? (
								<input id="dlg-opts" value={options} onChange={(e) => setOptions(e.target.value)} placeholder="1-5" />
							) : (
								<textarea id="dlg-opts" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} placeholder={"Opsi A\nOpsi B\nOpsi C"} />
							)}
						</>
					)}
					<div className="check-row">
						<input id="dlg-req" type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
						<label htmlFor="dlg-req" className="field-label" style={{ margin: 0 }}>Wajib diisi</label>
					</div>
					<div className="row-actions" style={{ marginTop: 18 }}>
						<button type="button" className="btn ghost" onClick={onCancel}>Batal</button>
						<button type="submit" className="btn">{isEdit ? "Simpan" : "Tambah"}</button>
					</div>
				</form>
			</div>
		</div>
	);
}

function optionsToInput(field) {
	if (field.type === "linear_scale" && field.options && typeof field.options === "object") {
		return `${field.options.min}-${field.options.max}`;
	}
	if (Array.isArray(field.options)) return field.options.join("\n");
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
		return raw.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
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
async function exportCsv(formId, toast) {
	try {
		const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		// Selalu paginate dari halaman 1 — fetch awal list hanya per_page=20,
		// jadi tidak bisa dipakai menilai total respons.
		let all = [];
		for (let page = 1; ; page++) {
			const d = await api(`/admin/forms/${formId}/submissions?page=${page}&per_page=100`);
			all = all.concat(d.items || []);
			if (!d.items || d.items.length < 100) break;
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
