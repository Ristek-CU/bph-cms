import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtRange } from "../api.js";
import { IconCalendar, IconCopy, IconLock, IconShare, IconWhatsapp } from "../components/Icons.jsx";
import { useToast, ErrorState } from "../components/ui.jsx";
import { formatEventMessage, shareWhatsApp, WA_MODES } from "../utils/share-whatsapp.js";

const MONTHS = [
	"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

function getNowWib() {
	return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
}

// Kalender Lintas Divisi = agenda INTERNAL semua divisi (K-9).
//
// Dulunya halaman ini membaca /admin/events/calendar, yaitu student event publik.
// Sekarang /admin/internal-events/calendar. Konsekuensi yang diterima sadar:
// division_admin tidak lagi punya tampilan lintas divisi untuk event publik —
// satu-satunya yang tersisa adalah /events, yang bagi platform_admin memang
// sudah menampilkan semua divisi.
export default function CrossDivisionCalendar() {
	const now = getNowWib();
	const [year, setYear] = useState(now.getFullYear());
	const [month, setMonth] = useState(now.getMonth() + 1);
	const [events, setEvents] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const [attempt, setAttempt] = useState(0);
	// Event yang pesannya dibuka di preview; null = belum ada preview.
	const [previewId, setPreviewId] = useState(null);
	const [mode, setMode] = useState("formal");
	const toast = useToast();

	const monthParam = `${year}-${String(month).padStart(2, "0")}`;

	useEffect(() => {
		setLoading(true);
		setError("");
		api(`/admin/internal-events/calendar?month=${monthParam}`)
			.then((d) => {
				const items = d?.items || [];
				setEvents(items);
				// Bulan berganti → pilihan lama mungkin tidak ada lagi. Reset.
				setPreviewId((prev) => (prev && items.some((e) => e.id === prev) ? prev : null));
			})
			.catch((e) => setError(e?.message || "Gagal memuat kalender."))
			.finally(() => setLoading(false));
	}, [monthParam, attempt]);

	const previewEvent = useMemo(
		() => events.find((e) => e.id === previewId) || null,
		[events, previewId],
	);
	const message = useMemo(() => formatEventMessage(previewEvent, mode), [previewEvent, mode]);

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
			<div className="internal-notice" role="note">
				<IconLock size={16} />
				<span>
					Agenda internal organisasi dari semua divisi. Tidak pernah tampil di situs
					publik — hanya pengurus SGA yang login yang bisa melihat.
				</span>
			</div>

			<div className="cross-calendar-header">
				<h2 className="card-title">Kalender Lintas Divisi</h2>
				<p className="muted small">
					Agenda internal yang sudah diterbitkan, dari semua divisi. Draft hanya
					terlihat oleh divisi pemiliknya.
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
			</div>

			{loading && <p className="muted">Memuat kalender…</p>}
			{error && <ErrorState message={error} onRetry={() => setAttempt((n) => n + 1)} />}

			{!loading && !error && (
				<>
					{events.length === 0 ? (
						<div className="empty-state">
							<IconCalendar size={48} />
							<p>Belum ada agenda internal untuk {MONTHS[month - 1]} {year}.</p>
							<Link className="btn sec" to="/internal-events/baru">Buat internal event</Link>
						</div>
					) : (
						<div className="cross-calendar-list">
							{events.map((ev) => (
								<div key={ev.id} className={`cross-calendar-item${previewId === ev.id ? " selected" : ""}`}>
									<div className="cross-calendar-meta">
										<span className="badge div">{ev.division_name || "Divisi"}</span>
									</div>
									<h4>{ev.title}</h4>
									<p className="muted small">{fmtRange(ev.starts_at, ev.ends_at)}</p>
									<p className="muted small">📍 {ev.location || "-"}</p>
									<div className="cross-calendar-item-actions">
										<button
											className={`btn ${previewId === ev.id ? "sec" : "ghost"} sm`}
											onClick={() => setPreviewId(previewId === ev.id ? null : ev.id)}
											aria-pressed={previewId === ev.id}
										>
											<IconWhatsapp size={14} /> {previewId === ev.id ? "Tutup pesan" : "Buat pesan WA"}
										</button>
										<Link className="btn ghost sm" to={`/internal-events/${ev.id}`}>Lihat detail</Link>
									</div>

									{previewId === ev.id && (
										<div className="cross-calendar-preview">
											<div className="cross-calendar-preview-header">
												<div className="wa-modes" role="radiogroup" aria-label="Gaya pesan">
													{WA_MODES.map((m) => (
														<button
															key={m.key}
															className={`chip ${mode === m.key ? "active" : ""}`}
															aria-pressed={mode === m.key}
															onClick={() => setMode(m.key)}
														>
															{m.label}
														</button>
													))}
												</div>
												<div className="cross-calendar-preview-actions">
													<button className="btn ghost sm" onClick={handleCopy}>
														<IconCopy size={14} /> {copied ? "Tersalin" : "Salin"}
													</button>
													<button className="btn gold sm" onClick={handleShare}>
														<IconShare size={14} /> Share
													</button>
												</div>
											</div>
											<pre className="cross-calendar-message">{message}</pre>
										</div>
									)}
								</div>
							))}
						</div>
					)}
				</>
			)}
		</div>
	);
}
