import { useEffect, useMemo, useState } from "react";
import { api, errText, gcalUrl } from "../api.js";

// Helper internal event (D-AK). Dipisah dari komponen karena oxlint
// react/only-export-components: file yang mencampur komponen dan fungsi
// mematikan Fast Refresh.

export const LABEL = {
	draft: "Draft",
	ongoing: "Terbit — Berlangsung",
	upcoming: "Terbit — Akan Datang",
	past: "Terbit — Selesai",
};

/**
 * Ambil daftar internal event.
 *
 * State lama tetap ditampilkan sampai respons baru tiba (tidak ada setState
 * sinkron di dalam effect) — jadi `reload()` tidak membuat halaman berkedip
 * jadi skeleton.
 */
export function useInternalEvents() {
	const [state, setState] = useState({ events: [], loading: true, error: "" });
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		let cancelled = false;
		api("/admin/internal-events")
			.then((d) => {
				if (!cancelled) setState({ events: d?.items || [], loading: false, error: "" });
			})
			.catch((e) => {
				if (!cancelled) setState({ events: [], loading: false, error: errText(e) });
			});
		return () => {
			cancelled = true;
		};
	}, [nonce]);

	const reload = useMemo(() => () => setNonce((n) => n + 1), []);
	return { ...state, reload };
}

/**
 * Link ke halaman detail di dalam panel (hash routing).
 *
 * Internal event TIDAK punya halaman publik, jadi publicLink() tidak berlaku di
 * sini — memakai itu akan mengirim pengurus ke halaman 404 di situs mahasiswa.
 */
export const internalLink = (ev) =>
	`${window.location.origin}${window.location.pathname}#/internal-events/${ev.id}`;

export const internalGcalUrl = (ev) => gcalUrl(ev, internalLink(ev));

// Konfigurasi tautan untuk components/Calendar.jsx supaya kalender internal
// tidak menawarkan "Lihat publik" dan tidak menaruh link situs mahasiswa di
// Google Calendar. Dibentuk sebagai fungsi karena canWrite butuh user.
export const internalCalendarLinks = (caps) => ({
	newPath: "/internal-events/baru",
	gcalHref: internalGcalUrl,
	publicHref: null,
	detailHref: (ev) => `/internal-events/${ev.id}`,
	canWrite: caps.canWrite,
});

const owns = (ev, user) => {
	const permissions = user?.permissions || [];
	// platform_admin punya scope .all — boleh menulis di divisi mana pun.
	if (permissions.includes("events.update.all")) return true;
	return Boolean(ev && user?.division?.id && ev.division_id === user.division.id);
};

/**
 * K-2: semua pengurus boleh MEMBACA internal event divisi mana pun, tetapi
 * hanya divisi pemilik (atau platform_admin) yang boleh menulis.
 *
 * Dibungkus di atas `capabilities` dari App.jsx supaya keputusan role tetap di
 * satu tempat; di sini hanya ditambah syarat kepemilikan divisi.
 */
export const internalCaps = (user, capabilities) => ({
	canCreate: Boolean(capabilities?.canCreateEvent),
	canEdit: (ev) => Boolean(capabilities?.canEditEvent?.(ev)) && owns(ev, user),
	canPublish: (ev) => Boolean(capabilities?.canPublishEvent) && owns(ev, user),
	canDelete: (ev) => Boolean(capabilities?.canDeleteEvent) && owns(ev, user),
	// Dipakai Calendar.jsx: menggantikan tebakan "divisi berbeda = bukan milikku"
	// yang salah untuk platform_admin.
	canWrite: (ev) => owns(ev, user),
});
