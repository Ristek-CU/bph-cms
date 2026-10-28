import { useEffect, useRef } from "react";

export const complete = (question, answers) => question.type === "scale"
	? Number.isInteger(answers[question.id]) && answers[question.id] >= 1 && answers[question.id] <= 5
	: typeof answers[question.id] === "string" && answers[question.id].trim().length > 0;

/** Label jabatan roster QPR 360° (snapshot v4) — dipakai panel & form publik. */
export const QPR_ROLE_LABEL = {
	president: "President",
	vice_president: "Vice President",
	controller: "Controller",
	sekum: "Sekretaris Umum",
	bendum: "Bendahara Umum",
	kadiv: "Kepala Divisi",
	wakadiv: "Wakil Kepala Divisi",
	sekdiv: "Sekretaris Divisi",
	bendiv: "Bendahara Divisi",
	anggota: "Anggota",
};

/** Pertanyaan dikelompokkan per kategori (v4); v2/v3 tanpa kategori = satu grup. */
export function groupByCategory(questions) {
	const groups = [];
	for (const question of questions) {
		const name = question.category || "";
		const last = groups[groups.length - 1];
		if (last && last.name === name) last.questions.push(question);
		else groups.push({ name, questions: [question] });
	}
	return groups;
}

export const targetTitle = (section) => section.targetLabel && !section.title.includes(section.targetLabel)
	? `${section.title}: ${section.targetLabel}` : section.title;

/**
 * Bawa layar ke judul langkah setiap kali target/langkah berganti, supaya
 * pergantian orang terlihat jelas ("Langkah 8 dari 14: …").
 *
 * `preventScroll` dipakai saat memindahkan fokus agar posisi gulir tidak
 * ditentukan dua kali (fokus dulu, lalu smooth scroll).
 */
export function useStepScroll({ step, session, headingRef, formRef }) {
	useEffect(() => {
		headingRef.current?.focus({ preventScroll: true });
		const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth";
		(headingRef.current ?? formRef.current?.querySelector(".qpr-section-header"))?.scrollIntoView({ behavior, block: "start" });
	}, [step, session, headingRef, formRef]);
}

export function QprQuestion({ question, value, onChange, disabled = false, legend }) {
	const id = `qpr-${question.id}`;
	const label = <>{question.label}{question.required && <span aria-hidden="true"> *</span>}</>;
	if (question.type === "scale") return <fieldset className="qpr-question" disabled={disabled}>
		<legend>{label}</legend>
		<div className="qpr-scale-row">
			{[1, 2, 3, 4, 5].map((n) => <label key={n} className="qpr-scale">
				<input id={n === 1 ? id : `${id}-${n}`} type="radio" name={question.id} required={question.required} disabled={disabled} aria-label={`${n} — ${legend?.[n] ?? n}`} checked={value === n} onChange={() => onChange(question.id, n)} />{n}
			</label>)}
		</div>
	</fieldset>;
	return <fieldset className="qpr-question" disabled={disabled}>
		<legend><label htmlFor={id}>{question.label}</label>{question.required && <span aria-hidden="true"> *</span>}</legend>
		<textarea id={id} rows={3} required={question.required} maxLength={5000} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(e) => {
			e.target.setCustomValidity(question.required && !e.target.value.trim() ? "Isi jawaban, bukan hanya spasi." : "");
			onChange(question.id, e.target.value);
		}} />
	</fieldset>;
}

export function QprSection({ section, answers, onChange, disabled, legend }) {
	const groups = groupByCategory(section.questions);
	const grouped = groups.some((group) => group.name);
	return <section>
		<header className="qpr-section-header">
			<h3>{targetTitle(section)}</h3>
			{section.questions.some((question) => question.type === "scale") && <p className="small">{Object.entries(legend ?? {}).map(([n, label]) => `${n} — ${label}`).join("; ")}</p>}
		</header>
		{grouped
			? groups.map((group) => <div className="qpr-topic-group" key={group.name || "lainnya"}>
					{group.name && <h4 className="qpr-topic-title">{group.name}</h4>}
					{group.questions.map((question) => <QprQuestion key={question.id} question={question} value={answers[question.id]} onChange={onChange} disabled={disabled} legend={legend} />)}
				</div>)
			: section.questions.map((question) => <QprQuestion key={question.id} question={question} value={answers[question.id]} onChange={onChange} disabled={disabled} legend={legend} />)}
	</section>;
}

export function QprReview({ sections, answers, onEdit, disabled }) {
	return <div className="qpr-review">
		{sections.map((section, index) => <section key={section.id}>
			<header className="qpr-section-header"><h3>{targetTitle(section)}</h3></header>
			{groupByCategory(section.questions).map((group) => <div key={group.name || "lainnya"}>
				{group.name && <h4 className="qpr-topic-title">{group.name}</h4>}
				<dl>{group.questions.map((question) => <div key={question.id} className="qpr-question"><dt>{question.label}</dt><dd style={{ whiteSpace: "pre-wrap", marginLeft: 0 }}>{complete(question, answers) ? String(answers[question.id]) : "Belum diisi"}</dd></div>)}</dl>
			</div>)}
			{onEdit && <button type="button" className="btn ghost" disabled={disabled} onClick={() => onEdit(index)}>Ubah {section.title}</button>}
		</section>)}
	</div>;
}

// Navigator bagian: posisi aktif + kelengkapan required (kosong/sebagian/lengkap).
//
// Satu periode 360° berisi banyak target (14 orang untuk kadiv), dan daftar pil
// yang wrap memakan ~550–700px tinggi — cukup untuk mendorong judul langkah dan
// pertanyaan pertama keluar layar. Karena itu daftar dibuat satu baris yang
// digeser horizontal; pil aktif selalu dibawa ke tampilan.
export function QprSectionNav({ sections, answers, step, onJump, disabled }) {
	const active = useRef(null);
	useEffect(() => {
		active.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [step]);
	const stateOf = (section) => {
		const req = section.questions.filter((q) => q.required);
		const filled = req.filter((q) => complete(q, answers)).length;
		return !req.length || filled === req.length ? "lengkap" : filled ? "sebagian" : "kosong";
	};
	return <nav className="qpr-section-nav" aria-label="Daftar bagian penilaian">
		{sections.map((section, index) => <button key={section.id} ref={index === step ? active : undefined} type="button" disabled={disabled} aria-current={index === step ? "step" : undefined} className={`qpr-nav-item ${index === step ? "active" : ""}`} onClick={() => onJump(index)}>
			<span>{index + 1}. {targetTitle(section)}</span>
			<span className={`muted small qpr-nav-state qpr-nav-${stateOf(section)}`}>{stateOf(section)}</span>
		</button>)}
	</nav>;
}

export function QprProgress({ filled, total }) {
	return <div className="qpr-progress">
		<progress aria-label="Pertanyaan wajib terisi" value={filled} max={total || 1} />
		<p className="muted small">{filled} dari {total} pertanyaan wajib terisi.</p>
	</div>;
}
