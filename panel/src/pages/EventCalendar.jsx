import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayStatus, fmtRange } from "../api.js";
import { Confirm } from "../components/ui.jsx";

const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Tanggal lokal YYYY-MM-DD tanpa tolleransi zona (input datetime-local friendly).
const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Event aktif di tanggal tsb (overlap rentang, hari dalam WIB).
function eventsOnDay(events, dayKey) {
	const dayStart = Date.parse(`${dayKey}T00:00:00+07:00`);
	const dayEnd = dayStart + 24 * 3600000;
	return events.filter(
		(e) => Date.parse(e.starts_at) < dayEnd && Date.parse(e.ends_at) >= dayStart,
	);
}

export default function EventCalendar({ events, onEdit }) {
	const now = new Date();
	const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
	const [picked, setPicked] = useState(null); // { dayKey, events } panel samping
	const [askNew, setAskNew] = useState(null); // dayKey utk buat event baru
	const navigate = useNavigate();

	const cells = useMemo(() => {
		// Senin sebagai hari pertama kolom.
		const first = new Date(ym.y, ym.m, 1);
		const offset = (first.getDay() + 6) % 7;
		const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
		const out = [];
		const prevDays = new Date(ym.y, ym.m, 0).getDate();
		for (let i = offset; i > 0; i--)
			out.push({ key: ymd(ym.y, ym.m - 1 < 0 ? 11 : ym.m - 1, prevDays - i + 1), other: true });
		for (let d = 1; d <= daysInMonth; d++) out.push({ key: ymd(ym.y, ym.m, d) });
		while (out.length % 7 !== 0)
			out.push({ key: ymd(ym.y, (ym.m + 1) % 12, out.length - offset - daysInMonth + 1), other: true });
		return out;
	}, [ym]);

	const todayKey = ymd(now.getFullYear(), now.getMonth(), now.getDate());
	const shift = (delta) => {
		const m = ym.m + delta;
		setYm({ y: ym.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 });
		setPicked(null);
	};

	return (
		<>
			<div className="cal-nav">
				<button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Bulan sebelumnya">‹</button>
				<h2>{MONTHS[ym.m]} {ym.y}</h2>
				<button className="btn ghost sm" onClick={() => shift(1)} aria-label="Bulan berikutnya">›</button>
				<button className="btn sec sm" onClick={() => { setYm({ y: now.getFullYear(), m: now.getMonth() }); setPicked(null); }}>Hari ini</button>
				<div className="cal-legend">
					<span><i style={{ background: "#dcfce7" }} /> Berlangsung</span>
					<span><i style={{ background: "#dbeafe" }} /> Akan datang</span>
					<span><i style={{ background: "#ede9e3" }} /> Selesai</span>
					<span><i style={{ background: "#f3f4f6" }} /> Draft</span>
				</div>
			</div>

			<div className="cal-grid">
				{DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
				{cells.map((c) => {
					const dayEvents = eventsOnDay(events, c.key);
					return (
						<div
							key={c.key}
							className={`cal-cell ${c.other ? "other" : ""} ${c.key === todayKey ? "today" : ""}`}
							onClick={() => !c.other && setPicked({ dayKey: c.key, events: dayEvents })}
							role="button"
							tabIndex={c.other ? -1 : 0}
							aria-label={`Lihat event ${c.key}`}
							onKeyDown={(e) => e.key === "Enter" && !c.other && setPicked({ dayKey: c.key, events: dayEvents })}
						>
							<span className="d">{Number(c.key.slice(8))}</span>
							{dayEvents.map((e) => (
								<button
									key={e.id}
									className={`cal-chip ${displayStatus(e)}`}
									onClick={(ev) => { ev.stopPropagation(); setPicked({ dayKey: c.key, events: dayEvents }); }}
									title={e.title}
								>
									{e.title}
								</button>
							))}
							{/* mobile: dot pengganti chip */}
							{dayEvents.slice(0, 3).map((e) => <span key={e.id} className="dot" style={{ background: "var(--teal)" }} />)}
						</div>
					);
				})}
			</div>
			<p className="muted small" style={{ marginTop: 10 }}>
				Klik tanggal untuk melihat event hari itu — atau klik tanggal kosong untuk membuat event baru dengan tanggal tersebut. Semua waktu WIB.
			</p>

			{picked && (
				<div className="card" style={{ marginTop: 16 }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
						<h2 style={{ fontSize: 16 }}>Event pada {picked.dayKey}</h2>
						<button className="btn ghost sm" onClick={() => setPicked(null)}>Tutup</button>
					</div>
					{picked.events.length === 0 ? (
						<p className="muted">Tidak ada event. <button className="btn sec sm" onClick={() => setAskNew(picked.dayKey)}>+ Buat event di tanggal ini</button></p>
					) : (
						<table className="tbl">
							<thead><tr><th>Event</th><th>Waktu (WIB)</th><th>Status</th><th /></tr></thead>
							<tbody>
								{picked.events.map((e) => (
									<tr key={e.id}>
										<td><strong>{e.title}</strong>{e.status === "draft" && <span className="badge draft" style={{ marginLeft: 8 }}>Draft</span>}</td>
										<td>{fmtRange(e.starts_at, e.ends_at)}</td>
										<td><span className={`badge ${displayStatus(e)}`}>{displayStatus(e)}</span></td>
										<td><button className="btn sm" onClick={() => onEdit(e.id)}>Edit</button></td>
									</tr>
								))}
							</tbody>
						</table>
					)}
					{picked.events.length > 0 && (
						<p style={{ marginBottom: 0 }}><button className="btn sec sm" onClick={() => setAskNew(picked.dayKey)}>+ Buat event lain di tanggal ini</button></p>
					)}
				</div>
			)}

			<Confirm
				open={!!askNew}
				title="Buat event baru?"
				confirmLabel="Ya, buat"
				onCancel={() => setAskNew(null)}
				onConfirm={() => {
					navigate(`/events/baru?date=${askNew}`);
					setAskNew(null);
				}}
			>
				Event baru akan dibuka dengan tanggal {askNew} (08:00–17:00 WIB). Lanjutkan?
			</Confirm>
		</>
	);
}
