import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayStatus, fmtRange } from "../api.js";
import { ErrorState, SkeletonCard, copyText, useToast } from "../components/ui.jsx";
import { IconCalendar, IconClock, IconLock, IconMapPin, IconPlus, IconUsers } from "../components/Icons.jsx";
import { LABEL, internalCaps, internalGcalUrl, internalLink, useInternalEvents } from "../utils/internal-event.js";

const FILTERS = [
	["all", "Semua"],
	["draft", "Draft"],
	["ongoing", "Berlangsung"],
	["upcoming", "Akan datang"],
	["past", "Selesai"],
];

// Daftar internal event. Bentuk kartu dan filternya sengaja sama dengan
// EventList (student event) supaya pengurus tidak belajar dua kali.
//
// Bedanya: ada filter divisi (K-2 — semua divisi terbaca), badge "Internal",
// dan tidak ada tombol "Salin link publik" karena halamannya memang tidak ada.
export default function InternalEventList({ user, capabilities }) {
	const { events, loading, error, reload } = useInternalEvents();
	const [q, setQ] = useState("");
	const [filter, setFilter] = useState("all");
	const [division, setDivision] = useState("all");
	const navigate = useNavigate();
	const toast = useToast();
	const caps = internalCaps(user, capabilities);

	const divisions = useMemo(() => {
		const map = new Map();
		for (const e of events) {
			if (e.division_id) map.set(e.division_id, e.division_name || "Divisi");
		}
		return [...map.entries()];
	}, [events]);

	const list = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return events.filter((e) => {
			if (division !== "all" && e.division_id !== division) return false;
			if (filter !== "all" && displayStatus(e) !== filter) return false;
			if (!needle) return true;
			return [e.title, e.slug, e.location, e.organizer, e.division_name]
				.filter(Boolean)
				.some((s) => s.toLowerCase().includes(needle));
		});
	}, [events, q, filter, division]);

	const copyLink = (e) =>
		copyText(internalLink(e)).then(
			() => toast("Link panel disalin — hanya bisa dibuka pengurus yang login."),
			() => toast("Tidak bisa menyalin link.", "err"),
		);

	if (error) return <ErrorState title="Internal event belum bisa dimuat" message={error} onRetry={reload} />;
	if (loading) return <SkeletonCard lines={5} />;

	return (
		<>
			<div className="internal-notice" role="note">
				<IconLock size={16} />
				<span>
					Agenda internal organisasi. Tidak pernah tampil di situs publik maupun
					landing page — hanya pengurus SGA yang login yang bisa melihat.
				</span>
			</div>

			<div className="toolbar">
				<input
					type="text"
					placeholder="Cari judul, lokasi, penyelenggara, divisi…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					aria-label="Cari internal event"
				/>
				{divisions.length > 1 && (
					<select
						value={division}
						onChange={(e) => setDivision(e.target.value)}
						aria-label="Saring berdasarkan divisi"
					>
						<option value="all">Semua divisi</option>
						{divisions.map(([id, name]) => (
							<option key={id} value={id}>{name}</option>
						))}
					</select>
				)}
				{FILTERS.map(([key, label]) => (
					<button key={key} aria-pressed={filter === key} className={`chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
						{label}
					</button>
				))}
			</div>

			<p className="results-count" role="status">{list.length} dari {events.length} internal event</p>

			{list.length === 0 ? (
				<div className="empty-state">
					<p style={{ margin: "0 0 12px" }}>
						{events.length === 0
							? "Belum ada internal event. Rapat, koordinasi, dan agenda internal divisi bisa dicatat di sini."
							: "Tidak ada internal event yang cocok dengan pencarian atau filter."}
					</p>
					{events.length > 0 && (
						<button className="btn sec" onClick={() => { setQ(""); setFilter("all"); setDivision("all"); }}>
							Reset pencarian &amp; filter
						</button>
					)}
					{events.length === 0 && caps.canCreate && (
						<button className="btn gold" onClick={() => navigate("/internal-events/baru")}>
							<IconPlus size={16} /> Buat internal event pertama
						</button>
					)}
				</div>
			) : (
				<div className="event-grid">
					{list.map((e) => {
						const st = displayStatus(e);
						const otherDiv = e.division_id !== user?.division?.id;
						return (
							<article key={e.id} className="event-card internal">
								<div className="accent" />
								<div className="body">
									<div className="title-row">
										<div style={{ minWidth: 0 }}>
											<h3>{e.title}</h3>
											<span className="slug">/{e.slug}</span>
										</div>
										<span className={`badge ${st}`}>{LABEL[st]}</span>
									</div>
									<div className="meta">
										{otherDiv && <span className="badge div">{e.division_name || "Divisi lain"}</span>}
										<span className="meta-item"><IconClock size={14} /> {fmtRange(e.starts_at, e.ends_at)}</span>
										<span className="meta-item"><IconMapPin size={14} /> {e.location}</span>
										<span className="meta-item"><IconUsers size={14} /> {e.sessions?.length || 0} sesi runsheet{e.organizer ? ` · ${e.organizer}` : ""}</span>
									</div>
									<div className="actions">
										<button className="btn sec sm" onClick={() => navigate(`/internal-events/${e.id}`)}>Lihat detail</button>
										<button className="btn ghost sm" onClick={() => copyLink(e)}>Salin link</button>
										{caps.canEdit(e) && (
											<button className="btn sm" onClick={() => navigate(`/internal-events/${e.id}/edit`)}>Edit</button>
										)}
										<a
											className="btn ghost sm"
											href={internalGcalUrl(e)}
											target="_blank"
											rel="noreferrer"
											title="Tambah ke Google Calendar"
											onClick={(ev) => {
												if (e.status === "draft") {
													ev.preventDefault();
													toast("Terbitkan dulu supaya tanggal final, baru tambah ke kalender.");
												}
											}}
										>
											<IconCalendar size={14} /> Kalender
										</a>
									</div>
								</div>
							</article>
						);
					})}
				</div>
			)}
		</>
	);
}
