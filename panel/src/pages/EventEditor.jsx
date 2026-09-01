import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	api, getToken, isoToInput, toIsoWib, fmtTime, fmtDateLong,
} from "../api.js";
import { Confirm, useToast } from "../components/ui.jsx";

let sessSeq = 0;
const newSession = (after) => {
	// Default: lanjut 1 jam setelah sesi terakhir — runsheet nyambung.
	const base = after ? after._end || after._start : "";
	const t = base ? new Date(`${base.slice(0, 10)}T${(base.slice(11) || "08:00")}:00`) : null;
	const bump = (mins) => {
		if (!t) return "";
		const d = new Date(t.getTime() + mins * 60000);
		return `${d.toISOString().slice(0, 10)}T${d.toISOString().slice(11, 16)}`;
	};
	return {
		_key: `s${++sessSeq}`,
		name: "",
		_start: bump(0),
		_end: bump(60),
		speaker: "",
		location: "",
		description: "",
	};
};
const withKeys = (arr) =>
	arr.map((s) => ({
		...s,
		_key: `s${++sessSeq}`,
		_start: isoToInput(s.starts_at),
		_end: isoToInput(s.ends_at),
	}));

// Terjemahan error 422 server ke Bahasa Indonesia (fallback: pesan asli).
const ERR_MAP = [
	[/^title/, "Nama event wajib diisi."],
	[/^starts_at/, "Jam mulai tidak valid."],
	[/^ends_at.*after/, "Jam selesai harus setelah jam mulai."],
	[/^location$/, "Lokasi wajib diisi."],
	[/^location_url|^registration_url|^cover_image_url/, "Link tidak valid — pastikan diawali https://"],
	[/^sessions\.(\d+)/, "Ada sesi di luar jam event. Perbaiki jam sesi atau perpanjang jam event."],
	[/^slug/, "Alamat link sudah dipakai atau tidak valid. Ganti yang lain."],
];
const translateErrors = (errors) => {
	const out = {};
	for (const [f, msgs] of Object.entries(errors || {})) {
		const hit = ERR_MAP.find(([re]) => re.test(f));
		out[f] = hit ? hit[1] : msgs.join(", ");
	}
	return out;
};

function Field({ label, required, help, error, children }) {
	return (
		<div>
			<label className="field-label">
				{label} {required && <span className="req">*</span>}
			</label>
			{children}
			{help && <p className="field-help">{help}</p>}
			{error && <div className="field-err">{error}</div>}
		</div>
	);
}

function SessionCard({ s, i, onChange, onRemove }) {
	const set = (k) => (e) => onChange(i, { [k]: e.target.value });
	return (
		<div className="sess">
			<div className="sess-head">
				<strong>Sesi {i + 1}</strong>
				<button className="remove" onClick={onRemove} type="button">Hapus sesi</button>
			</div>
			<Field label="Nama sesi" required error={s._err?.name}>
				<input type="text" value={s.name} onChange={set("name")} placeholder="Seminar Teknis: AI di Industri" />
			</Field>
			<div className="grid-2">
				<Field label="Mulai (WIB)" error={s._err?.starts_at}>
					<input type="datetime-local" value={s._start} onChange={set("_start")} />
				</Field>
				<Field label="Selesai (WIB)" error={s._err?.ends_at}>
					<input type="datetime-local" value={s._end} onChange={set("_end")} />
				</Field>
			</div>
			<div className="grid-2">
				<Field label="Pemateri / PIC">
					<input type="text" value={s.speaker || ""} onChange={set("speaker")} placeholder="Nama pemateri" />
				</Field>
				<Field label="Ruang / titik lokasi">
					<input type="text" value={s.location || ""} onChange={set("location")} placeholder="Auditorium Lt. 2" />
				</Field>
			</div>
			<Field label="Catatan sesi">
				<textarea rows={2} value={s.description || ""} onChange={set("description")} placeholder="Poin-poin sesi (opsional)" />
			</Field>
		</div>
	);
}

