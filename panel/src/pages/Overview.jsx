import { Link } from "react-router-dom";
import { displayStatus, fmtRange, publicLink } from "../api.js";
import { useToast } from "../components/ui.jsx";
import { href } from "../components/Shell.jsx";
import Calendar from "../components/Calendar.jsx";
import { IconChevronRight } from "../components/Icons.jsx";

const LABEL = { draft: "Draft", ongoing: "Berlangsung", upcoming: "Akan Datang", past: "Selesai" };

export default function Overview({ events, onEdit }) {
	const toast = useToast();

	const counts = events.reduce(
		(acc, e) => {
			acc.total++;
			acc[displayStatus(e)]++;
			return acc;
		},
		{ total: 0, draft: 0, ongoing: 0, upcoming: 0, past: 0 },
	);

	// 5 event terdekat: berlangsung dulu, lalu akan datang terdekat.
	const soonest = [...events]
		.filter((e) => e.status !== "draft" && displayStatus(e) !== "past")
		.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
		.slice(0, 5);

	const copyLink = (e) => {
		if (e.status === "draft") {
			toast("Link aktif setelah event diterbitkan.");
			return;
		}
		navigator.clipboard?.writeText(publicLink(e)).then(
			() => toast("Link publik disalin."),
			() => toast("Tidak bisa menyalin — salin manual dari halaman event.", "err"),
		);
	};

	return (
		<>
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
							<h2 className="card-title">Kalender event</h2>
							<Link to="/events/kalender" className="small overview-link">
								Buka penuh <IconChevronRight size={13} />
							</Link>
						</div>
						<Calendar events={events} onEdit={onEdit} compact />
					</div>
				</div>

				<div>
					<div className="card">
						<h2 className="card-title" style={{ marginBottom: 10 }}>Event terdekat</h2>
						{soonest.length === 0 ? (
							<p className="muted">
								Belum ada event yang terbit.{" "}
								<a href={href("/events/baru")}>Buat event baru</a> dulu.
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
													<button className="btn sm" onClick={() => onEdit(e.id)}>Edit</button>
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
