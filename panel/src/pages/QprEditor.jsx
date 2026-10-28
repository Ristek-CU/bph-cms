import { useLayoutEffect, useState } from "react";
import { api, errText, isoToInput, toIsoWib } from "../api.js";
import { Confirm, useUnsavedChanges } from "../components/ui.jsx";

// ponytail: recovery survives same-document navigation; beforeunload protects reloads.
export const editorDrafts = new Map();

// Divisi penilai — urutan & label sama dengan picker di Qpr.jsx.
const QPR_DIVISION_OPTIONS = [
	["bph", "BPH"],
	["ristek", "Ristek"],
	["ukm", "UKM"],
	["advo", "Advo"],
	["bnp", "BNP"],
	["icd", "ICD"],
	["pr", "PR"],
	["media", "Media"],
];

/** Jabatan roster QPR 360° (snapshot v4). */
export const QPR_V4_ROLES = [
	["president", "President"],
	["vice_president", "Vice President"],
	["controller", "Controller"],
	["sekum", "Sekretaris Umum"],
	["bendum", "Bendahara Umum"],
	["kadiv", "Kepala Divisi"],
	["wakadiv", "Wakil Kepala Divisi"],
	["sekdiv", "Sekretaris Divisi"],
	["bendiv", "Bendahara Divisi"],
	["anggota", "Anggota"],
];

