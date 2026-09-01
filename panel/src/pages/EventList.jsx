import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayStatus, fmtRange, gcalUrl, publicLink } from "../api.js";
import { useToast } from "../components/ui.jsx";

const LABEL = { draft: "Draft", ongoing: "Terbit — Berlangsung", upcoming: "Terbit — Akan Datang", past: "Terbit — Selesai" };
const FILTERS = [
	["all", "Semua"],
	["draft", "Draft"],
	["ongoing", "Berlangsung"],
	["upcoming", "Akan datang"],
	["past", "Selesai"],
];

export default function EventList({ events, onEdit }) {
	const [q, setQ] = useState("");
	const [filter, setFilter] = useState("all");
	const navigate = useNavigate();
	const toast = useToast();

	const list = useMemo(() => {
		const needle = q.trim().toLowerCase();
		return events.filter((e) => {
			const st = displayStatus(e);
			if (filter !== "all" && st !== filter) return false;
			if (!needle) return true;
			return [e.title, e.slug, e.location, e.organizer]
				.filter(Boolean)
				.some((s) => s.toLowerCase().includes(needle));
		});
	}, [events, q, filter]);

	const copyLink = (e) => {
		if (e.status === "draft") {
			toast("Link aktif setelah event diterbitkan.");
			return;
		}
		navigator.clipboard?.writeText(publicLink(e)).then(
			() => toast("Link publik disalin."),
			() => toast("Tidak bisa menyalin link.", "err"),
		);
	};

	return (
		<>
			<div className="toolbar">
				<input
					type="text"
					placeholder="Cari judul, lokasi, penyelenggara…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					aria-label="Cari event"
				/>
				{FILTERS.map(([key, label]) => (
					<button key={key} className={`chip ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
						{label}
					</button>
				))}
			</div>

			{list.length === 0 ? (
				<div className="empty-state">
					<p style={{ margin: "0 0 12px" }}>
						{events.length === 0
							? "Belum ada event sama sekali."
							: "Tidak ada event yang cocok dengan pencarian atau filter."}
					</p>
					<button className="btn gold" onClick={() => navigate("/events/baru")}>+ Buat event pertama</button>
				</div>
			) : (
				<div className="event-grid">
					{list.map((e) => {
						const st = displayStatus(e);
						return (
							<article key={e.id} className="event-card">
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
										<span>🕒 {fmtRange(e.starts_at, e.ends_at)}</span>
										<span>📍 {e.location}</span>
										<span>👥 {e.sessions?.length || 0} sesi runsheet{e.organizer ? ` · ${e.organizer}` : ""}</span>
									</div>
									<div className="actions">
										<button className="btn sec sm" onClick={() => copyLink(e)}>Salin link</button>
										<button className="btn sm" onClick={() => onEdit(e.id)}>Edit</button>
										<a
											className="btn ghost sm"
											href={gcalUrl(e)}
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
											📅 Kalender
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
