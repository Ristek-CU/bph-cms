import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText, publicLink } from "../api.js";
import { useToast } from "../components/ui.jsx";

// Kontrak tipe field identik dengan landing page (student-voice).
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

	const createForm = async () => {
		const title = window.prompt("Judul form baru:");
		if (!title || !title.trim()) return;
		setCreating(true);
		try {
			await api("/admin/forms", { method: "POST", json: { title: title.trim() } });
			toast("Form draft dibuat — klik Edit untuk susun pertanyaan.");
			await load();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setCreating(false);
		}
	};

	return (
		<>
			{err && <div className="card err-text">{err}</div>}
			{canManage && (
				<div className="toolbar" style={{ marginBottom: 12 }}>
					<button className="btn gold" disabled={creating} onClick={createForm}>
						{creating ? "Membuat…" : "+ Form baru"}
					</button>
				</div>
			)}
			{forms === null ? (
				<div className="card muted">Memuat form…</div>
			) : forms.length === 0 ? (
				<div className="empty-state">
					<p>Belum ada form. {canManage ? "Buat form pertama divisi kamu." : ""}</p>
				</div>
			) : (
				<div className="card-list">
					{forms.map((f) => (
						<FormRow key={f.id} form={f} onDone={load} canManage={canManage} canSeeSubmissions={canSeeSubmissions} toast={toast} />
					))}
				</div>
			)}
		</>
	);
}

