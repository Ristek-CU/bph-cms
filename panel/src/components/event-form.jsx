import { Field } from "./ui.jsx";
import { IconClock, IconMapPin, IconTicket } from "./Icons.jsx";
import { fmtDateLong, fmtTime, toIsoWib } from "../api.js";

// Komponen presentasional editor event, dipakai bersama oleh EventEditor
// (student event) dan InternalEventEditor (D-AK). Diekstrak supaya "100% mirip"
// tetap benar setelah salah satunya diperbaiki — bukan hanya sama pada hari
// keduanya ditulis.
//
// Hanya komponen di sini; helper tanggal/validasi ada di utils/event-form.js
// (oxlint react/only-export-components: file yang mencampur komponen dan fungsi
// mematikan Fast Refresh).

export function SessionCard({ s, i, err, onChange, onRemove, removeLabel = "Hapus sesi" }) {
	const set = (k) => (e) => onChange(i, { [k]: e.target.value });
	const overnight = s._start && s._end && s._end <= s._start;
	return (
		<div className="sess">
			<div className="sess-head">
				<strong>Sesi {i + 1}</strong>
				<button className="remove" onClick={onRemove} type="button">{removeLabel}</button>
			</div>
			<Field label="Nama sesi" required error={err?.name}>
				<input type="text" value={s.name} onChange={set("name")} placeholder="Seminar Teknis: AI di Industri" />
			</Field>
			<div className="sess-when">
				<Field label="Tanggal" required error={err?.date}>
					<input type="date" value={s._date} onChange={set("_date")} aria-label={`Tanggal sesi ${i + 1}`} />
				</Field>
				<Field label="Mulai jam" required error={err?.starts_at}>
					<input type="time" value={s._start} onChange={set("_start")} aria-label={`Jam mulai sesi ${i + 1}`} />
				</Field>
				<Field label="Selesai jam" required error={err?.ends_at}>
					<input type="time" value={s._end} onChange={set("_end")} aria-label={`Jam selesai sesi ${i + 1}`} />
				</Field>
			</div>
			{s._start && s._end && overnight && (
				<p className="field-help">Selesai lewat tengah malam — sesi dihitung sampai besok ({s._end} hari berikutnya).</p>
			)}
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
			{err?.range && <div className="field-err">{err.range}</div>}
		</div>
	);
}

/**
 * Pratinjau lokal. Draft tidak bisa dipratinjau dari endpoint publik (404),
 * jadi pratinjau dirender dari state form — bukan dari server.
 *
 * `coverImage` berupa node React, bukan URL: internal event menyimpan cover di
 * prefix R2 ber-auth yang tidak bisa dirender <img src> polos (K-6), jadi
 * pemanggil yang menentukan — <img> untuk student event, <AuthImage> untuk
 * internal event.
 */
export function Preview({ form, sessions, coverImage, note, ariaLabel = "Pratinjau halaman event" }) {
	return (
		<div className="preview" aria-label={ariaLabel}>
			{coverImage || (
				<div className="placeholder-cover">{(form.title || "?")[0]?.toUpperCase()}</div>
			)}
			<div className="p-body">
				{note && <p className="preview-note">{note}</p>}
				<h3>{form.title || "(nama event)"}</h3>
				{form.organizer && <div className="muted small">Oleh {form.organizer}</div>}
				<div className="p-meta">
					{form.starts_at && (
						<span className="meta-item">
							<IconClock size={13} /> {fmtDateLong(toIsoWib(form.starts_at))} · {fmtTime(toIsoWib(form.starts_at))}–{form.ends_at ? fmtTime(toIsoWib(form.ends_at)) : ""} WIB
						</span>
					)}
					{form.location && (
						<span className="meta-item">
							<IconMapPin size={13} /> {form.location}
						</span>
					)}
					{form.registration_url && form.registration_open && (
						<span className="meta-item">
							<IconTicket size={13} /> Pendaftaran: terbuka
						</span>
					)}
				</div>
				{form.description && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{form.description}</p>}
				{sessions.length > 0 && (
					<ul className="timeline">
						{sessions.map((s) => (
							<li key={s._key}>
								<span className="t">
									{s._start || "--:00"}
									<small>–{s._end || "--:00"}</small>
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
