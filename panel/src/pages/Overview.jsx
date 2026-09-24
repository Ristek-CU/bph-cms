import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, displayStatus, fmtRange, publicLink } from "../api.js";
import { useToast, copyText, ErrorState } from "../components/ui.jsx";
import { href } from "../components/Shell.jsx";
import Calendar from "../components/Calendar.jsx";
import { IconChevronRight } from "../components/Icons.jsx";
import { internalCalendarLinks, internalCaps } from "../utils/internal-event.js";

const LABEL = { draft: "Draft", ongoing: "Berlangsung", upcoming: "Akan Datang", past: "Selesai" };

export default function Overview({ events, onEdit, capabilities, user }) {
	const toast = useToast();
	const navigate = useNavigate();
	const caps = internalCaps(user, capabilities);

	// Dua sumber data yang SENGAJA berbeda (K-11):
	//   - widget kalender        = agenda INTERNAL semua divisi
	//   - tabel "Event terdekat" = student event publik semua divisi (tidak berubah)
	// Keduanya default ke bulan berjalan WIB karena tidak mengirim ?month=.
	const [internalEvents, setInternalEvents] = useState(null);
	const [calErr, setCalErr] = useState("");
	const [publicEvents, setPublicEvents] = useState([]);
	const [soonErr, setSoonErr] = useState("");

	const loadCalendar = () => {
		setCalErr("");
		api("/admin/internal-events/calendar")
			.then((d) => setInternalEvents(d.items || []))
			.catch((e) => setCalErr(e?.message || "Gagal memuat kalender."));
	};
	const loadSoonest = () => {
		setSoonErr("");
		api("/admin/events/calendar")
			.then((d) => setPublicEvents(d.items || []))
			.catch((e) => setSoonErr(e?.message || "Gagal memuat event terdekat."));
	};
	useEffect(() => {
		loadCalendar();
		loadSoonest();
	}, []);

	const counts = events.reduce(
		(acc, e) => {
			acc.total++;
			acc[displayStatus(e)]++;
			return acc;
		},
		{ total: 0, draft: 0, ongoing: 0, upcoming: 0, past: 0 },
	);

	// 5 event terdekat — tetap student event publik semua divisi, urut waktu,
	// berlangsung + akan datang.
	const soonest = [...publicEvents]
		.filter((e) => displayStatus(e) !== "past")
		.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
		.slice(0, 5);

	const copyLink = (e) => {
		if (e.status === "draft") {
			toast("Link aktif setelah event diterbitkan.");
			return;
		}
		copyText(publicLink(e)).then(
			() => toast("Link publik disalin."),
			() => toast("Tidak bisa menyalin — salin manual dari halaman event.", "err"),
		);
	};

	return (
		<>
			<div className="page-intro"><p className="studio-kicker">RUANG KERJA PENGURUS</p><h2>Semua agenda, dalam jangkauan.</h2><p>Pantau event berjalan dan siapkan kegiatan berikutnya.</p></div>
			<div className="stat-grid">
				<div className="stat hero">
					<div className="num">{counts.ongoing}</div>
					<div className="lbl">Event berlangsung sekarang</div>
				</div>
				<div className="stat"><div className="num">{counts.upcoming}</div><div className="lbl">Akan datang</div></div>
				<div className="stat"><div className="num">{counts.draft}</div><div className="lbl">Masih draft</div></div>
				<div className="stat"><div className="num">{counts.total}</div><div className="lbl">Total event</div></div>
			</div>

			<div className="overview-grid">
				<div>
					<div className="card">
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
							<h2 className="card-title">Kalender internal — semua divisi</h2>
							<Link to="/internal-events/kalender" className="small overview-link">
								Buka penuh <IconChevronRight size={13} />
							</Link>
						</div>
						<p className="muted small" style={{ marginTop: -4 }}>
							Agenda internal seluruh divisi — rencanakan jadwal divisimu tanpa
							bentrok dengan divisi lain. Tidak tampil di situs publik.
						</p>
						{calErr ? (
							<ErrorState message={calErr} onRetry={loadCalendar} />
						) : (
							<Calendar
								events={internalEvents || []}
								ownDivisionId={user?.division?.id || null}
								onEdit={(id) => navigate(`/internal-events/${id}/edit`)}
								capabilities={{ canCreateEvent: caps.canCreate, canEditEvent: caps.canEdit }}
								links={internalCalendarLinks(caps)}
								compact
							/>
						)}
					</div>
				</div>

				<div>
					<div className="card">
						{/* Judul diberi penanda "publik" karena kalender di sebelahnya sekarang
						    agenda internal — tanpa pembeda, dua panel ini terlihat redundan. */}
						<h2 className="card-title" style={{ marginBottom: 10 }}>Event publik terdekat</h2>
						<p className="muted small" style={{ marginTop: -4, marginBottom: 10 }}>
							Student event semua divisi yang tampil di situs publik.
						</p>
						{soonErr ? (
							<ErrorState message={soonErr} onRetry={loadSoonest} />
						) : soonest.length === 0 ? (
							<p className="muted">
								Belum ada event yang berlangsung atau akan datang.
								{capabilities?.canCreateEvent && (
									<>
										{" "}
										<a href={href("/events/baru")}>Buat event baru</a> dulu.
									</>
								)}
							</p>
						) : (
							<div className="tbl-wrap">
								<table className="tbl">
								<thead>
									<tr><th>Event</th><th>Waktu (WIB)</th><th>Status</th><th /></tr>
								</thead>
								<tbody>
									{soonest.map((e) => (
										<tr key={e.id}>
											<td><strong>{e.title}</strong><br /><span className="slug muted small">/{e.slug}</span></td>
											<td>{fmtRange(e.starts_at, e.ends_at)}</td>
											<td><span className={`badge ${displayStatus(e)}`}>{LABEL[displayStatus(e)]}</span></td>
											<td>
												<button className="btn sec sm" onClick={() => copyLink(e)}>Salin link</button>{" "}
												{capabilities?.canEditEvent?.(e) && (
													<button className="btn sm" onClick={() => onEdit(e.id)}>Edit</button>
												)}
											</td>
										</tr>
									))}
								</tbody>
								</table>
							</div>
						)}
					</div>
				</div>
			</div>
		</>
	);
}
