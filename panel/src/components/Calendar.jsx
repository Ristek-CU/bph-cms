import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { displayStatus, fmtDateLong, fmtRange, fmtTime, gcalUrl, publicLink } from "../api.js";
import { Confirm } from "./ui.jsx";

const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Event aktif di tanggal tsb (overlap rentang, hari dalam WIB).
export function eventsOnDay(events, dayKey) {
	const dayStart = Date.parse(`${dayKey}T00:00:00+07:00`);
	const dayEnd = dayStart + 24 * 3600000;
	return events.filter(
		(e) => Date.parse(e.starts_at) < dayEnd && Date.parse(e.ends_at) >= dayStart,
	);
}

// Sesi event yang jatuh di hari tsb (runsheet per jam).
function sessionsOnDay(ev, dayKey) {
	const dayStart = Date.parse(`${dayKey}T00:00:00+07:00`);
	const dayEnd = dayStart + 24 * 3600000;
	return (ev.sessions || []).filter(
		(s) => Date.parse(s.starts_at) < dayEnd && Date.parse(s.ends_at) >= dayStart,
	);
}

// Panel agenda: detail hari terpilih — event + sesi per jam + aksi.
function DayAgenda({ dayKey, events, onEdit, onNew }) {
	return (
		<div className="card" style={{ marginTop: 16 }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
				<div>
					<h2 style={{ fontSize: 16 }}>{fmtDateLong(`${dayKey}T12:00:00+07:00`)}</h2>
					<span className="muted small">{events.length} event · WIB</span>
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button className="btn sec sm" onClick={() => onNew(dayKey)}>+ Buat event di tanggal ini</button>
				</div>
			</div>

			{events.length === 0 ? (
				<p className="muted" style={{ marginBottom: 0 }}>Tidak ada event pada tanggal ini.</p>
			) : (
				events.map((e) => {
					const st = displayStatus(e);
					const sess = sessionsOnDay(e, dayKey);
					return (
						<div key={e.id} className="agenda-ev">
							<div className="agenda-ev-head">
								<div style={{ minWidth: 0 }}>
									<strong>{e.title}</strong>
									{e.status === "draft" && <span className="badge draft" style={{ marginLeft: 8 }}>Draft</span>}
									<div className="muted small">🕒 {fmtRange(e.starts_at, e.ends_at)} · 📍 {e.location}</div>
								</div>
								<span className={`badge ${st}`}>{st}</span>
							</div>
							{sess.length > 0 && (
								<ul className="timeline">
									{sess.map((s) => (
										<li key={s.id}>
											<span className="t">{fmtTime(s.starts_at)}<small>–{fmtTime(s.ends_at)}</small></span>
											<span>
												<strong>{s.name}</strong>
												{s.speaker && <> — {s.speaker}</>}
												{s.location && <span className="muted"> · {s.location}</span>}
											</span>
										</li>
									))}
								</ul>
							)}
							<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
								<button className="btn sm" onClick={() => onEdit(e.id)}>Edit</button>
								{e.status !== "draft" && (
									<a className="btn ghost sm" href={publicLink(e)} target="_blank" rel="noreferrer">Lihat publik</a>
								)}
								<a className="btn ghost sm" href={gcalUrl(e)} target="_blank" rel="noreferrer">📅 Google Calendar</a>
							</div>
						</div>
					);
				})
			)}
		</div>
	);
}

/**
 * Kalender bulanan lengkap + agenda hari terpilih.
 * Dipakai di /events/kalender (penuh) dan Ringkasan (compact).
 */
export default function Calendar({ events, onEdit, compact = false }) {
	const now = new Date();
	const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
	const [picked, setPicked] = useState(null);
	const [askNew, setAskNew] = useState(null);
	const navigate = useNavigate();

	const cells = useMemo(() => {
		const first = new Date(ym.y, ym.m, 1);
		const offset = (first.getDay() + 6) % 7; // Senin awal
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

	const monthEvents = useMemo(
		() => cells.filter((c) => !c.other).flatMap((c) => eventsOnDay(events, c.key)),
		[cells, events],
	);

	return (
		<div className={compact ? "cal cal-compact" : "cal"}>
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

			<div className={`cal-grid ${compact ? "cal-grid-compact" : ""}`}>
				{DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
				{cells.map((c) => {
					const dayEvents = eventsOnDay(events, c.key);
					return (
						<div
							key={c.key}
							className={`cal-cell ${c.other ? "other" : ""} ${c.key === todayKey ? "today" : ""} ${picked?.dayKey === c.key ? "picked" : ""}`}
							onClick={() => !c.other && setPicked({ dayKey: c.key, events: dayEvents })}
							role="button"
							tabIndex={c.other ? -1 : 0}
							aria-label={`Lihat event ${c.key}`}
							onKeyDown={(e) => e.key === "Enter" && !c.other && setPicked({ dayKey: c.key, events: dayEvents })}
						>
							<span className="d">{Number(c.key.slice(8))}</span>
							{dayEvents.slice(0, compact ? 2 : 4).map((e) => (
								<button
									key={e.id}
									className={`cal-chip ${displayStatus(e)}`}
									onClick={(ev) => { ev.stopPropagation(); setPicked({ dayKey: c.key, events: dayEvents }); }}
									title={e.title}
								>
									{e.title}
								</button>
							))}
							{dayEvents.length > (compact ? 2 : 4) && (
								<span className="cal-more muted">+{dayEvents.length - (compact ? 2 : 4)}</span>
							)}
							{/* mobile: dot pengganti chip */}
							{dayEvents.slice(0, 3).map((e) => <span key={e.id} className="dot" style={{ background: "var(--teal)" }} />)}
						</div>
					);
				})}
			</div>

			{/* Ringkasan bulan saat compact */}
			{compact && (
				<p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
					{monthEvents.length} event pada bulan ini · klik tanggal untuk detail · semua waktu WIB
				</p>
			)}
			{!compact && (
				<p className="muted small" style={{ marginTop: 10 }}>
					Klik tanggal untuk melihat event hari itu — atau klik tanggal kosong untuk membuat event baru dengan tanggal tersebut. Semua waktu WIB.
				</p>
			)}

			{picked && <DayAgenda dayKey={picked.dayKey} events={picked.events} onEdit={onEdit} onNew={setAskNew} />}

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
		</div>
	);
}
