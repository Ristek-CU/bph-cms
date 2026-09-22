import { isoToInput } from "../api.js";

// Helper murni editor event — dipakai bersama oleh EventEditor (student event)
// dan InternalEventEditor (D-AK). Dipisah dari components/event-form.jsx karena
// oxlint(react/only-export-components): satu file yang mencampur komponen dan
// fungsi mematikan Fast Refresh.
//
// Hanya kode yang tidak tahu soal endpoint yang boleh masuk sini. Logika simpan,
// publish, dan permission tetap di masing-masing editor.

let sessSeq = 0;

export const newSession = (after) => {
	// Default: tanggal + jam terakhir dari sesi sebelumnya, durasi 1 jam — runsheet nyambung.
	const date = after?._date || "";
	const start = after?._end || "08:00";
	const [h, m] = start.split(":").map(Number);
	const end = `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
	return {
		_key: `s${++sessSeq}`,
		name: "",
		_date: date,
		_start: start,
		_end: end,
		speaker: "",
		location: "",
		description: "",
	};
};

// State jam sesi disimpan sebagai bagian: _date (YYYY-MM-DD), _start/_end (HH:MM).
export const splitDT = (dt) => ({ _date: dt?.slice(0, 10) || "", _start: dt?.slice(11, 16) || "" });

export const joinDT = (date, time, nextDay) => {
	if (!date || !time) return "";
	if (!nextDay) return `${date}T${time}`;
	// Tanggal WIB di-increment langsung (Date lokal menangani rollover bulan/tahun).
	// Jangan manipulasi getUTCDate — untuk jam 00:00-06:59 WIB, UTC date sudah
	// mundur sehari, +1 menghasilkan tanggal yang salah (bug sesi lewat tengah malam).
	const [y, m, d] = date.split("-").map(Number);
	const next = new Date(y, m - 1, d + 1);
	const p2 = (n) => String(n).padStart(2, "0");
	return `${next.getFullYear()}-${p2(next.getMonth() + 1)}-${p2(next.getDate())}T${time}`;
};

export const withKeys = (arr) =>
	arr.map((s) => ({
		...s,
		_key: `s${++sessSeq}`,
		...splitDT(isoToInput(s.starts_at)),
		_end: isoToInput(s.ends_at).slice(11, 16),
	}));

export const hasSessionDraft = (s) =>
	Boolean(s.name.trim() || s._date || s.speaker || s.location || s.description);

// Terjemahan error 422 server ke Bahasa Indonesia (fallback: pesan asli).
const ERR_MAP = [
	[/^title/, "Nama event wajib diisi."],
	[/^starts_at/, "Jam mulai tidak valid."],
	[/^ends_at.*after|^ends_at$/, "Jam selesai harus setelah jam mulai."],
	[/^location$/, "Lokasi wajib diisi."],
	[/^location_url|^registration_url|^cover_image_url/, "Link tidak valid — pastikan diawali https://"],
	[/^sessions\.\d+\.starts_at$/, "Jam mulai sesi belum diisi."],
	[/^sessions\.\d+\.ends_at$/, "Jam selesai sesi belum diisi atau tidak valid."],
	[/^sessions$/, "Ada sesi dengan jam belum lengkap. Isi jam mulai & selesai tiap sesi."],
	[/^sessions\.(\d+)/, "Ada sesi dengan jam di luar jam event. Perbaiki jam sesi atau perpanjang jam event."],
	[/^slug/, "Alamat link sudah dipakai atau tidak valid. Gunakan huruf kecil dan tanda hubung."],
];

export const translateErrors = (errors) => {
	const out = {};
	for (const [f, msgs] of Object.entries(errors || {})) {
		const hit = ERR_MAP.find(([re]) => re.test(f));
		out[f] = hit ? hit[1] : msgs.join(", ");
	}
	return out;
};