function FormRow({ form, onDone, canManage, canSeeSubmissions, toast }) {
	const [busy, setBusy] = useState(false);
	const [openEditor, setOpenEditor] = useState(false);
	const [openSubs, setOpenSubs] = useState(false);

	const act = async (fn) => {
		setBusy(true);
		try {
			await fn();
			await onDone();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="card">
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
				<div style={{ minWidth: 0 }}>
					<strong>{form.title}</strong>
					<div className="muted small">
						/{form.slug} · {STATUS_LABEL[form.status] ?? form.status} · {form.fields.length} pertanyaan
						{form.opens_at ? ` · buka ${new Date(form.opens_at).toLocaleString("id-ID")}` : ""}
						{form.closes_at ? ` · tutup ${new Date(form.closes_at).toLocaleString("id-ID")}` : ""}
					</div>
					{form.description && <div className="small" style={{ marginTop: 4 }}>{form.description}</div>}
				</div>
				<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
					<button className="btn ghost" disabled={busy} onClick={() => {
						if (form.status === "draft") { toast("Link aktif setelah form diterbitkan."); return; }
						navigator.clipboard?.writeText(publicFormLink(form.slug)).then(
							() => toast("Link publik disalin."),
							() => toast("Tidak bisa menyalin link.", "err"),
						);
					}}>Salin link</button>
					{canSeeSubmissions && (
						<button className="btn ghost" disabled={busy} onClick={() => setOpenSubs((v) => !v)}>Respons</button>
					)}
					{canManage && (
						<button className="btn ghost" disabled={busy} onClick={() => setOpenEditor((v) => !v)}>Edit</button>
					)}
					{canManage && form.status === "draft" && (
						<button className="btn" disabled={busy} onClick={() => act(() => api(`/admin/forms/${form.id}/publish`, { method: "POST" }))}>Terbitkan</button>
					)}
					{canManage && form.status === "published" && (
						<button className="btn" disabled={busy} onClick={() => act(() => api(`/admin/forms/${form.id}/close`, { method: "POST" }))}>Tutup</button>
					)}
					{canManage && (form.status === "closed" || form.status === "published") && (
						<button className="btn ghost" disabled={busy} onClick={() => act(() => api(`/admin/forms/${form.id}/unpublish`, { method: "POST" }))}>Draft-kan</button>
					)}
				</div>
			</div>
			{openEditor && (
				<Editor form={form} onDone={async () => { await onDone(); }} toast={toast} />
			)}
			{openSubs && <Submissions form={form} toast={toast} />}
		</div>
	);
}

function Editor({ form, onDone, toast }) {
	const [title, setTitle] = useState(form.title);
	const [description, setDescription] = useState(form.description || "");
	const [thankYou, setThankYou] = useState(form.thank_you_message || "");
	const [opensAt, setOpensAt] = useState(form.opens_at ? form.opens_at.slice(0, 16) : "");
	const [closesAt, setClosesAt] = useState(form.closes_at ? form.closes_at.slice(0, 16) : "");
	const [fields, setFields] = useState(form.fields.map((f) => ({ ...f, options: optionsToInput(f) })));
	const [busy, setBusy] = useState(false);

	const setField = (i, patch) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
	const moveField = (i, dir) =>
		setFields((fs) => {
			const next = [...fs];
			const [x] = next.splice(i, 1);
			next.splice(i + dir, 0, x);
			return next.map((f, j) => ({ ...f, sort_order: j }));
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
			await onDone();
		} catch (e) {
			toast(errText(e), "err");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div style={{ marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 14, display: "grid", gap: 14 }}>
			<div style={{ display: "grid", gap: 8 }}>
				<label className="field-label">Judul</label>
				<input value={title} onChange={(e) => setTitle(e.target.value)} />
				<label className="field-label">Deskripsi</label>
				<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
				<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
					<div>
						<label className="field-label">Buka (WIB)</label>
						<input type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} />
					</div>
					<div>
						<label className="field-label">Tutup (WIB)</label>
						<input type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} />
					</div>
				</div>
				<label className="field-label">Pesan terima kasih</label>
				<input value={thankYou} onChange={(e) => setThankYou(e.target.value)} />
			</div>

			<div>
				<label className="field-label">Pertanyaan</label>
				{fields.map((f, i) => (
					<div key={i} className="card" style={{ marginBottom: 8, padding: 12, display: "grid", gap: 6 }}>
						<div style={{ display: "flex", gap: 6, alignItems: "center" }}>
							<input style={{ flex: 1 }} placeholder="Pertanyaan…" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
							<select value={f.type} onChange={(e) => setField(i, { type: e.target.value })}>
								{FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
							</select>
							<label className="small" style={{ whiteSpace: "nowrap" }}>
								<input type="checkbox" checked={Boolean(f.required)} onChange={(e) => setField(i, { required: e.target.checked })} /> Wajib
							</label>
						</div>
						<input placeholder="Deskripsi/caption (opsional)" value={f.description || ""} onChange={(e) => setField(i, { description: e.target.value })} />
						{(CHOICE_TYPES.includes(f.type) || f.type === "linear_scale") && (
							<input
								placeholder={f.type === "linear_scale" ? "Skala: 1-5" : "Opsi, pisahkan dengan ; (mis. Ya;Tidak)"}
								value={f.options || ""}
								onChange={(e) => setField(i, { options: e.target.value })}
							/>
						)}
						<div style={{ display: "flex", gap: 6 }}>
							<button className="btn ghost" disabled={i === 0} onClick={() => moveField(i, -1)}>↑</button>
							<button className="btn ghost" disabled={i === fields.length - 1} onClick={() => moveField(i, 1)}>↓</button>
							<button className="btn ghost" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}>Hapus</button>
						</div>
					</div>
				))}
				<button className="btn ghost" onClick={() => setFields((fs) => [...fs, { ...emptyField(), sort_order: fs.length }])}>+ Pertanyaan</button>
			</div>

			<div>
				<button className="btn" disabled={busy || !title.trim()} onClick={save}>{busy ? "Menyimpan…" : "Simpan"}</button>
			</div>
		</div>
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

function Submissions({ form, toast }) {
	const [subs, setSubs] = useState(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		api(`/admin/forms/${form.id}/submissions`)
			.then((d) => setSubs(d.items || []))
			.catch((e) => toast(errText(e), "err"));
	}, [form.id, toast]);

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

	if (subs === null) return <div className="muted small" style={{ marginTop: 10 }}>Memuat respons…</div>;
	if (subs.length === 0) return <div className="muted small" style={{ marginTop: 10 }}>Belum ada respons.</div>;

	return (
		<div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12, display: "grid", gap: 10 }}>
			{subs.map((s) => (
				<div key={s.id} className="card" style={{ padding: 12 }}>
					<div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
						<span className="muted small">{new Date(s.created_at).toLocaleString("id-ID")} · {s.status}</span>
						<span style={{ display: "flex", gap: 6 }}>
							<select disabled={busy} value={s.status} onChange={(e) => setStatus(s.id, e.target.value)}>
								<option value="new">new</option>
								<option value="reviewed">reviewed</option>
								<option value="archived">archived</option>
							</select>
							<button className="btn ghost" disabled={busy} onClick={() => remove(s.id)}>Hapus</button>
						</span>
					</div>
					<table className="tbl" style={{ marginTop: 6 }}>
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
	);
}
