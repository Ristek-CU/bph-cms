import { fmtRange } from "../api.js";

/**
 * Format agenda internal lintas divisi menjadi pesan WhatsApp yang casual-formal.
 * events: array dari /admin/internal-events/calendar (internal event published,
 * semua divisi).
 *
 * Kata "internal" sengaja disebut eksplisit di header dan intro: pesan ini
 * disebar ke grup WhatsApp, dan penerimanya harus tahu ini agenda kepengurusan —
 * bukan kegiatan untuk mahasiswa umum.
 */
export function formatWhatsAppMessage(events, { monthLabel } = {}) {
	if (!events?.length) {
		return "Belum ada agenda internal untuk periode ini.";
	}

	// Urutkan berdasarkan waktu mulai.
	const sorted = [...events].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

	const header = monthLabel
		? `📅 Jadwal Internal Lintas Divisi SGA Cakrawala — ${monthLabel}`
		: "📅 Jadwal Internal Lintas Divisi SGA Cakrawala";

	const intro = "Halo, teman-teman pengurus! 👋\nBerikut agenda internal lintas divisi yang sudah disusun. Khusus kepengurusan, bukan untuk disebar ke mahasiswa umum. Semoga membantu kita koordinasi dan merencanakan aktivitas masing-masing.";

	const body = sorted
		.map((ev, index) => {
			const timeRange = fmtRange(ev.starts_at, ev.ends_at);
			const lines = [
				`${index + 1}. *${ev.title}*`,
				`   🗓️ Waktu: ${timeRange}`,
				`   🏢 Divisi: ${ev.division_name || "-"}`,
				`   📍 Lokasi: ${ev.location || "-"}`,
			];
			if (ev.organizer) {
				lines.push(`   🤝 Penyelenggara: ${ev.organizer}`);
			}
			if (ev.description) {
				lines.push(`   📝 Deskripsi: ${ev.description.replace(/\n/g, " ")}`);
			}
			if (ev.registration_url) {
				lines.push(`   🔗 Link pendaftaran: ${ev.registration_url}`);
			}
			return lines.join("\n");
		})
		.join("\n\n");

	const outro = "Semoga jadwalnya bermanfaat dan tidak ada yang bertabrakan ya. Jika ada perubahan, akan kami update lagi. Terima kasih! 🙏";

	return [header, "", intro, "", body, "", outro].join("\n");
}

/**
 * Buka share native (jika tersedia) atau fallback ke clipboard.
 */
export async function shareWhatsApp(text) {
	const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
	if (navigator.share) {
		try {
			await navigator.share({ title: "Jadwal Internal Lintas Divisi", text });
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

export function getMonthLabel(y, m) {
	const MONTHS = [
		"Januari", "Februari", "Maret", "April", "Mei", "Juni",
		"Juli", "Agustus", "September", "Oktober", "November", "Desember",
	];
	return `${MONTHS[m]} ${y}`;
}
