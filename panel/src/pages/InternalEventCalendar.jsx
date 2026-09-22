import { useNavigate } from "react-router-dom";
import Calendar from "../components/Calendar.jsx";
import { ErrorState, SkeletonCard } from "../components/ui.jsx";
import { IconLock } from "../components/Icons.jsx";
import { internalCalendarLinks, internalCaps, useInternalEvents } from "../utils/internal-event.js";

// Kalender internal event — komponen Calendar yang sama dengan student event,
// hanya konfigurasi tautannya yang berbeda (lihat utils/internal-event.js):
// buat di /internal-events/baru, tanpa tombol "Lihat publik", dan Google
// Calendar menunjuk ke panel, bukan ke situs mahasiswa.
export default function InternalEventCalendar({ user, capabilities }) {
	const { events, loading, error, reload } = useInternalEvents();
	const navigate = useNavigate();
	const caps = internalCaps(user, capabilities);

	if (error) return <ErrorState title="Kalender internal belum bisa dimuat" message={error} onRetry={reload} />;
	if (loading) return <SkeletonCard lines={6} />;

	return (
		<>
			<div className="internal-notice" role="note">
				<IconLock size={16} />
				<span>
					Agenda internal semua divisi. Draft hanya terlihat oleh divisi pemiliknya.
				</span>
			</div>
			<Calendar
				events={events}
				onEdit={(id) => navigate(`/internal-events/${id}/edit`)}
				capabilities={{ canCreateEvent: caps.canCreate, canEditEvent: caps.canEdit }}
				ownDivisionId={user?.division?.id || null}
				links={internalCalendarLinks(caps)}
			/>
		</>
	);
}
