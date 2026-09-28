import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, isoToInput, toIsoWib } from "../api.js";
import { Confirm, useToast, Field, useUnsavedChanges } from "../components/ui.jsx";
// Kartu sesi + pratinjau dan helper tanggal dipakai bersama dengan
// InternalEventEditor — lihat components/event-form.jsx & utils/event-form.js.
import DateTimePicker from "../components/DateTimePicker.jsx";
import { Preview, SessionCard } from "../components/event-form.jsx";
import {
	hasSessionDraft,
	joinDT,
	newSession,
	translateErrors,
	withKeys,
} from "../utils/event-form.js";

const notifyEventsChanged = () => window.dispatchEvent(new Event("bph:events-changed"));

export default function EventEditor({ event, prefillDate, canPublish = false, canDelete = false }) {
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
			const card = sessionsEndRef.current?.previousElementSibling;
			card?.scrollIntoView({ behavior: "smooth", block: "start" });
			card?.querySelector("input")?.focus({ preventScroll: true });
		}
		prevSessionsLen.current = sessions.length;
	}, [sessions.length]);


	const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
	// Keep display order stable while typing; sort only the submitted runsheet.
	const setSess = (i, patch) => setSessions(sessions.map((x, j) => (j === i ? { ...x, ...patch } : x)));
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

	async function upload(file) {
		if (uploading || saving) return;
		if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
			toast("Pilih gambar JPG, PNG, atau WebP dengan ukuran maksimal 5 MB.", "err"); return;
		}
		setUploading(true);
		try {
			const fd = new FormData(); fd.append("file", file);
			const res = await fetch("/api/v1/admin/media", { method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd, signal: AbortSignal.timeout(60000) });
			const b = await res.json().catch(() => ({}));
			if (res.status === 401) window.dispatchEvent(new Event("bph:unauthorized"));
			if (!res.ok || b.success === false) throw new Error(b.message || "Upload gagal. Silakan coba lagi.");
			setCover(b.data.url);
			toast("Cover terunggah. Simpan event untuk menerapkan.");
		} catch (e) { toast(e.message || "Upload gagal. Periksa koneksi internet.", "err"); }
		finally { setUploading(false); }
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
		if (form.starts_at && form.ends_at && form.ends_at <= form.starts_at)
			errs.ends_at = "Jam selesai harus setelah jam mulai.";
		if (!form.location.trim()) errs.location = "Lokasi wajib diisi.";
		// Sesi kosong boleh diabaikan; sesi yang mulai diisi wajib lengkap.
		sessions.forEach((s, i) => {
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
				await api(`/admin/events/${id}`, { method: "PUT", json: body });
			} else {
				const slug = form.slug
					.trim()
					.toLowerCase()
					.replace(/[^a-z0-9\s-]/g, "")
					.replace(/[\s_]+/g, "-")
					.replace(/-+/g, "-")
					.replace(/^-|-$/g, "");
				const created = await api("/admin/events", {
					method: "POST",
					json: { ...body, slug: slug || undefined, status: "draft" },
				});
				id = created.id;
				setSavedId(id);
			}
			setSavedSnapshot(snapshot);
			if (publishAfter) {
				await api(`/admin/events/${id}/publish`, { method: "POST" });
				setPublished(true);
				toast("Event diterbitkan — langsung tampil di portal SGA.");
			} else {
				toast(published ? "Perubahan event tersimpan dan tampil di portal." : "Event tersimpan sebagai draft.");
			}
			notifyEventsChanged();
			navigate(`/events/${id}/edit`);
		} catch (e) {
			const translated = translateErrors(e?.errors, sortedSessions.filter(hasSessionDraft), sessions);
			if (Object.keys(translated).length) {
				setErrors(translated);
				toast("Belum tersimpan. " + Object.values(translated).join(" "), "err");
				requestAnimationFrame(() => document.querySelector('[aria-invalid="true"]')?.focus());
			} else toast(e?.message || "Gagal menyimpan.", "err");
		} finally {
			setSaving(false);
		}
	}

	async function unpublish() {
		if (saving) return;
		setSaving(true);
		try {
			await api(`/admin/events/${savedId}/unpublish`, { method: "POST" });
			setPublished(false);
			notifyEventsChanged();
			toast("Event ditarik — tidak terlihat publik.");
		} catch (e) {
			toast(e?.message || "Gagal menarik event.", "err");
		} finally { setSaving(false); }
	}

	async function del() {
		if (saving) return;
		setSaving(true);
		setAskDelete(false);
		try {
			await api(`/admin/events/${savedId}`, { method: "DELETE" });
			notifyEventsChanged();
			toast("Event dihapus permanen.");
			navigate("/events");
		} catch (e) {
			toast(e?.message || "Gagal menghapus.", "err");
		} finally { setSaving(false); }
	}

	return (
		<div className="event-editor">
			<div className="event-editor-scroll">
				<div className="card">
					<div className="section">
						<div className="section-head">
							<div className="section-num">1</div>
							<div>
								<h2>Informasi Utama</h2>
								<p>Identitas event yang dilihat mahasiswa di portal dan link share.</p>
							</div>
						</div>
						<Field label="Nama event" required error={errors.title}>
							<input type="text" value={form.title} onChange={set("title")} placeholder="Cakrawala Festival 2026" />
						</Field>
						{!editing && !savedId && (
							<Field label="Alamat link (slug)" help="Kosongkan = dibuat otomatis dari nama. Contoh: cakrawala-festival-2026" error={errors.slug}>
								<input type="text" value={form.slug} onChange={set("slug")} placeholder="otomatis dari judul" />
							</Field>
						)}
						<Field label="Deskripsi" help="Ceritakan event-nya. Tampil di halaman detail.">
							<textarea rows={4} value={form.description} onChange={set("description")} />
						</Field>
						<Field label="Foto cover" help="JPG/PNG/WebP, maks 5MB. Rasio disarankan 16:9. Ini foto utama yang dilihat mahasiswa.">
							<div className="upload-hint">
								<input
									type="file"
									disabled={uploading || saving}
									accept="image/jpeg,image/png,image/webp"
									aria-label="Unggah foto cover"
									onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
								/>
								{uploading && <p role="status">Mengunggah cover…</p>}
								{cover && <img className="cover-preview" src={cover} alt="Pratinjau cover" />}
							</div>
						</Field>
						<Field label="Penyelenggara" help="Contoh: BPH SGA, BEM.">
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
								<DateTimePicker data-field-control pickerLabel="Mulai" type="datetime-local" value={form.starts_at} onChange={set("starts_at")} />
							</Field>
							<Field label="Selesai" required error={errors.ends_at}>
								<DateTimePicker data-field-control pickerLabel="Selesai" type="datetime-local" value={form.ends_at} onChange={set("ends_at")} />
							</Field>
						</div>
						<Field label="Lokasi" required error={errors.location}>
							<input type="text" value={form.location} onChange={set("location")} placeholder="Auditorium Lt. 2, Kampus Kemang" />
						</Field>
						<Field label="Link Google Maps" help="Tempel link Maps agar tombol 'Lihat Lokasi' muncul di halaman publik." error={errors.location_url}>
							<input type="url" value={form.location_url} onChange={set("location_url")} placeholder="https://maps.app.goo.gl/…" />
						</Field>
					</div>

					<div className="section">
						<div className="section-head">
							<div className="section-num">3</div>
							<div>
								<h2>Pendaftaran</h2>
								<p>Ke mana mahasiswa diarahkan untuk mendaftar.</p>
							</div>
						</div>
						<Field label="Link pendaftaran" help="Link Google Form / WhatsApp tempat mahasiswa mendaftar." error={errors.registration_url}>
							<input type="url" value={form.registration_url} onChange={set("registration_url")} placeholder="https://forms.gle/…" />
						</Field>
						<div className="check-row">
							<input
								type="checkbox"
								id="reg-open"
								checked={form.registration_open}
								onChange={(e) => setForm({ ...form, registration_open: e.target.checked })}
							/>
							<label htmlFor="reg-open" className="field-label" style={{ margin: 0 }}>
								Pendaftaran dibuka
								<span className="field-help" style={{ display: "inline" }}> — kalau mati, tombol Daftar tidak muncul di halaman publik.</span>
							</label>
						</div>
					</div>

					<div className="section">
						<div className="section-head">
							<div className="section-num">4</div>
							<div>
								<h2>Runsheet (Timeline Sesi)</h2>
								<p>Jadwal rinci per jam yang dilihat mahasiswa. Boleh dikosongkan dulu — bisa diisi nanti. Sesi otomatis diurutkan per jam saat disimpan.</p>
							</div>
						</div>
						{sessions.map((s, i) => (
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
						<button className="btn sec" type="button" onClick={() => setSessions([...sessions, newSession(sortedSessions[sortedSessions.length - 1] || { _date: form.starts_at.slice(0, 10), _end: form.starts_at.slice(11, 16) || "08:00" })])}>
							+ Tambah sesi
						</button>
						{errors["sessions"] && <div className="field-err">{errors["sessions"]}</div>}
					</div>
				</div>

				{showPreview && (
					<div className="card preview-card">
						<h2 style={{ fontSize: 15, marginBottom: 10 }}>Pratinjau halaman (perkiraan)</h2>
						<Preview
							form={form}
							sessions={sortedSessions}
							coverImage={cover ? <img src={cover} alt="" /> : null}
						/>
					</div>
				)}

				<div className="editor-save-status" role="status">{saving ? "Menyimpan perubahan…" : uploading ? "Mengunggah cover…" : dirty ? "Ada perubahan yang belum disimpan" : savedId ? "Semua perubahan tersimpan" : "Mulai isi detail event. Kolom bertanda * wajib diisi."}</div>
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
						{canPublish && (
							published ? (
								<button className="btn sec" disabled={saving || uploading} onClick={unpublish}>Tarik (kembali ke draft)</button>
							) : (
								<button className="btn gold" disabled={saving || uploading} onClick={() => setAskPublish(true)}>Terbitkan</button>
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
				{savedId && published && (
					<span className="badge published">Terbit</span>
				)}
				{savedId && !published && <span className="badge draft">Draft</span>}
			</div>

			<Confirm
				open={askPublish}
				title="Terbitkan event?"
				confirmLabel="Ya, terbitkan"
				onCancel={() => setAskPublish(false)}
				onConfirm={() => { setAskPublish(false); save(true); }}
			>
				Event langsung tampil di portal SGA dan bisa disebar lewat link publik.
			</Confirm>

			<Confirm
				open={askDelete}
				title="Hapus permanen?"
				confirmLabel="Ya, hapus permanen"
				danger
				onCancel={() => setAskDelete(false)}
				onConfirm={del}
			>
				Event "{form.title}" beserta semua sesi akan dihapus selamanya. Tidak bisa dibatalkan.
			</Confirm>
		</div>
	);
}
