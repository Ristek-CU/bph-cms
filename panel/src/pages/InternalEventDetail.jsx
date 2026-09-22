import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, displayStatus, errText, fmtRange, fmtTime } from "../api.js";
import { Confirm, ErrorState, SkeletonCard, copyText, useToast } from "../components/ui.jsx";
import AuthImage from "../components/AuthImage.jsx";
import { IconCalendar, IconClock, IconExternalLink, IconLink, IconLock, IconMapPin, IconPencil, IconTicket, IconTrash, IconUsers } from "../components/Icons.jsx";
import { LABEL, internalCaps, internalGcalUrl, internalLink } from "../utils/internal-event.js";

// Halaman detail internal event. Phase 3 menambah thread diskusi + share
// WhatsApp di bawah runsheet.
export default function InternalEventDetail({ user, capabilities }) {
	const { id } = useParams();
	// Satu objek hasil fetch: tidak perlu setState sinkron di dalam effect (yang
	// memicu render bertingkat). Saat retry, data lama tetap tampil sampai respons
	// baru tiba — lebih tenang daripada berkedip jadi skeleton.
	const [data, setData] = useState({ event: null, loading: true, error: "" });
	const [busy, setBusy] = useState(false);
	const [askDelete, setAskDelete] = useState(false);
	const [askPublish, setAskPublish] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const navigate = useNavigate();
	const toast = useToast();
	const caps = internalCaps(user, capabilities);

	useEffect(() => {
		let cancelled = false;
		api(`/admin/internal-events/${id}`)
			.then((d) => { if (!cancelled) setData({ event: d, loading: false, error: "" }); })
			.catch((e) => { if (!cancelled) setData({ event: null, loading: false, error: errText(e) }); });
		return () => { cancelled = true; };
	}, [id, attempt]);

	const reload = useCallback(() => setAttempt((n) => n + 1), []);
	const event = data.event;

	if (data.loading) return <SkeletonCard lines={6} />;
	if (data.error) return <ErrorState title="Internal event tidak bisa dibuka" message={data.error} onRetry={reload} />;
	if (!event) return null;

	const st = displayStatus(event);
	const writable = caps.canEdit(event);

	const setStatus = async (next) => {
		if (busy) return;
		setBusy(true);
		setAskPublish(false);
		try {
			const updated = await api(`/admin/internal-events/${id}/${next}`, { method: "POST" });
			setData((d) => ({ ...d, event: updated }));
			toast(next === "publish"
				? "Internal event diterbitkan — terlihat semua pengurus SGA."
				: "Internal event ditarik — kembali jadi draft divisi kamu.");
		} catch (e) {
			toast(e?.message || "Gagal mengubah status.", "err");
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (busy) return;
		setBusy(true);
		setAskDelete(false);
		try {
			await api(`/admin/internal-events/${id}`, { method: "DELETE" });
			toast("Internal event dihapus permanen.");
			navigate("/internal-events");
		} catch (e) {
			toast(e?.message || "Gagal menghapus.", "err");
			setBusy(false);
		}
	};

	const copyPanelLink = () =>
		copyText(internalLink(event)).then(
			() => toast("Link panel disalin — hanya bisa dibuka pengurus yang login."),
			() => toast("Tidak bisa menyalin link.", "err"),
		);

	const sessions = [...(event.sessions || [])];

	return (
		<>
			<div className="internal-notice" role="note">
				<IconLock size={16} />
				<span>
					Internal event — tidak tampil di situs publik. {event.status === "published"
						? "Terlihat oleh semua pengurus SGA yang login."
						: "Masih draft: hanya terlihat oleh divisi kamu."}
				</span>
			</div>

			<div className="card internal-detail">
				{event.cover_image_url && (
					<AuthImage
						src={event.cover_image_url}
						alt={`Cover ${event.title}`}
						className="detail-cover"
						fallback={<div className="placeholder-cover">{(event.title || "?")[0]?.toUpperCase()}</div>}
					/>
				)}

				<div className="title-row">
					<div style={{ minWidth: 0 }}>
						<h2 style={{ margin: 0 }}>{event.title}</h2>
						<span className="slug muted small">/{event.slug}</span>
					</div>
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
						<span className="badge div">{event.division_name || "Divisi"}</span>
						<span className={`badge ${st}`}>{LABEL[st]}</span>
					</div>
				</div>

				<div className="p-meta">
					<span className="meta-item"><IconClock size={14} /> {fmtRange(event.starts_at, event.ends_at)}</span>
					<span className="meta-item">
						<IconMapPin size={14} /> {event.location}
						{event.location_url && (
							<a href={event.location_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6 }}>
								<IconExternalLink size={12} /> Peta
							</a>
						)}
					</span>
					{event.organizer && <span className="meta-item"><IconUsers size={14} /> {event.organizer}</span>}
					{event.registration_url && (
						<span className="meta-item">
							<IconTicket size={14} />
							<a href={event.registration_url} target="_blank" rel="noreferrer">
								Pendaftaran {event.registration_open ? "terbuka" : "ditutup"}
							</a>
						</span>
					)}
				</div>

				{event.description && (
					<p style={{ whiteSpace: "pre-wrap" }}>{event.description}</p>
				)}

				<h3 className="card-title" style={{ marginTop: 18 }}>Runsheet ({sessions.length} sesi)</h3>
				{sessions.length === 0 ? (
					<p className="muted" style={{ marginBottom: 0 }}>Belum ada sesi. {writable && "Bisa ditambahkan lewat Edit."}</p>
				) : (
					<ul className="timeline">
						{sessions.map((s) => (
							<li key={s.id}>
								<span className="t">
									{fmtTime(s.starts_at)}
									<small>–{fmtTime(s.ends_at)}</small>
								</span>
								<span>
									<strong>{s.name}</strong>
									{s.speaker && <> — {s.speaker}</>}
									{s.location && <span className="muted"> · {s.location}</span>}
									{s.description && <span className="muted small" style={{ display: "block", whiteSpace: "pre-wrap" }}>{s.description}</span>}
								</span>
							</li>
						))}
					</ul>
				)}

				<div className="row-actions" style={{ marginTop: 18, flexWrap: "wrap" }}>
					<button className="btn ghost sm" onClick={copyPanelLink}><IconLink size={14} /> Salin link panel</button>
					<a className="btn ghost sm" href={internalGcalUrl(event)} target="_blank" rel="noreferrer">
						<IconCalendar size={14} /> Google Calendar
					</a>
					{writable && (
						<Link className="btn sm" to={`/internal-events/${id}/edit`}><IconPencil size={14} /> Edit</Link>
					)}
					{caps.canPublish(event) && (
						event.status === "published" ? (
							<button className="btn sec sm" disabled={busy} onClick={() => setStatus("unpublish")}>Tarik ke draft</button>
						) : (
							<button className="btn gold sm" disabled={busy} onClick={() => setAskPublish(true)}>Terbitkan internal</button>
						)
					)}
					{caps.canDelete(event) && (
						<button className="btn danger sm" disabled={busy} onClick={() => setAskDelete(true)}>
							<IconTrash size={14} /> Hapus
						</button>
					)}
				</div>
			</div>

			<Confirm
				open={askPublish}
				title="Terbitkan internal event?"
				confirmLabel="Ya, terbitkan"
				onCancel={() => setAskPublish(false)}
				onConfirm={() => setStatus("publish")}
			>
				Internal event akan terlihat oleh semua pengurus SGA yang login, dari divisi mana pun.
				Tetap tidak muncul di situs publik.
			</Confirm>

			<Confirm
				open={askDelete}
				title="Hapus permanen?"
				confirmLabel="Ya, hapus permanen"
				danger
				onCancel={() => setAskDelete(false)}
				onConfirm={remove}
			>
				Internal event "{event.title}" beserta semua sesi runsheet akan dihapus selamanya. Tidak bisa dibatalkan.
			</Confirm>
		</>
	);
}
