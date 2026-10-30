import { useEffect, useRef, useState } from "react";
import { api, errText } from "../api.js";
import { Card, SkeletonCard } from "../components/ui.jsx";
import { QprSection, QprSectionNav, QprReview, QprProgress, complete, targetTitle, QPR_ROLE_LABEL, useStepScroll } from "../components/QprForm.jsx";

const payload = (answers) => Object.entries(answers).map(([question_id, value]) => ({ question_id, value }));
const isRubric360 = (roster) => roster?.questions?.version === 4 || roster?.questions?.version === 5;
const timeID = (iso) => new Date(iso).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }) + " WIB";

export default function QprFill({ periodId, initialRoster }) {
	return <Fill key={periodId} periodId={periodId} initialRoster={initialRoster} />;
}

function Fill({ periodId, initialRoster }) {
	const [roster, setRoster] = useState(initialRoster ?? null);
	const suppliedRoster = useRef(initialRoster);
	const [division, setDivision] = useState("");
	const [session, setSession] = useState(null);
	const [step, setStep] = useState(0);
	const [status, setStatus] = useState("idle");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState(false);
	const [proof, setProof] = useState(null);
	const [confirmed, setConfirmed] = useState(false);
	const [savedAt, setSavedAt] = useState(null);
	const current = useRef(null);
	const loading = useRef(null);
	const form = useRef(null);
	const heading = useRef(null);
	const stepBody = useRef(null);
	const shownSession = useRef(null);
	const mounted = useRef(true);
	const [, render] = useState(0);

	const updateStatus = (s, state, message = "") => {
		if (mounted.current && current.current === s) { setStatus(state); setError(message); }
	};

	// Satu tempat memutuskan jenis kegagalan tulis, supaya pesan tidak salah sebab.
	const verdict = (e) => {
		if (e.statusCode === 409) {
			const state = e.errors?.state ?? [];
			if (state.includes("already_final")) return "final";
			if (state.includes("draft_conflict")) return "conflict";
			return "error";
		}
		if (e.statusCode === 404) return "closed";
		if (e.statusCode == null) return navigator.onLine === false ? "offline" : "error";
		return "error";
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
					let result;
					for (let attempt = 0; ; attempt++) {
						try {
							result = await api(`/qpr/${periodId}/entries/${s.entry.id}/draft`, {
								method: "PUT", signal: s.controller.signal,
								json: { expected_version: s.version, answers },
							});
							break;
						} catch (e) {
							// Tanpa statusCode = gagal jaringan/abort: tulis mungkin sudah
							// masuk. Kirim ulang isi yang sama aman — server mengakui
							// autosave identik yang CAS-nya kalah oleh dirinya sendiri.
							if (e.statusCode == null && attempt < 1) continue;
							throw e;
						}
					}
					s.version = result.draft_version;
					if (mounted.current && current.current === s) setSavedAt(result.saved_at);
					s.saved = revision;
				}
				updateStatus(s, "saved");
			} catch (e) {
				const kind = verdict(e);
				if (kind === "final") {
					if (mounted.current && current.current === s) { setProof(e.errors?.submitted_at ?? null); setDone(true); }
					return;
				}
				if (kind === "conflict") s.conflict = true;
				updateStatus(s, kind, errText(e));
				throw e;
			} finally { s.pending = null; }
		})();
		return s.pending;
	};

	useEffect(() => {
		mounted.current = true;
		const controller = new AbortController();
		if (!suppliedRoster.current) api(`/qpr/${periodId}`, { signal: controller.signal }).then(setRoster).catch((e) => {
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

	// Pindah orang/langkah: fokus ke judul langkah (pembaca layar) lalu gulir ke sana,
	// supaya pergantian target langsung terlihat. Lihat useStepScroll.
	useStepScroll({ step, session, headingRef: heading, formRef: form });

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
			setSavedAt(data.draft_updated_at ?? null);
			// Rekonsiliasi: progress server jadi acuan saat load; kalau tidak cocok,
			// pakai pertanyaan wajib lokal (jawaban tipe/wajib sama dengan server).
			if (data.progress && data.progress.filled !== undefined) {
				const local = data.sections.flatMap((sec) => sec.questions).filter((q) => q.required && complete(q, answers)).length;
				if (local !== data.progress.filled) console.warn(`[qpr] progress mismatch server=${data.progress.filled} local=${local}`);
			}
			// next_question_id dari server menentukan langkah awal; null = semua wajib terisi.
			const nextIdx = data.progress?.next_question_id
				? data.sections.findIndex((sec) => sec.questions.some((q) => q.id === data.progress.next_question_id))
				: data.sections.findIndex((sec) => sec.questions.some((q) => q.required && !complete(q, answers)));
			setStep(nextIdx < 0 ? data.sections.length : nextIdx);
		} catch (e) {
			if (controller.signal.aborted) return;
			// Sesi sama dibuka lagi setelah final: server 409 already_final →
			// tampilkan kartu konfirmasi, bukan form kosong.
			if (e.statusCode === 409 && e.errors?.state?.includes("already_final")) {
				setProof(e.errors?.submitted_at ?? null); setDone(true); return;
			}
			setError(errText(e));
		}
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
		// Navigasi tidak diblok simpan: flush gagal → pesan error non-blocking,
		// perpindahan tetap jalan (edit lokal aman, autosave mencoba lagi).
		flush().catch(() => {});
		setStep(target); setConfirmed(false);
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
		// Jangan kosongkan state aktif sebelum data baru siap — layar tidak blank.
		const s = current.current;
		clearTimeout(s.timer); s.conflict = true; // blok flush lama; pick() mengganti sesi.
		await pick(s.entry.id);
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
			const send = () => api(`/qpr/${periodId}/submit-v2`, { method: "POST", json: { entry_id: s.entry.id, expected_version: s.version, answers: payload(s.answers) } });
			let result;
			try {
				result = await send();
			} catch (e) {
				// Respons hilang setelah commit: kirim ulang sekali. Kalau ternyata
				// sudah masuk, server membalas 409 already_final + bukti kirim.
				if (e.statusCode != null) throw e;
				result = await send();
			}
			if (mounted.current && current.current === s) {
				setRoster((r) => ({ ...r, remaining: r.remaining.filter((entry) => entry.id !== s.entry.id) }));
				setProof(result?.submitted_at ?? null);
				setDone(true);
			}
		} catch (e) {
			if (e.statusCode === 409 && e.errors?.state?.includes("already_final")) {
				// Timeout setelah commit terpulihkan di sini: server sudah terima kiriman.
				if (mounted.current && current.current === s) {
					setProof(e.errors?.submitted_at ?? null);
					setDone(true);
				}
				return;
			}
			const kind = verdict(e);
			// Tutup/nama hilang: form tidak bisa dilanjutkan, tapi jawaban lokal
			// tetap ada dan bisa disalin sebelum halaman ditinggalkan.
			if (kind === "conflict") s.conflict = true;
			updateStatus(s, kind === "final" ? "error" : kind, errText(e));
		} finally { s.submitting = false; if (mounted.current) setBusy(false); }
	};

	if (done) return <Card><h1>Terima kasih!</h1><p role="status">Penilaian terkirim. Jawabanmu sudah tersimpan. Halaman ini boleh ditutup.</p>{proof && <p className="muted small">Bukti kirim: {new Date(proof).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</p>}</Card>;
	if (!roster && !error) return <SkeletonCard lines={5} />;
	if (!roster) return <Card><p role="alert">{error}</p><button className="btn" onClick={() => window.location.reload()}>Coba lagi</button></Card>;
	const divisions = [...new Set(roster.remaining.map((r) => r.division || "Pengurus Inti"))];
	const singleDivision = divisions.length === 1 ? divisions[0] : "";
	const eff = roster.effective_status ?? roster.status;
	const sections = session?.sections ?? [];
	const questions = sections.flatMap((s) => s.questions);
	const required = questions.filter((q) => q.required);
	const filled = required.filter((q) => complete(q, session.answers)).length;
	const section = sections[step];

	return <div className="qpr-form-canvas">
		<header className="card qpr-form-header">
			<p className="studio-kicker">PENILAIAN PENGURUS</p>
			<h1 className="qpr-title">{roster.title}</h1>
			{roster.description && <p>{roster.description}</p>}
		<p className="muted small">{roster.opens_at ? `Buka: ${new Date(roster.opens_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : ""}{roster.opens_at && roster.closes_at ? " · " : ""}{roster.closes_at ? `Tutup: ${new Date(roster.closes_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB` : ""}{!roster.opens_at && !roster.closes_at ? "Tanpa jadwal — tutup manual oleh BPH." : ""}</p>
		{eff === "scheduled" && <p className="login-notice" role="status">Penilaian belum dibuka. Form dapat diisi mulai {roster.opens_at ? new Date(roster.opens_at).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) : ""} WIB.</p>}
			<ul className="muted small">
				<li>Pilih namamu sendiri dari daftar, lalu buka draft-nya.</li>
				<li>Nilai setiap orang lain di daftar sesuai pengalamanmu.</li>
				<li>Jawaban anonim — tidak ada yang tahu siapa menilai siapa.</li>
			</ul>
		</header>
		{!session ? <Card>
			{!roster.remaining.length ? <p>Semua nama telah mengisi penilaian ini.</p> : <>
				{singleDivision ? <p className="muted small">Divisi: <strong>{singleDivision}</strong></p> : <>
					<label className="field-label" htmlFor="qpr-division">Divisimu</label>
					<select id="qpr-division" value={division} disabled={busy} onChange={(e) => setDivision(e.target.value)}>
						<option value="" disabled>Pilih divisi…</option>
						{divisions.map((d) => <option key={d}>{d}</option>)}
					</select>
				</>}
				<label className="field-label" htmlFor="qpr-name">Namamu</label>
				<select id="qpr-name" value="" disabled={busy || (!singleDivision && !division)} onChange={(e) => pick(e.target.value)}>
					<option value="" disabled>Pilih namamu…</option>
					{roster.remaining.filter((r) => (r.division || "Pengurus Inti") === (singleDivision || division)).map((r) => <option key={r.id} value={r.id}>{r.display_name || r.name}{r.role ? ` — ${QPR_ROLE_LABEL[r.role] || r.role}` : ""}</option>)}
				</select>
			</>}
			{busy && <p role="status">Memuat draft…</p>}
		</Card> : <>
			<Card>
			<p>Mengisi sebagai <strong>{session.entry.name}</strong> · {session.entry.division} · Jabatan: <strong>{QPR_ROLE_LABEL[session.entry.role] || session.entry.role || "Tidak tercantum"}</strong></p>
			<button type="button" className="btn ghost" disabled={busy} onClick={switchName}>Ganti nama</button>
			{isRubric360(roster) && <p className="muted small">Kamu akan menilai {sections.length} orang. Pertanyaan mengikuti pasangan penilai → target; jawaban tidak ditautkan ke namamu.</p>}
			<p className="field-help" role="status" aria-live="polite">{status === "saving" ? "Menyimpan…" : status === "saved" ? <span className="qpr-save-label">Tersimpan</span> : status === "conflict" ? "Konflik — edit lokal belum tersimpan. Tidak akan menimpa draft server." : status === "offline" ? "Koneksi terputus — edit lokal aman di tab ini, belum tersimpan ke server." : status === "closed" ? "Periode sudah ditutup — jawaban lokal tidak bisa dikirim lagi." : status === "error" ? "Belum tersimpan — akan dicoba lagi." : ""}
			{status === "saved" && savedAt && <span className="muted small qpr-save-time"> {timeID(savedAt)}</span>}</p>
			<QprProgress filled={filled} total={required.length} />
			<p className="muted small">Jangan tutup tab sebelum status Tersimpan.</p>
			{status === "error" && <button className="btn" disabled={busy} onClick={() => flush().catch(() => {})}>Coba simpan lagi</button>}
			{status === "conflict" && <button className="btn" disabled={busy} onClick={reload}>Muat draft terbaru</button>}
			</Card>
			<form ref={form} onSubmit={section ? (e) => { e.preventDefault(); navigate(step + 1, true); } : submit}>
				<h2 ref={heading} tabIndex={-1}>{section ? `Langkah ${step + 1} dari ${sections.length}: ${targetTitle(section)}` : "Tinjau penilaian"}</h2>
				{session && <QprSectionNav sections={sections} answers={session.answers} step={step} onJump={(target) => navigate(target)} disabled={busy} />}
				{section ? <QprSection section={section} answers={session.answers} onChange={change} disabled={busy} legend={session.scale_legend} /> : <>
					<QprReview sections={sections} answers={session.answers} onEdit={(index) => navigate(index)} disabled={busy} />
					<label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={confirmed} required disabled={busy} onChange={(e) => setConfirmed(e.target.checked)} />Saya sudah meninjau jawaban dan siap mengirim penilaian final.</label>
				</>}
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
					{step > 0 && <button type="button" className="btn ghost" disabled={busy} onClick={() => navigate(step - 1)}>Kembali</button>}
					<button className="btn" type="submit" disabled={busy || status === "conflict" || (!section && !confirmed)}>{busy ? "Menyimpan…" : section ? step === sections.length - 1 ? "Tinjau jawaban" : "Berikutnya" : "Kirim penilaian"}</button>
				</div>
			</form>
		</>}
		{error && <p role="alert" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
	</div>;
}