// Pratinjau lokal (draft tidak bisa dipratinjau dari endpoint publik — 404).
function Preview({ form, sessions, cover }) {
	return (
		<div className="preview" aria-label="Pratinjau halaman event">
			{cover ? (
				<img src={cover} alt="" />
			) : (
				<div className="placeholder-cover">{(form.title || "?")[0]?.toUpperCase()}</div>
			)}
			<div className="p-body">
				<h3>{form.title || "(nama event)"}</h3>
				{form.organizer && <div className="muted small">Oleh {form.organizer}</div>}
				<div className="p-meta">
					{form.starts_at && <span>🕒 {fmtDateLong(toIsoWib(form.starts_at))} · {fmtTime(toIsoWib(form.starts_at))}–{form.ends_at ? fmtTime(toIsoWib(form.ends_at)) : ""} WIB</span>}
					{form.location && <span>📍 {form.location}</span>}
					{form.registration_url && form.registration_open && <span>🎟 Pendaftaran: terbuka</span>}
				</div>
				{form.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{form.description}</p>}
				{sessions.length > 0 && (
					<ul className="timeline">
						{sessions.map((s) => (
							<li key={s._key}>
								<span className="t">
									{s._start ? fmtTime(toIsoWib(s._start)) : "--:00"}
									<small>–{s._end ? fmtTime(toIsoWib(s._end)) : "--:00"}</small>
								</span>
								<span>
									<strong>{s.name || "(nama sesi)"}</strong>
									{s.speaker && <> — {s.speaker}</>}
									{s.location && <span className="muted"> · {s.location}</span>}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

export default function EventEditor({ event, prefillDate }) {
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

	const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
	const setSess = (i, patch) => setSessions(sessions.map((s, j) => (i === j ? { ...s, ...patch } : s)));
	const sortedSessions = useMemo(
		() => [...sessions].sort((a, b) => (a._start || "").localeCompare(b._start || "")),
		[sessions],
	);

	async function upload(file) {
		const fd = new FormData();
		fd.append("file", file);
		const res = await fetch("/api/v1/admin/media", {
			method: "POST",
			headers: { Authorization: `Bearer ${getToken()}` },
			body: fd,
		});
		const b = await res.json().catch(() => ({}));
		if (!res.ok || b.success === false) {
			toast(b?.message || "Upload gagal. Cek ukuran maks 5MB.", "err");
			return;
		}
		setCover(b.data.url);
		toast("Cover terupload.");
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
				.filter((s) => s.name.trim())
				.map((s) => ({
					name: s.name.trim(),
					starts_at: toIsoWib(s._start),
					ends_at: toIsoWib(s._end),
					speaker: s.speaker || null,
					location: s.location || null,
					description: s.description || null,
				})),
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
		return errs;
	}

	async function save(publishAfter) {
		const errs = clientValidate();
		setErrors(errs);
		if (Object.keys(errs).length) {
			toast("Masih ada isian yang perlu diperbaiki.", "err");
			return;
		}
		setSaving(true);
		try {
			const body = payload();
			let id = savedId;
			if (editing || savedId) {
				await api(`/admin/events/${id}`, { method: "PUT", json: body });
			} else {
				const created = await api("/admin/events", {
					method: "POST",
					json: { ...body, slug: form.slug.trim() || undefined },
				});
				id = created.id;
				setSavedId(id);
			}
			if (publishAfter) {
				await api(`/admin/events/${id}/publish`, { method: "POST" });
				setPublished(true);
				toast("Event diterbitkan — langsung tampil di portal SGA.");
			} else {
				toast("Tersimpan sebagai draft.");
			}
			navigate(`/events/${id}/edit`);
		} catch (e) {
			const translated = translateErrors(e?.errors);
			if (Object.keys(translated).length) setErrors(translated);
			else toast(e?.message || "Gagal menyimpan.", "err");
		} finally {
			setSaving(false);
		}
	}

	async function unpublish() {
		try {
			await api(`/admin/events/${savedId}/unpublish`, { method: "POST" });
			setPublished(false);
			toast("Event ditarik — tidak terlihat publik.");
		} catch (e) {
			toast(e?.message || "Gagal menarik event.", "err");
		}
	}

	async function del() {
		setAskDelete(false);
		try {
			await api(`/admin/events/${savedId}`, { method: "DELETE" });
			toast("Event dihapus permanen.");
			navigate("/events");
		} catch (e) {
			toast(e?.message || "Gagal menghapus.", "err");
		}
	}

	return (
		<>
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
								accept="image/jpeg,image/png,image/webp"
								aria-label="Unggah foto cover"
								onChange={(e) => e.target.files[0] && upload(e.target.files[0])}
							/>
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
							<input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} />
						</Field>
						<Field label="Selesai" required error={errors.ends_at}>
							<input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} />
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
							onChange={setSess}
							onRemove={() => setSessions(sessions.filter((_, j) => j !== i))}
						/>
					))}
					<button className="btn sec" type="button" onClick={() => setSessions([...sessions, newSession(sessions[sessions.length - 1])])}>
						+ Tambah sesi
					</button>
					{errors["sessions"] && <div className="field-err">{errors["sessions"]}</div>}
				</div>
			</div>

			<div className="sticky-bar">
				{!editing && !savedId ? (
					<>
						<button className="btn" onClick={() => save(false)} disabled={saving}>
							{saving ? "Menyimpan…" : "Simpan Draft"}
						</button>
						<button className="btn gold" onClick={() => save(true)} disabled={saving}>
							Simpan &amp; Terbitkan
						</button>
					</>
				) : (
					<>
						<button className="btn" onClick={() => save(false)} disabled={saving}>
							{saving ? "Menyimpan…" : "Simpan Perubahan"}
						</button>
						{published ? (
							<button className="btn sec" onClick={unpublish}>Tarik (kembali ke draft)</button>
						) : (
							<button className="btn gold" onClick={() => setAskPublish(true)}>Terbitkan</button>
						)}
					</>
				)}
				<button className="btn ghost" onClick={() => setShowPreview(!showPreview)}>
					{showPreview ? "Sembunyikan pratinjau" : "Pratinjau"}
				</button>
				{savedId && (
					<button className="btn danger" style={{ marginLeft: "auto" }} onClick={() => setAskDelete(true)}>
						Hapus Permanen
					</button>
				)}
				{savedId && published && (
					<span className="badge published">Terbit</span>
				)}
				{savedId && !published && <span className="badge draft">Draft</span>}
			</div>

			{showPreview && (
				<div className="card" style={{ marginTop: 16 }}>
					<h2 style={{ fontSize: 15, marginBottom: 10 }}>Pratinjau halaman (perkiraan)</h2>
					<Preview form={form} sessions={sortedSessions} cover={cover} />
				</div>
			)}

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
		</>
	);
}
