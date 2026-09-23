import { fmtRange } from "../api.js";

/**
 * Format SATU internal event menjadi pesan WhatsApp, dalam salah satu gaya:
 *   - formal  : baku, cocok untuk pengumuman resmi / perintah kehadiran
 *   - santai  : casual untuk grup chat sehari-hari
 *   - ringkas : tiga baris, untuk sekadar mengingatkan
 *
 * events: satu objek dari /admin/internal-events/calendar (published).
 */
export function formatEventMessage(ev, mode = "formal") {
	if (!ev) return "Belum ada agenda yang dipilih.";

	const time = fmtRange(ev.starts_at, ev.ends_at);
	const division = ev.division_name || "-";
	const location = ev.location || "-";

	if (mode === "ringkas") {
		return [
			`📅 *${ev.title}*`,
			`🗓️ ${time} (WIB)`,
			`📍 ${location} · 🏢 ${division}`,
		].join("\n");
	}

	if (mode === "santai") {
		const lines = [
			"Halo tim! 👋",
			"",
			`Ada agenda bareng *${ev.title}* nih:`,
			`🗓️ ${time} (WIB)`,
			`🏢 Divisi ${division}`,
			`📍 ${location}`,
		];
		if (ev.organizer) lines.push(`🤝 Diselenggarakan sama: ${ev.organizer}`);
		if (ev.description) lines.push(`📝 ${ev.description.replace(/\n/g, " ")}`);
		if (ev.registration_url) lines.push(`🔗 ${ev.registration_url}`);
		lines.push("", "Ditunggu ya, jangan sampai kelewat! 😄");
		return lines.join("\n");
	}

	// formal
	const lines = [
		`📅 *${ev.title}*`,
		"",
		`🗓️ Waktu : ${time} (WIB)`,
		`🏢 Divisi : ${division}`,
		`📍 Lokasi : ${location}`,
	];
	if (ev.organizer) lines.push(`🤝 Penyelenggara : ${ev.organizer}`);
	if (ev.description) lines.push(`📝 Keterangan : ${ev.description.replace(/\n/g, " ")}`);
	if (ev.registration_url) lines.push(`🔗 Pendaftaran : ${ev.registration_url}`);
	lines.push(
		"",
		`Mohon jadwal ini dicatat dan diprioritaskan. Pesan ini khusus pengurus SGA Cakrawala — mohon tidak diteruskan ke luar kepengurusan. Terima kasih. 🙏`,
	);
	return lines.join("\n");
}

export const WA_MODES = [
	{ key: "formal", label: "Formal" },
	{ key: "santai", label: "Santai" },
	{ key: "ringkas", label: "Ringkas" },
];

/**
 * Buka share native (jika tersedia) atau fallback ke clipboard.
 */
export async function shareWhatsApp(text) {
	const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
	if (navigator.share) {
		try {
			await navigator.share({ title: "Agenda Internal SGA", text });
			return;
		} catch (e) {
			if (e.name === "AbortError") return;
		}
	}
	if (navigator.clipboard) {
		await navigator.clipboard.writeText(text);
	} else {
		window.open(url, "_blank");
	}
}
