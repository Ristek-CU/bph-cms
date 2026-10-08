import { useLayoutEffect, useState } from "react";
import { api, errText, isoToInput, toIsoWib } from "../api.js";
import { Confirm, useUnsavedChanges } from "../components/ui.jsx";

// ponytail: recovery survives same-document navigation; beforeunload protects reloads.
export const editorDrafts = new Map();

export default function QprEditor({ period, draftKey, onDiscard, onSaved, toast, onDirty }) {
	const [recovered] = useState(() => editorDrafts.get(draftKey));
	const [baseline] = useState(recovered?.baseline ?? period);
	const initial = recovered?.values;
	const stale = baseline.updatedAt !== period.updatedAt;
	const frozen = Boolean(period.firstOpenedAt);
	const version = period.questions?.version;
	const [title, setTitle] = useState(initial?.title ?? baseline.title);
	const [description, setDescription] = useState(initial?.description ?? baseline.description ?? "");
	const [opensAt, setOpensAt] = useState(initial?.opensAt ?? isoToInput(baseline.opensAt));
	const [closesAt, setClosesAt] = useState(initial?.closesAt ?? isoToInput(baseline.closesAt));
	const [sections, setSections] = useState(() => structuredClone(initial?.sections ?? baseline.questions?.sections ?? []));
	const [legacy, setLegacy] = useState(() => structuredClone(initial?.legacy ?? (Array.isArray(baseline.questions) ? baseline.questions : [])));
	const [config, setConfig] = useState(() => structuredClone(initial?.config ?? baseline.questions?.target_config ?? null));
	const [sectionId, setSectionId] = useState(sections[0]?.id || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [remove, setRemove] = useState(null);
	const value = JSON.stringify({ title, description, opensAt, closesAt, sections, legacy, config });
	const [saved, setSaved] = useState(recovered?.saved ?? value);
	const dirty = value !== saved;
	useLayoutEffect(() => {
		onDirty?.(dirty);
		if (dirty) editorDrafts.set(draftKey, { baseline, values: JSON.parse(value), saved });
		else editorDrafts.delete(draftKey);
	}, [dirty, value, draftKey, baseline, saved, onDirty]);
	useUnsavedChanges(dirty);
	const edit = (setter, next) => setter(next);
	const section = sections.find((s) => s.id === sectionId);
	const changeQuestion = (id, patch) => edit(setSections, sections.map((s) => s.id === sectionId ? { ...s, questions: s.questions.map((q) => q.id === id ? { ...q, ...patch } : q) } : s));
	const replaceQuestions = (questions) => edit(setSections, sections.map((s) => s.id === sectionId ? { ...s, questions } : s));
	const move = (index, delta) => {
		const questions = [...section.questions];
		[questions[index], questions[index + delta]] = [questions[index + delta], questions[index]];
		replaceQuestions(questions);
	};
	const save = async (event) => {
		event.preventDefault();
		if (busy || stale) return;
		setBusy(true); setError("");
		try {
			const structureChanged = !frozen && version === 3 && JSON.stringify({ sections, config }) !== JSON.stringify({ sections: baseline.questions.sections, config: baseline.questions.target_config });
			const result = await api(`/admin/qpr/periods/${period.id}`, { method: "PUT", json: {
				title: title.trim(), description: description.trim() || null,
				opens_at: opensAt ? toIsoWib(opensAt) : null, closes_at: closesAt ? toIsoWib(closesAt) : null,
				...(structureChanged ? { sections, target_config: config, expected_snapshot: baseline.questions } : {}),
				...(!frozen && Array.isArray(period.questions) ? { questions: legacy } : {}),
			} });
			editorDrafts.delete(draftKey); setSaved(value); onDirty?.(false); toast("Form tersimpan."); await onSaved(result);
		} catch (e) { setError(errText(e)); }
		finally { setBusy(false); }
	};
	return <form className="qpr-editor" onSubmit={save}>
		{recovered && <div className="login-notice" role="status"><p>{stale ? "Server berubah sejak edit lokal. Simpan dinonaktifkan agar perubahan server tidak tertimpa." : "Edit belum tersimpan dipulihkan setelah navigasi. Edit ini hanya disimpan dalam memori tab."}</p><button type="button" className="btn ghost" onClick={onDiscard}>Buang edit lokal</button></div>}
		<div className="qpr-form-header card">
			<p className="studio-kicker">IDENTITAS FORM</p>
			<label className="field-label" htmlFor="qpr-edit-title">Judul periode</label>
			<input id="qpr-edit-title" className="qpr-title-input" required maxLength={200} value={title} disabled={busy} onChange={(e) => edit(setTitle, e.target.value)} />
			<label className="field-label" htmlFor="qpr-edit-description">Deskripsi</label>
			<textarea id="qpr-edit-description" rows={2} maxLength={500} value={description} disabled={busy} onChange={(e) => edit(setDescription, e.target.value)} />
			<div className="grid-2">
				<div><label className="field-label" htmlFor="qpr-edit-opens">Jadwal buka WIB (opsional)</label><input id="qpr-edit-opens" type="datetime-local" value={opensAt} disabled={busy} onChange={(e) => edit(setOpensAt, e.target.value)} /></div>
				<div><label className="field-label" htmlFor="qpr-edit-closes">Jadwal tutup WIB (opsional)</label><input id="qpr-edit-closes" type="datetime-local" value={closesAt} disabled={busy} onChange={(e) => edit(setClosesAt, e.target.value)} /></div>
			</div>
		</div>
		{frozen && <p className="login-notice">Pernah dibuka — pertanyaan, target, dan roster terkunci permanen. Judul, deskripsi, dan jadwal masih dapat diedit.</p>}
		{version === 2 && <p className="login-notice">Snapshot historis v2 hanya baca. Buat kampanye baru untuk mengubah struktur.</p>}
		{sections.length > 0 && <>
			<div className="qpr-filter-row"><label htmlFor="qpr-editor-section">Bagian penilaian</label><select id="qpr-editor-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>{sections.map((s) => <option key={s.id} value={s.id}>{s.targetLabel || s.title} · {s.questions.length} pertanyaan</option>)}</select></div>
			{section && <>
				<div className="card qpr-section-header"><h2>{section.title}</h2><p className="muted">{section.questions.length} pertanyaan · {section.questions.filter((q) => q.required).length} wajib</p>
					{config && <><label className="field-label" htmlFor="qpr-target-name">Nama target penilaian</label><input id="qpr-target-name" maxLength={200} disabled={frozen || busy} value={config.targets.find((t) => t.id === section.targetId)?.label || ""} onChange={(e) => edit(setConfig, { ...config, targets: config.targets.map((t) => t.id === section.targetId ? { ...t, label: e.target.value } : t) })} /></>}
				</div>
				{section.questions.map((q, index) => <article className="card qpr-editor-question" key={q.id}>
					<div className="qpr-question-top"><span className="muted small">Pertanyaan {index + 1}</span><span className="badge outline">{q.type === "scale" ? "Skala 1–5" : "Teks panjang"}</span></div>
					<label className="field-label" htmlFor={`edit-${q.id}`}>Pertanyaan {index + 1}</label>
					<textarea id={`edit-${q.id}`} rows={2} required maxLength={2000} value={q.label} disabled={frozen || busy || version !== 3} onChange={(e) => changeQuestion(q.id, { label: e.target.value })} />
					<div className="qpr-question-tools"><label>Jenis jawaban<select aria-label={`Jenis jawaban pertanyaan ${index + 1}`} value={q.type} disabled={frozen || busy || version !== 3} onChange={(e) => changeQuestion(q.id, { type: e.target.value })}><option value="scale">Skala 1–5</option><option value="text">Teks panjang</option></select></label>
						<label className="qpr-check"><input type="checkbox" checked={q.required} disabled={frozen || busy || version !== 3} onChange={(e) => changeQuestion(q.id, { required: e.target.checked })} />Wajib diisi</label>
						{!frozen && version === 3 && <div className="row-actions"><button type="button" className="btn ghost" disabled={busy || index === 0} aria-label={`Naikkan pertanyaan ${index + 1}`} onClick={() => move(index, -1)}>↑</button><button type="button" className="btn ghost" disabled={busy || index === section.questions.length - 1} aria-label={`Turunkan pertanyaan ${index + 1}`} onClick={() => move(index, 1)}>↓</button><button type="button" className="btn ghost" disabled={busy || section.questions.length <= 1} aria-label={`Hapus pertanyaan ${index + 1}`} onClick={() => setRemove(q)}>Hapus</button></div>}
					</div>
				</article>)}
				{!frozen && version === 3 && <button type="button" className="btn sec" disabled={busy || section.questions.length >= 100} onClick={() => replaceQuestions([...section.questions, { id: `custom-${crypto.randomUUID()}`, type: "scale", label: "Pertanyaan baru", required: true }])}>+ Tambah pertanyaan</button>}
			</>}
		</>}
		{legacy.length > 0 && <div className="card"><h2>Pertanyaan penilaian sederhana</h2>{legacy.map((q, index) => <div className="qpr-legacy-editor" key={index}><label>Kategori {index + 1}<input required maxLength={100} disabled={frozen || busy} value={q.category} onChange={(e) => edit(setLegacy, legacy.map((item, i) => i === index ? { ...item, category: e.target.value } : item))} /></label><label>Pertanyaan {index + 1}<input required maxLength={300} disabled={frozen || busy} value={q.label} onChange={(e) => edit(setLegacy, legacy.map((item, i) => i === index ? { ...item, label: e.target.value } : item))} /></label><button className="btn ghost" type="button" disabled={frozen || busy || legacy.length === 1} onClick={() => edit(setLegacy, legacy.filter((_, i) => i !== index))}>Hapus</button></div>)}<button type="button" className="btn ghost" disabled={frozen || busy || legacy.length >= 50} onClick={() => edit(setLegacy, [...legacy, { category: "Umum", label: "Pertanyaan baru" }])}>+ Tambah pertanyaan</button></div>}
		{error && <p role="alert" className="login-error">{error} Edit lokal tetap ada.</p>}
		<div className="qpr-save-bar"><span role="status">{busy ? "Menyimpan…" : dirty ? "Ada perubahan belum disimpan" : "Semua perubahan tersimpan"}</span><button className="btn gold" disabled={busy || !dirty || stale}>{busy ? "Menyimpan…" : "Simpan form"}</button></div>
		<Confirm open={Boolean(remove)} title="Hapus pertanyaan?" confirmLabel="Ya, hapus" danger onCancel={() => setRemove(null)} onConfirm={() => { replaceQuestions(section.questions.filter((q) => q.id !== remove.id)); setRemove(null); }}>{remove?.label}</Confirm>
	</form>;
}
