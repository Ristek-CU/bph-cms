import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api.js";
import { Card, SkeletonCard } from "../components/ui.jsx";

const complete = (q, answers) => q.type === "scale"
	? Number.isInteger(answers[q.id]) && answers[q.id] >= 1 && answers[q.id] <= 5
	: typeof answers[q.id] === "string" && answers[q.id].trim().length > 0;
const payload = (answers) => Object.entries(answers).map(([question_id, value]) => ({ question_id, value }));
const targetTitle = (section) => section.targetLabel && !section.title.includes(section.targetLabel)
	? `${section.title}: ${section.targetLabel}` : section.title;

export default function QprFill({ periodId }) {
	return <Fill key={periodId} periodId={periodId} />;
}

function Fill({ periodId }) {
	const [roster, setRoster] = useState(null);
	const [division, setDivision] = useState("");
	const [session, setSession] = useState(null);
	const [step, setStep] = useState(0);
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const [confirmed, setConfirmed] = useState(false);
	const current = useRef(null);
	const loading = useRef(null);
	const form = useRef(null);
	const heading = useRef(null);
	const mounted = useRef(true);
	const [, render] = useState(0);

	const updateStatus = (s, state, message = "") => {
		if (mounted.current && current.current === s) { setStatus(state); setError(message); }
	};

	// One writer per identity. Edits coalesce, but every successful response advances CAS version.
	const flush = (s = current.current) => {
		if (!s) return Promise.resolve();
		clearTimeout(s.timer);
		if (s.pending) return s.pending;
		if (s.conflict) return Promise.reject(new Error("Draft berubah di perangkat lain. Edit lokal tetap ada; muat ulang hanya jika bersedia menggantinya."));
		if (s.saved === s.revision) return Promise.resolve();
		updateStatus(s, "saving");
		s.pending = (async () => {
			try {
				while (s.saved !== s.revision) {
					const revision = s.revision;
					const answers = payload(s.answers);
					const result = await api(`/qpr/${periodId}/entries/${s.entry.id}/draft`, {
						method: "PUT", signal: s.controller.signal,
						json: { expected_version: s.version, answers },
					});
					s.version = result.draft_version;
					s.saved = revision;
				}
				updateStatus(s, "saved");
			} catch (e) {
				if (e.statusCode === 409) s.conflict = true;
				updateStatus(s, s.conflict ? "conflict" : "error", errText(e));
				throw e;
			} finally { s.pending = null; }
		})();
		return s.pending;
	};

	useEffect(() => {
		mounted.current = true;
		const controller = new AbortController();
		api(`/qpr/${periodId}`, { signal: controller.signal }).then(setRoster).catch((e) => {
			if (!controller.signal.aborted) setError(errText(e));
		});
		const warn = (e) => {
			const s = current.current;
			if (s && (s.pending || s.revision !== s.saved)) { e.preventDefault(); e.returnValue = ""; }
		};
		window.addEventListener("beforeunload", warn);
		return () => {
			mounted.current = false;
			controller.abort(); loading.current?.abort();
			const s = current.current;
			if (s) { clearTimeout(s.timer); s.controller.abort(); }
			current.current = null;
			window.removeEventListener("beforeunload", warn);
		};
	}, [periodId]);

	useEffect(() => { heading.current?.focus(); }, [step, session]);

	const pick = async (id) => {
		loading.current?.abort();
		const controller = new AbortController();
		loading.current = controller;
		setBusy(true); setError("");
		try {
			const data = await api(`/qpr/${periodId}/entries/${id}/draft`, { signal: controller.signal });
			if (!mounted.current || loading.current !== controller) return;
			const answers = Object.fromEntries(data.draft.map((a) => [a.question_id, a.value]));
			const s = { ...data, answers, version: data.draft_version, revision: 0, saved: 0, pending: null, conflict: false, controller: new AbortController() };
			current.current = s; setSession(s); setStatus("saved"); setConfirmed(false);
			const next = data.sections.findIndex((section) => section.questions.some((q) => q.required && !complete(q, answers)));
			setStep(next < 0 ? data.sections.length : next);
		} catch (e) { if (!controller.signal.aborted) setError(errText(e)); }
		finally { if (mounted.current && loading.current === controller) setBusy(false); }
	};

	const change = (id, value) => {
		const s = current.current;
		s.answers = { ...s.answers, [id]: value }; s.revision++;
		render((n) => n + 1); setConfirmed(false);
		clearTimeout(s.timer);
		if (!s.conflict) {
			setStatus("saving");
			s.timer = setTimeout(() => { flush(s).catch(() => {}); }, 800);
		}
	};

	const navigate = async (target, validate = false) => {
		if (validate) {
			if (!form.current.reportValidity()) return;
			const missing = current.current.sections[step].questions.find((q) => q.required && !complete(q, current.current.answers));
			if (missing) {
				setError("Isi semua jawaban wajib, bukan hanya spasi.");
				document.getElementById(`qpr-${missing.id}`)?.focus();
				return;
			}
		}
		setBusy(true);
		try { await flush(); setStep(target); setConfirmed(false); }
		catch { /* Save error already displayed; stay here with local answers. */ }
		finally { if (mounted.current) setBusy(false); }
	};

	const switchName = async () => {
		const s = current.current;
		setBusy(true);
		try {
			await flush(s);
			if (!mounted.current) return;
			clearTimeout(s.timer); current.current = null; setSession(null); setError("");
		} catch {
			if (window.confirm("Draft belum tersimpan. Ganti nama akan membuang edit lokal yang belum tersimpan. Tetap ganti nama?")) {
				clearTimeout(s.timer); current.current = null; setSession(null); setError("");
			}
		} finally { if (mounted.current) setBusy(false); }
	};

	const reload = async () => {
		if (!window.confirm("Muat draft terbaru akan mengganti semua edit lokal dengan draft server. Lanjutkan?")) return;
		const id = current.current.entry.id;
		clearTimeout(current.current.timer); current.current = null; setSession(null);
		await pick(id);
	};

	const submit = async (e) => {
		e.preventDefault();
		if (!confirmed || busy) return;
		const s = current.current;
		if (s.submitting) return;
		const missing = s.sections.findIndex((section) => section.questions.some((q) => q.required && !complete(q, s.answers)));
		if (missing >= 0) { setStep(missing); return; }
		s.submitting = true;
		setBusy(true);
		try {
			await flush(s);
			await api(`/qpr/${periodId}/submit-v2`, { method: "POST", json: { entry_id: s.entry.id, expected_version: s.version, answers: payload(s.answers) } });
			if (mounted.current && current.current === s) {
				setRoster((r) => ({ ...r, remaining: r.remaining.filter((entry) => entry.id !== s.entry.id) }));
				setDone(true);
			}
		} catch (e) {
			if (e.statusCode === 409 && e.errors?.state?.includes("already_final")) {
				if (mounted.current && current.current === s) setDone(true);
				return;
			}
			if (e.statusCode === 409) s.conflict = true;
			updateStatus(s, s.conflict ? "conflict" : "error", errText(e));
		} finally { s.submitting = false; if (mounted.current) setBusy(false); }
	};

	if (done) return <Card><h1>Terima kasih!</h1><p role="status">Penilaian terkirim. Jawabanmu sudah tersimpan. Halaman ini boleh ditutup.</p></Card>;
	if (!roster && !error) return <SkeletonCard lines={5} />;
	if (!roster) return <Card><p role="alert">{error}</p><button className="btn" onClick={() => window.location.reload()}>Coba lagi</button></Card>;
	const divisions = [...new Set(roster.remaining.map((r) => r.division || "Belum dipetakan"))];
	const sections = session?.sections ?? [];
	const questions = sections.flatMap((s) => s.questions);
	const required = questions.filter((q) => q.required);
	const filled = required.filter((q) => complete(q, session.answers)).length;
	const section = sections[step];

	return <Card style={{ maxWidth: 640, margin: "0 auto", overflowWrap: "anywhere" }}>
		<p className="studio-kicker">PENILAIAN PENGURUS</p>
		<h1 className="qpr-title">{roster.title}</h1>
		{!session ? <>
			{roster.description && <p>{roster.description}</p>}
			<p className="login-notice">Form tanpa login memakai model kejujuran. Pilih nama sendiri. Pemegang tautan yang memilih namamu dapat melihat dan mengubah draftmu. Isian ini bukan anonim atau rahasia; jangan bagikan tautan di luar anggota SGA.</p>
			{!roster.remaining.length ? <p>Semua nama telah mengisi penilaian ini.</p> : <>
				<label className="field-label" htmlFor="qpr-division">Divisimu</label>
				<select id="qpr-division" value={division} disabled={busy} onChange={(e) => setDivision(e.target.value)}>
					<option value="" disabled>Pilih divisi…</option>
					{divisions.map((d) => <option key={d}>{d}</option>)}
				</select>
				<label className="field-label" htmlFor="qpr-name">Namamu</label>
				<select id="qpr-name" value="" disabled={!division || busy} onChange={(e) => pick(e.target.value)}>
					<option value="" disabled>Pilih namamu…</option>
					{roster.remaining.filter((r) => (r.division || "Belum dipetakan") === division).map((r) => <option key={r.id} value={r.id}>{r.display_name || r.name}{r.role ? ` — ${r.role}` : ""}</option>)}
				</select>
			</>}
			{busy && <p role="status">Memuat draft…</p>}
		</> : <>
			<p>Mengisi sebagai <strong>{session.entry.name}</strong> · {session.entry.division} · Jabatan: <strong>{session.entry.role || "Tidak tercantum"}</strong></p>
			<button type="button" className="btn ghost" disabled={busy} onClick={switchName}>Ganti nama</button>
			<p className="field-help" role="status" aria-live="polite">{status === "saving" ? "Menyimpan…" : status === "saved" ? "Tersimpan" : status === "conflict" ? "Konflik — edit lokal belum tersimpan. Tidak akan menimpa draft server." : status === "error" ? "Gagal tersimpan — edit lokal tetap ada." : ""}</p>
			<p className="muted small">{filled} dari {required.length} pertanyaan wajib terisi. Jangan tutup tab sebelum status Tersimpan.</p>
			{status === "error" && <button className="btn" disabled={busy} onClick={() => flush().catch(() => {})}>Coba simpan lagi</button>}
			{status === "conflict" && <button className="btn" disabled={busy} onClick={reload}>Muat draft terbaru</button>}
			<form ref={form} onSubmit={section ? (e) => { e.preventDefault(); navigate(step + 1, true); } : submit}>
				<h2 ref={heading} tabIndex={-1}>{section ? `Langkah ${step + 1} dari ${sections.length}: ${targetTitle(section)}` : "Tinjau penilaian"}</h2>
				{section ? <>
					<p className="small">{Object.entries(session.scale_legend ?? {}).map(([n, label]) => `${n} — ${label}`).join("; ")}</p>
					{section.questions.map((q) => <fieldset key={q.id} className="qpr-question">
						<legend id={`qpr-l-${q.id}`}>{q.label}{q.required ? " *" : ""}</legend>
						{q.type === "scale" ? <div className="qpr-scale-row">
							{[1, 2, 3, 4, 5].map((n) => <label key={n} className="qpr-scale">
								<input type="radio" name={q.id} required={q.required} disabled={busy} aria-label={`${n} — ${session.scale_legend?.[n] ?? n}`} checked={session.answers[q.id] === n} onChange={() => change(q.id, n)} />{n}
							</label>)}
						</div> : <textarea id={`qpr-${q.id}`} rows={3} required={q.required} maxLength={5000} disabled={busy} aria-labelledby={`qpr-l-${q.id}`} value={typeof session.answers[q.id] === "string" ? session.answers[q.id] : ""} onChange={(e) => { e.target.setCustomValidity(q.required && !e.target.value.trim() ? "Isi jawaban, bukan hanya spasi." : ""); change(q.id, e.target.value); }} />}
					</fieldset>)}
				</> : <>
					{sections.map((s, index) => <section key={s.id}>
						<h3>{targetTitle(s)}</h3>
						<dl>{s.questions.map((q) => <div key={q.id}><dt>{q.label}</dt><dd style={{ whiteSpace: "pre-wrap", marginLeft: 0 }}>{complete(q, session.answers) ? String(session.answers[q.id]) : "Belum diisi"}</dd></div>)}</dl>
						<button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(index)}>Ubah {s.title}</button>
					</section>)}
					<label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={confirmed} required disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />Saya sudah meninjau jawaban dan siap mengirim penilaian final.</label>
				</>}
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
					{step > 0 && <button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(step - 1)}>Kembali</button>}
					<button className="btn" type="submit" disabled={busy || status === "conflict" || (!section && !confirmed)}>{busy ? "Menyimpan…" : section ? step === sections.length - 1 ? "Tinjau jawaban" : "Berikutnya" : "Kirim penilaian"}</button>
				</div>
			</form>
		</>}
		{error && <p role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
	</Card>;
}
