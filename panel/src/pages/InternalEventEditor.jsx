import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errText, getToken, isoToInput, toIsoWib } from "../api.js";
import { Confirm, ErrorState, Field, SkeletonCard, useToast, useUnsavedChanges } from "../components/ui.jsx";
import AuthImage from "../components/AuthImage.jsx";
import { Preview, SessionCard } from "../components/event-form.jsx";
import {
	hasSessionDraft,
	joinDT,
	newSession,
	translateErrors,
	withKeys,
} from "../utils/event-form.js";
import { internalCaps } from "../utils/internal-event.js";

// Editor internal event. Struktur, urutan section, dan aturan validasinya
// sengaja identik dengan EventEditor (student event) — komponen sesi dan
// pratinjau diimpor dari satu sumber yang sama supaya keduanya tidak drift.
//
// Yang berbeda hanya tiga hal:
//  1. endpoint (/admin/internal-events, /admin/internal-media)
//  2. cover dirender lewat AuthImage karena disimpan di prefix R2 ber-auth (K-6)
//  3. semua kalimat yang menyebut "portal SGA" / "mahasiswa" — internal event
//     tidak pernah tampil di sana, dan menyebutnya akan menyesatkan pengurus
export default function InternalEventEditor({ event, prefillDate, canPublish = false, canDelete = false }) {
	const navigate = useNavigate();
	const toast = useToast();
	const editing = !!event?.id;

	const [form, setForm] = useState({
		title: event?.title || "",
		slug: event?.slug || "",
		description: event?.description || "",
		starts_at: prefillDate ? `${prefillDate}T08:00` : isoToInput(event?.starts_at),
		ends_at: prefillDate ? `${prefillDate}T17:00` : isoToInput(event?.ends_at),
		location: event?.location || "",
		location_url: event?.location_url || "",
		registration_url: event?.registration_url || "",
		organizer: event?.organizer || "",
		registration_open: event ? event.registration_open !== false : true,
	});
	const [sessions, setSessions] = useState(withKeys(event?.sessions || []));
	const [cover, setCover] = useState(event?.cover_image_url || null);
	const [errors, setErrors] = useState({});
	const [saving, setSaving] = useState(false);
	const [savedId, setSavedId] = useState(event?.id || null);
	const [published, setPublished] = useState(event?.status === "published");
	const [askDelete, setAskDelete] = useState(false);
	const [askPublish, setAskPublish] = useState(false);
	const [showPreview, setShowPreview] = useState(false);
	const [uploading, setUploading] = useState(false);
	const snapshot = JSON.stringify({ form, sessions, cover });
	const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
	const dirty = snapshot !== savedSnapshot;
	useUnsavedChanges(dirty);
	const sessionsEndRef = useRef(null);
	const prevSessionsLen = useRef(sessions.length);

	useEffect(() => {
		if (sessions.length > prevSessionsLen.current) {
			sessionsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		}
		prevSessionsLen.current = sessions.length;
	}, [sessions.length]);

	// Dideklarasikan sebelum setSess: setSess membaca urutan tampil, dan kalau
	// useMemo-nya di bawah, React Compiler tidak bisa mempertahankan memo-nya.
	const sortedSessions = useMemo(
		() => [...sessions]
			.map((s, i) => ({ session: s, index: i }))
			.sort((a, b) => {
				const aDt = `${a.session._date}T${a.session._start}`;
				const bDt = `${b.session._date}T${b.session._start}`;
				if (aDt !== bDt) return aDt.localeCompare(bDt);
				return a.index - b.index;
			})
			.map((x) => x.session),
		[sessions],
	);

	const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
	// Patch sesi berdasarkan urutan tampil (sortedSessions), konsisten dengan render.
	const setSess = (i, patch) => setSessions(sortedSessions.map((x, j) => (j === i ? { ...x, ...patch } : x)));

	async function upload(file) {
		if (uploading || saving) return;
		if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
			toast("Pilih gambar JPG, PNG, atau WebP dengan ukuran maksimal 5 MB.", "err");
			return;
		}
		setUploading(true);
		try {
			const fd = new FormData();
			fd.append("file", file);
			// Endpoint internal: objek masuk prefix internal-covers/ dan hanya bisa
			// dibaca dengan Bearer token (K-6).
			const res = await fetch("/api/v1/admin/internal-media", {
				method: "POST",
				headers: { Authorization: `Bearer ${getToken()}` },
				body: fd,
				signal: AbortSignal.timeout(60000),
			});
			const b = await res.json().catch(() => ({}));
			if (res.status === 401) window.dispatchEvent(new Event("bph:unauthorized"));
			if (!res.ok || b.success === false) throw new Error(b.message || "Upload gagal. Silakan coba lagi.");
			setCover(b.data.url);
			toast("Cover terunggah. Simpan event untuk menerapkan.");
		} catch (e) {
			toast(e.message || "Upload gagal. Periksa koneksi internet.", "err");
		} finally {
			setUploading(false);
		}
	}

	function payload() {
		return {
			title: form.title.trim(),
			starts_at: toIsoWib(form.starts_at),
			ends_at: toIsoWib(form.ends_at),
			location: form.location.trim(),
			description: form.description || null,
			location_url: form.location_url || null,
			registration_url: form.registration_url || null,
			registration_open: form.registration_open,
			organizer: form.organizer.trim() || null,
			cover_image_url: cover,
			sessions: sortedSessions
				.filter((s) => hasSessionDraft(s) && s.name.trim() && s._date && s._start && s._end)
				.map((s) => {
					const overnight = s._end <= s._start;
					return {
						name: s.name.trim(),
						starts_at: toIsoWib(joinDT(s._date, s._start)),
						ends_at: toIsoWib(joinDT(s._date, s._end, overnight)),
						speaker: s.speaker || null,
						location: s.location || null,
						description: s.description || null,
					};
				}),
		};
	}

	// Validasi klien ringan sebelum kirim (server tetap sumber kebenaran).
	function clientValidate() {
		const errs = {};
		if (!form.title.trim()) errs.title = "Nama event wajib diisi.";
		if (!form.starts_at) errs.starts_at = "Jam mulai wajib diisi.";
		if (!form.ends_at) errs.ends_at = "Jam selesai wajib diisi.";
		if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at) {
			errs.ends_at = "Jam selesai harus setelah jam mulai.";
		}
		if (!form.location.trim()) errs.location = "Lokasi wajib diisi.";
		sortedSessions.forEach((s, i) => {
			if (!hasSessionDraft(s)) return;
			if (!s.name.trim()) errs[`sessions.${i}.name`] = "Nama sesi wajib diisi.";
			if (!s._date) errs[`sessions.${i}.date`] = "Tanggal sesi belum diisi.";
			if (!s._start) errs[`sessions.${i}.starts_at`] = "Jam mulai sesi belum diisi.";
			if (!s._end) errs[`sessions.${i}.ends_at`] = "Jam selesai sesi belum diisi.";
		});
		return errs;
	}

	async function save(publishAfter) {
		if (saving || uploading) return;
		if (publishAfter && !canPublish) {
			toast("Akun ini tidak punya akses untuk menerbitkan event.", "err");
			return;
		}
		const errs = clientValidate();
		setErrors(errs);
		if (Object.keys(errs).length) {
			toast("Masih ada isian yang perlu diperbaiki.", "err");
			requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.focus());
			return;
		}
		setSaving(true);
		try {
			const body = payload();
			let id = savedId;
			if (editing || savedId) {
				await api(`/admin/internal-events/${id}`, { method: "PUT", json: body });
			} else {
				const slug = form.slug
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9\s-]/g, "")
					.replace(/[\s_]+/g, "-")
					.replace(/-+/g, "-")
					.replace(/^-|-$/g, "");
				const created = await api("/admin/internal-events", {
					method: "POST",
					json: { ...body, slug: slug || undefined, status: "draft" },
				});
				id = created.id;
				setSavedId(id);
			}
			setSavedSnapshot(snapshot);
			if (publishAfter) {
				await api(`/admin/internal-events/${id}/publish`, { method: "POST" });
				setPublished(true);
				toast("Internal event diterbitkan — terlihat semua pengurus SGA.");
			} else {
				toast(published
					? "Perubahan tersimpan dan tetap terlihat semua pengurus."
					: "Internal event tersimpan sebagai draft divisi kamu.");
			}
			navigate(`/internal-events/${id}/edit`);
		} catch (e) {
			const translated = translateErrors(e?.errors);
			if (Object.keys(translated).length) setErrors(translated);
			else toast(e?.message || "Gagal menyimpan.", "err");
		} finally {
			setSaving(false);
		}
	}

	async function unpublish() {
		if (saving) return;
		setSaving(true);
		try {
			await api(`/admin/internal-events/${savedId}/unpublish`, { method: "POST" });
			setPublished(false);
			toast("Internal event ditarik — kembali jadi draft divisi kamu.");
		} catch (e) {
			toast(e?.message || "Gagal menarik event.", "err");
		} finally {
			setSaving(false);
		}
	}

	async function del() {
		if (saving) return;
		setSaving(true);
		setAskDelete(false);
		try {
			await api(`/admin/internal-events/${savedId}`, { method: "DELETE" });
			toast("Internal event dihapus permanen.");
			navigate("/internal-events");
		} catch (e) {
			toast(e?.message || "Gagal menghapus.", "err");
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<div className="internal-notice" role="note">
				<strong>Internal event</strong> — hanya terlihat oleh pengurus SGA yang login.
				Tidak pernah tampil di situs publik maupun landing page.
			</div>

			<div className="card">
				<div className="section">
					<div className="section-head">
						<div className="section-num">1</div>
						<div>
							<h2>Informasi Utama</h2>
							<p>Identitas agenda yang dilihat pengurus lain di dalam CMS Hub.</p>
						</div>
					</div>
					<Field label="Nama event" required error={errors.title}>
						<input type="text" value={form.title} onChange={set("title")} placeholder="Rapat Koordinasi Persiapan Cakfest" />
					</Field>
					{!editing && !savedId && (
						<Field label="Alamat link (slug)" help="Kosongkan = dibuat otomatis dari nama. Dipakai sebagai penanda internal, bukan URL publik." error={errors.slug}>
							<input type="text" value={form.slug} onChange={set("slug")} placeholder="otomatis dari judul" />
						</Field>
					)}
					<Field label="Deskripsi" help="Agenda, latar belakang, atau hal yang perlu disiapkan peserta.">
						<textarea rows={4} value={form.description} onChange={set("description")} />
					</Field>
					<Field label="Foto cover" help="JPG/PNG/WebP, maks 5MB. Rasio disarankan 16:9. Disimpan terpisah dan hanya bisa dibuka pengurus yang login.">
						<div className="upload-hint">
							<input
								type="file"
								disabled={uploading || saving}
								accept="image/jpeg,image/png,image/webp"
								aria-label="Unggah foto cover"
								onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
							/>
							{uploading && <p role="status">Mengunggah cover…</p>}
							{cover && (
								<AuthImage
									src={cover}
									alt="Pratinjau cover"
									className="cover-preview"
									fallback={<p className="field-help">Cover tersimpan, tapi belum bisa ditampilkan.</p>}
								/>
							)}
						</div>
					</Field>
					<Field label="Penyelenggara / PIC" help="Contoh: BPH SGA, Divisi Media.">
						<input type="text" value={form.organizer} onChange={set("organizer")} />
					</Field>
				</div>

				<div className="section">
					<div className="section-head">
						<div className="section-num">2</div>
						<div>
							<h2>Waktu &amp; Lokasi</h2>
							<p>Semua waktu dalam WIB (Asia/Jakarta).</p>
						</div>
					</div>
					<div className="grid-2">
						<Field label="Mulai" required error={errors.starts_at}>
							<input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} />
						</Field>
						<Field label="Selesai" required error={errors.ends_at}>
							<input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} />
						</Field>
					</div>
					<Field label="Lokasi" required error={errors.location}>
						<input type="text" value={form.location} onChange={set("location")} placeholder="Ruang Rapat Lt. 2 / Zoom" />
					</Field>
					<Field label="Link lokasi / meeting" help="Link Google Maps atau tautan ruang meeting online." error={errors.location_url}>
						<input type="url" value={form.location_url} onChange={set("location_url")} placeholder="https://maps.app.goo.gl/…" />
					</Field>
				</div>

				<div className="section">
					<div className="section-head">
						<div className="section-num">3</div>
						<div>
							<h2>Konfirmasi Kehadiran</h2>
							<p>Ke mana pengurus diarahkan untuk mengonfirmasi kehadiran.</p>
						</div>
					</div>
					<Field label="Link konfirmasi / absensi" help="Link Google Form, WhatsApp, atau form internal untuk mendata peserta." error={errors.registration_url}>
						<input type="url" value={form.registration_url} onChange={set("registration_url")} placeholder="https://forms.gle/…" />
					</Field>
					<div className="check-row">
						<input
							type="checkbox"
							id="internal-reg-open"
							checked={form.registration_open}
							onChange={(e) => setForm({ ...form, registration_open: e.target.checked })}
						/>
						<label htmlFor="internal-reg-open" className="field-label" style={{ margin: 0 }}>
							Konfirmasi kehadiran dibuka
							<span className="field-help" style={{ display: "inline" }}> — kalau mati, link di atas tidak ditawarkan di halaman detail.</span>
						</label>
					</div>
				</div>

				<div className="section">
					<div className="section-head">
						<div className="section-num">4</div>
						<div>
							<h2>Runsheet (Timeline Sesi)</h2>
							<p>Susunan acara per jam. Boleh dikosongkan dulu — bisa diisi nanti. Sesi otomatis diurutkan per jam saat disimpan.</p>
						</div>
					</div>
					{sortedSessions.map((s, i) => (
						<SessionCard
							key={s._key}
							s={s}
							i={i}
							err={{
								name: errors[`sessions.${i}.name`],
								date: errors[`sessions.${i}.date`],
								starts_at: errors[`sessions.${i}.starts_at`],
								ends_at: errors[`sessions.${i}.ends_at`],
								range: errors[`sessions.${i}`],
							}}
							onChange={setSess}
							onRemove={() => setSessions(sessions.filter((x) => x !== s))}
						/>
					))}
					<div ref={sessionsEndRef} />
					<button
						className="btn sec"
						type="button"
						onClick={() => setSessions([...sessions, newSession(sortedSessions[sortedSessions.length - 1] || { _date: form.starts_at.slice(0, 10), _end: form.starts_at.slice(11, 16) || "08:00" })])}
					>
						+ Tambah sesi
					</button>
					{errors["sessions"] && <div className="field-err">{errors["sessions"]}</div>}
				</div>
			</div>

			{showPreview && (
				<div className="card preview-card">
					<h2 style={{ fontSize: 15, marginBottom: 10 }}>Pratinjau halaman detail (perkiraan)</h2>
					<Preview
						form={form}
						sessions={sortedSessions}
						coverImage={cover ? <AuthImage src={cover} alt="" /> : null}
						note="Internal event — hanya terlihat oleh pengurus SGA yang login."
						ariaLabel="Pratinjau halaman internal event"
					/>
				</div>
			)}

			<div className="editor-save-status" role="status">
				{saving ? "Menyimpan perubahan…"
					: uploading ? "Mengunggah cover…"
					: dirty ? "Ada perubahan yang belum disimpan"
					: savedId ? "Semua perubahan tersimpan"
					: "Mulai isi detail agenda. Kolom bertanda * wajib diisi."}
			</div>
			<div className="sticky-bar">
				{!editing && !savedId ? (
					<>
						<button className="btn" onClick={() => save(false)} disabled={saving || uploading}>
							{saving ? "Menyimpan…" : "Simpan Draft"}
						</button>
						{canPublish && (
							<button className="btn gold" onClick={() => setAskPublish(true)} disabled={saving || uploading}>
								Simpan &amp; Terbitkan
							</button>
						)}
					</>
				) : (
					<>
						<button className="btn" onClick={() => save(false)} disabled={saving || uploading}>
							{saving ? "Menyimpan…" : "Simpan Perubahan"}
						</button>
						{savedId && (
							<Link className="btn ghost" to={`/internal-events/${savedId}`}>Lihat detail</Link>
						)}
						{canPublish && (
							published ? (
								<button className="btn sec" disabled={saving || uploading} onClick={unpublish}>Tarik (kembali ke draft)</button>
							) : (
								<button className="btn gold" disabled={saving || uploading} onClick={() => setAskPublish(true)}>Terbitkan internal</button>
							)
						)}
					</>
				)}
				<button className="btn ghost" onClick={() => setShowPreview(!showPreview)}>
					{showPreview ? "Sembunyikan pratinjau" : "Pratinjau"}
				</button>
				{savedId && canDelete && (
					<button className="btn danger" style={{ marginLeft: "auto" }} disabled={saving || uploading} onClick={() => setAskDelete(true)}>
						Hapus Permanen
					</button>
				)}
				{savedId && published && <span className="badge published">Terbit internal</span>}
				{savedId && !published && <span className="badge draft">Draft</span>}
			</div>

			<Confirm
				open={askPublish}
				title="Terbitkan internal event?"
				confirmLabel="Ya, terbitkan"
				onCancel={() => setAskPublish(false)}
				onConfirm={() => { setAskPublish(false); save(true); }}
			>
				Agenda akan terlihat oleh semua pengurus SGA yang login, dari divisi mana pun.
				Tetap tidak muncul di situs publik.
			</Confirm>

			<Confirm
				open={askDelete}
				title="Hapus permanen?"
				confirmLabel="Ya, hapus permanen"
				danger
				onCancel={() => setAskDelete(false)}
				onConfirm={del}
			>
				Internal event "{form.title}" beserta semua sesi akan dihapus selamanya. Tidak bisa dibatalkan.
			</Confirm>
		</>
	);
}

