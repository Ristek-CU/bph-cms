export const complete = (question, answers) => question.type === "scale"
	? Number.isInteger(answers[question.id]) && answers[question.id] >= 1 && answers[question.id] <= 5
	: typeof answers[question.id] === "string" && answers[question.id].trim().length > 0;

export const targetTitle = (section) => section.targetLabel && !section.title.includes(section.targetLabel)
	? `${section.title}: ${section.targetLabel}` : section.title;

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
	return <section>
		<header className="qpr-section-header">
			<h3>{targetTitle(section)}</h3>
			{section.questions.some((question) => question.type === "scale") && <p className="small">{Object.entries(legend ?? {}).map(([n, label]) => `${n} — ${label}`).join("; ")}</p>}
		</header>
		{section.questions.map((question) => <QprQuestion key={question.id} question={question} value={answers[question.id]} onChange={onChange} disabled={disabled} legend={legend} />)}
	</section>;
}

export function QprReview({ sections, answers, onEdit, disabled }) {
	return <div className="qpr-review">
		{sections.map((section, index) => <section key={section.id}>
			<header className="qpr-section-header"><h3>{targetTitle(section)}</h3></header>
			<dl>{section.questions.map((question) => <div key={question.id} className="qpr-question"><dt>{question.label}</dt><dd style={{ whiteSpace: "pre-wrap", marginLeft: 0 }}>{complete(question, answers) ? String(answers[question.id]) : "Belum diisi"}</dd></div>)}</dl>
			{onEdit && <button type="button" className="btn ghost" disabled={disabled} onClick={() => onEdit(index)}>Ubah {section.title}</button>}
		</section>)}
	</div>;
}

export function QprProgress({ filled, total }) {
	return <div className="qpr-progress">
		<progress aria-label="Pertanyaan wajib terisi" value={filled} max={total || 1} />
		<p className="muted small">{filled} dari {total} pertanyaan wajib terisi.</p>
	</div>;
}
