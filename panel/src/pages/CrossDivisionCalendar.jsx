import { useEffect, useMemo, useState } from "react";
import { api, fmtRange } from "../api.js";
import { IconCalendar, IconCopy, IconShare, IconWhatsapp } from "../components/Icons.jsx";
import { useToast, ErrorState } from "../components/ui.jsx";
import { formatWhatsAppMessage, shareWhatsApp, getMonthLabel } from "../utils/share-whatsapp.js";

const MONTHS = [
	"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function ymd(y, m, d) {
	return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function getNowWib() {
	return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

export default function CrossDivisionCalendar() {
	const now = getNowWib();
	const [year, setYear] = useState(now.getFullYear());
	const [month, setMonth] = useState(now.getMonth() + 1);
	const [events, setEvents] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const toast = useToast();

	const monthParam = `${year}-${String(month).padStart(2, "0")}`;

	useEffect(() => {
		setLoading(true);
		setError("");
		api(`/admin/events/calendar?month=${monthParam}`)
			.then((d) => setEvents(d?.items || []))
			.catch((e) => setError(e?.message || "Gagal memuat kalender."))
			.finally(() => setLoading(false));
	}, [monthParam]);

	const message = useMemo(
		() => formatWhatsAppMessage(events, { monthLabel: getMonthLabel(year, month - 1) }),
		[events, year, month],
	);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(message);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
			toast("Pesan WhatsApp disalin ke clipboard");
		} catch {
			toast("Gagal menyalin pesan", "err");
		}
	};

	const handleShare = async () => {
		await shareWhatsApp(message);
	};

	const shiftMonth = (delta) => {
		let newMonth = month + delta;
		let newYear = year;
		if (newMonth > 12) {
			newMonth = 1;
			newYear += 1;
		} else if (newMonth < 1) {
			newMonth = 12;
			newYear -= 1;
		}
		setMonth(newMonth);
		setYear(newYear);
	};

	return (
		<div className="cross-calendar">
			<div className="cross-calendar-header">
				<h2 className="card-title">Kalender Lintas Divisi</h2>
				<p className="muted small">
					Menampilkan event yang sudah dipublikasikan dari semua divisi. Hanya bisa dilihat di dalam CMS Hub.
				</p>
			</div>

			<div className="cross-calendar-controls">
				<div className="cross-calendar-nav">
					<button className="btn ghost sm" onClick={() => shiftMonth(-1)} aria-label="Bulan sebelumnya">
						‹
					</button>
					<h3>{MONTHS[month - 1]} {year}</h3>
					<button className="btn ghost sm" onClick={() => shiftMonth(1)} aria-label="Bulan berikutnya">
						›
					</button>
				</div>
				<div className="cross-calendar-actions">
					<button className="btn sec sm" onClick={handleCopy} disabled={loading || !events.length}>
						<IconCopy size={14} /> {copied ? "Tersalin" : "Salin pesan WA"}
					</button>
					<button className="btn gold sm" onClick={handleShare} disabled={loading || !events.length}>
						<IconShare size={14} /> Share ke WhatsApp
					</button>
				</div>
			</div>

			{loading && <p className="muted">Memuat kalender…</p>}
			{error && <ErrorState message={error} onRetry={() => setLoading(true)} />}

			{!loading && !error && (
				<>
					{events.length === 0 ? (
						<div className="empty-state">
							<IconCalendar size={48} />
							<p>Belum ada event terpublikasih untuk {MONTHS[month - 1]} {year}.</p>
						</div>
					) : (
						<div className="cross-calendar-list">
							{events.map((ev) => (
								<div key={ev.id} className="cross-calendar-item">
									<div className="cross-calendar-meta">
										<span className="badge div">{ev.division_name || "Divisi"}</span>
									</div>
									<h4>{ev.title}</h4>
									<p className="muted small">{fmtRange(ev.starts_at, ev.ends_at)}</p>
									<p className="muted small">📍 {ev.location || "-"}</p>
									{ev.organizer && <p className="muted small">🤝 Penyelenggara: {ev.organizer}</p>}
									{ev.description && (
										<p className="muted small cross-calendar-desc">{ev.description}</p>
									)}
								</div>
							))}
						</div>
					)}

					{events.length > 0 && (
						<div className="cross-calendar-preview card">
							<div className="cross-calendar-preview-header">
								<h4>Preview Pesan WhatsApp</h4>
								<div className="cross-calendar-preview-actions">
									<button className="btn ghost sm" onClick={handleCopy}>
										<IconCopy size={14} /> {copied ? "Tersalin" : "Salin"}
									</button>
									<button className="btn gold sm" onClick={handleShare}>
										<IconWhatsapp size={14} /> Share
									</button>
								</div>
							</div>
							<pre className="cross-calendar-message">{message}</pre>
						</div>
					)}
				</>
			)}
		</div>
	);
}