/** /internal-events/baru — ambil ?date= dari hash untuk prefill dari kalender. */
export function InternalEventNewRoute({ capabilities }) {
	const sp = new URLSearchParams(window.location.hash.split("?")[1] || "");
	if (!capabilities?.canCreateEvent) return <NoAccessInternal />;
	return (
		<InternalEventEditor
			prefillDate={sp.get("date")}
			canPublish={Boolean(capabilities?.canPublishEvent)}
			canDelete={false}
		/>
	);
}

/** /internal-events/:id/edit — muat eventnya sendiri (App tidak menyimpan state internal event). */
export function InternalEventEditRoute({ user, capabilities }) {
	const { id } = useParams();
	const [event, setEvent] = useState(undefined); // undefined = loading, null = tidak ada
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState(0);
	const caps = internalCaps(user, capabilities);

	useEffect(() => {
		let cancelled = false;
		api(`/admin/internal-events/${id}`)
			.then((d) => { if (!cancelled) { setEvent(d); setError(""); } })
			.catch((e) => {
				if (!cancelled) {
					// 404 bisa berarti "tidak ada" ATAU "draft divisi lain" — keduanya
					// memang dibalas 404 oleh backend supaya keberadaannya tidak bocor.
					setEvent(null);
					setError(e?.statusCode === 404 ? "" : errText(e));
				}
			});
		return () => { cancelled = true; };
	}, [id, attempt]);

	if (error) {
		return <ErrorState message={error} onRetry={() => { setError(""); setAttempt((n) => n + 1); }} />;
	}
	if (event === undefined) return <SkeletonCard lines={5} />;
	if (event === null) {
		return (
			<div className="empty-state">
				<p>Internal event tidak ditemukan — mungkin sudah dihapus, atau masih draft milik divisi lain.</p>
				<Link className="btn" to="/internal-events">Kembali ke daftar internal event</Link>
			</div>
		);
	}
	if (!caps.canEdit(event)) return <NoAccessInternal />;
	return (
		<InternalEventEditor
			key={event.id}
			event={event}
			canPublish={caps.canPublish(event)}
			canDelete={caps.canDelete(event)}
		/>
	);
}

function NoAccessInternal() {
	return (
		<div className="empty-state">
			<p>Internal event ini milik divisi lain. Hanya divisi pemilik dan BPH yang boleh mengubahnya.</p>
			<Link className="btn" to="/internal-events">Kembali ke daftar internal event</Link>
		</div>
	);
}