export default function QprEditor({ period, draftKey, onDiscard, onSaved, toast, onDirty }) {
	const [recovered] = useState(() => editorDrafts.get(draftKey));
	const [baseline] = useState(recovered?.baseline ?? period);
	const initial = recovered?.values;
	const stale = baseline.updatedAt !== period.updatedAt;
	const frozen = Boolean(period.firstOpenedAt);
	const version = period.questions?.version;
	const [title, setTitle] = useState(initial?.title ?? baseline.title);
	const [description, setDescription] = useState(initial?.description ?? baseline.description ?? "");
	const [divisionSlug, setDivisionSlug] = useState(initial?.divisionSlug ?? baseline.divisionSlug ?? "");
	const [opensAt, setOpensAt] = useState(initial?.opensAt ?? isoToInput(baseline.opensAt));
	const [closesAt, setClosesAt] = useState(initial?.closesAt ?? isoToInput(baseline.closesAt));
	const [sections, setSections] = useState(() => structuredClone(initial?.sections ?? baseline.questions?.sections ?? []));
	const [categories, setCategories] = useState(() => structuredClone(initial?.categories ?? baseline.questions?.categories ?? []));
	const [legacy, setLegacy] = useState(() => structuredClone(initial?.legacy ?? (Array.isArray(baseline.questions) ? baseline.questions : [])));
	const [config, setConfig] = useState(() => structuredClone(initial?.config ?? baseline.questions?.target_config ?? null));
	const [sectionId, setSectionId] = useState(sections[0]?.id || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [remove, setRemove] = useState(null);
	const value = JSON.stringify({ title, description, divisionSlug, opensAt, closesAt, sections, categories, legacy, config });
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
			const structureChanged = !frozen && (
				(version === 3 && JSON.stringify({ sections, config }) !== JSON.stringify({ sections: baseline.questions.sections, config: baseline.questions.target_config })) ||
				(version === 4 && JSON.stringify(categories) !== JSON.stringify(baseline.questions.categories))
			);
			const result = await api(`/admin/qpr/periods/${period.id}`, { method: "PUT", json: {
				title: title.trim(), description: description.trim() || null,
				// Kirim divisi hanya saat berubah — PUT metadata biasa tetap ramping.
				...((divisionSlug || null) !== (baseline.divisionSlug || null) ? { division_slug: divisionSlug || null } : {}),
				opens_at: opensAt ? toIsoWib(opensAt) : null, closes_at: closesAt ? toIsoWib(closesAt) : null,
				...(structureChanged && version === 3 ? { sections, target_config: config, expected_snapshot: baseline.questions } : {}),
				...(structureChanged && version === 4 ? { categories, expected_snapshot: baseline.questions } : {}),
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
			{version !== 4 && <>
				<label className="field-label" htmlFor="qpr-edit-division">Divisi penilai</label>
				<select id="qpr-edit-division" value={divisionSlug} disabled={busy} onChange={(e) => edit(setDivisionSlug, e.target.value)}>
					<option value="">Tanpa divisi / lintas divisi</option>
					{QPR_DIVISION_OPTIONS.map(([slug, label]) => <option key={slug} value={slug}>{label}</option>)}
				</select>
				<p className="muted small">Satu periode QPR = satu divisi. Menentukan periode mana yang muncul di status partisipasi divisi.</p>
			</>}
			<div className="grid-2">
				<div><label className="field-label" htmlFor="qpr-edit-opens">Jadwal buka WIB (opsional)</label><input id="qpr-edit-opens" type="datetime-local" value={opensAt} disabled={busy} onChange={(e) => edit(setOpensAt, e.target.value)} /></div>
				<div><label className="field-label" htmlFor="qpr-edit-closes">Jadwal tutup WIB (opsional)</label><input id="qpr-edit-closes" type="datetime-local" value={closesAt} disabled={busy} onChange={(e) => edit(setClosesAt, e.target.value)} /></div>
			</div>
		</div>
		{frozen && <p className="login-notice">Pernah dibuka — pertanyaan, target, dan roster terkunci permanen. Judul, deskripsi, divisi, dan jadwal masih dapat diedit.</p>}
		{version === 2 && <p className="login-notice">Snapshot historis v2 hanya baca. Buat kampanye baru untuk mengubah struktur.</p>}
		{version === 4 && <TopicCategoryEditor categories={categories} setCategories={setCategories} frozen={frozen} busy={busy} />}
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

/**
 * Editor kategori QPR 360° (snapshot v4).
 *
 * BPH menulis pertanyaan sekali per kategori; target penilaian tidak diatur di
 * sini karena dihitung server dari roster (jabatan + divisi pengisi). Tiap
 * pertanyaan bisa Skala 1–5 (menyumbang poin) atau Esai (tanpa poin).
 */
function TopicCategoryEditor({ categories, setCategories, frozen, busy }) {
	const disabled = frozen || busy;
	const patch = (index, next) => setCategories(categories.map((c, i) => i === index ? next : c));
	const moveCategory = (index, delta) => {
		const next = [...categories];
		[next[index], next[index + delta]] = [next[index + delta], next[index]];
		setCategories(next);
	};
	const moveQuestion = (ci, qi, delta) => {
		const questions = [...categories[ci].questions];
		[questions[qi], questions[qi + delta]] = [questions[qi + delta], questions[qi]];
		patch(ci, { ...categories[ci], questions });
	};
	const changeQuestion = (ci, qi, field, value) => patch(ci, {
		...categories[ci],
		questions: categories[ci].questions.map((q, i) => i === qi ? { ...q, [field]: value } : q),
	});
	return <div className="qpr-topic-editor">
		<p className="login-notice qpr-topic-hint">Setiap pengisi otomatis menilai orang-orang sesuai jabatannya. Pertanyaan di bawah dipakai berulang untuk setiap orang yang dinilai; pengisi tidak pernah menilai dirinya sendiri.</p>
		{categories.map((category, ci) => {
			const scale = category.questions.filter((q) => q.type === "scale").length;
			const essays = category.questions.length - scale;
			return <section className="card qpr-topic-cat" key={category.id} aria-label={`Kategori ${ci + 1}`}>
				<header className="qpr-topic-cat-head">
					<div>
						<p className="studio-kicker">KATEGORI {ci + 1}</p>
						<p className="muted small qpr-topic-meta">{scale} skala · {essays} esai · {category.scope === "positions" ? "hanya jabatan" : "semua target"}</p>
					</div>
					<div className="row-actions qpr-topic-tools">
						<button type="button" className="btn ghost" disabled={disabled || ci === 0} aria-label={`Naikkan kategori ${ci + 1}`} onClick={() => moveCategory(ci, -1)}>↑</button>
						<button type="button" className="btn ghost" disabled={disabled || ci === categories.length - 1} aria-label={`Turunkan kategori ${ci + 1}`} onClick={() => moveCategory(ci, 1)}>↓</button>
						<button type="button" className="btn ghost" disabled={disabled || categories.length <= 1} aria-label={`Hapus kategori ${ci + 1}`} onClick={() => setCategories(categories.filter((_, i) => i !== ci))}>Hapus</button>
					</div>
				</header>
				<label className="field-label" htmlFor={`qpr-cat-${category.id}`}>Nama kategori {ci + 1}</label>
				<input id={`qpr-cat-${category.id}`} maxLength={300} required disabled={disabled} value={category.title} onChange={(e) => patch(ci, { ...category, title: e.target.value })} />
				<label className="qpr-check qpr-topic-scope">
					<input type="checkbox" checked={category.scope === "positions"} disabled={disabled} onChange={(e) => patch(ci, { ...category, scope: e.target.checked ? "positions" : "all" })} />
					Hanya untuk target berjabatan (esai tidak ditanyakan ke anggota)
				</label>
				<div className="qpr-topic-questions">
					{category.questions.map((question, qi) => <article className="qpr-editor-question" key={question.id}>
						<div className="qpr-question-top">
							<span className="muted small">Pertanyaan {ci + 1}.{qi + 1}</span>
							<span className="badge outline">{question.type === "scale" ? "Skala 1–5" : "Esai"}</span>
						</div>
						<textarea id={`edit-${question.id}`} rows={2} required maxLength={2000} aria-label={`Pertanyaan ${ci + 1}.${qi + 1}`} disabled={disabled} value={question.label} onChange={(e) => changeQuestion(ci, qi, "label", e.target.value)} />
						<div className="qpr-question-tools">
							<label>Jenis jawaban<select aria-label={`Jenis jawaban kategori ${ci + 1} pertanyaan ${qi + 1}`} value={question.type} disabled={disabled} onChange={(e) => changeQuestion(ci, qi, "type", e.target.value)}>
								<option value="scale">Skala 1–5</option><option value="text">Esai</option>
							</select></label>
							<label className="qpr-check"><input type="checkbox" checked={question.required} disabled={disabled} onChange={(e) => changeQuestion(ci, qi, "required", e.target.checked)} />Wajib diisi</label>
							<div className="row-actions">
								<button type="button" className="btn ghost" disabled={disabled || qi === 0} aria-label={`Naikkan kategori ${ci + 1} pertanyaan ${qi + 1}`} onClick={() => moveQuestion(ci, qi, -1)}>↑</button>
								<button type="button" className="btn ghost" disabled={disabled || qi === category.questions.length - 1} aria-label={`Turunkan kategori ${ci + 1} pertanyaan ${qi + 1}`} onClick={() => moveQuestion(ci, qi, 1)}>↓</button>
								<button type="button" className="btn ghost" disabled={disabled} aria-label={`Hapus kategori ${ci + 1} pertanyaan ${qi + 1}`} onClick={() => patch(ci, { ...category, questions: category.questions.filter((_, i) => i !== qi) })}>Hapus</button>
							</div>
						</div>
					</article>)}
					{!category.questions.length && <p className="muted small qpr-topic-empty">Belum ada pertanyaan di kategori ini. Kampanye tidak bisa dibuka sampai kategori terisi.</p>}
				</div>
				<button type="button" className="btn sec" disabled={disabled || category.questions.length >= 100} onClick={() => patch(ci, { ...category, questions: [...category.questions, { id: `${category.id}-q${category.questions.length + 1}-${crypto.randomUUID().slice(0, 8)}`, type: "scale", label: "Pertanyaan baru", required: true }] })}>+ Tambah pertanyaan</button>
			</section>;
		})}
		<button type="button" className="btn" disabled={disabled || categories.length >= 20} onClick={() => setCategories([...categories, { id: `cat-${crypto.randomUUID()}`, title: "Kategori baru", scope: "all", questions: [] }])}>+ Tambah kategori</button>
	</div>;
}
