const TOKEN_KEY = "bph_cms_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiFail extends Error {
	constructor(body, status) {
		super(body?.message || ({ 401: "Email atau password tidak sesuai. Silakan coba lagi.", 403: "Akun ini belum memiliki izin untuk tindakan tersebut.", 404: "Data tidak ditemukan.", 429: "Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi." }[status]) || "Layanan sedang bermasalah. Silakan coba lagi.");
		this.statusCode = body?.statusCode ?? status;
		this.errors = body?.errors;
	}
}

export async function api(path, { method = "GET", json, signal } = {}) {
	const requestToken = getToken();
	const opts = { method, signal, headers: { Authorization: `Bearer ${requestToken}` } };
	if (json !== undefined) {
		opts.headers["Content-Type"] = "application/json";
		opts.body = JSON.stringify(json);
	}
	const res = await request(`/api/v1${path}`, opts);
	const body = await res.json().catch(() => ({}));
	if (res.status === 401 && requestToken && requestToken === getToken()) {
		// Token kedaluarsa/dicabut — pusatkan penanganan: bersihkan token lalu
		// beri tahu App (listener "bph:unauthorized") supaya reset state + ke login.
		clearToken();
		window.dispatchEvent(new Event("bph:unauthorized"));
	}
	if (!res.ok || body.success === false) throw new ApiFail(body, res.status);
	return body.data;
}

// Login lewat proxy /auth/sign-in (binding AUTH_SERVICE).
export async function signIn(email, password) {
	const res = await request("/api/v1/auth/sign-in", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	const b = await res.json().catch(() => ({}));
	if (!res.ok || b.success === false) throw new ApiFail(b, res.status);
	if (!b.data?.token) throw new Error("Login belum berhasil. Silakan coba lagi.");
	return b.data; // { token, user }
}

// Minta kode handoff sekali pakai untuk pindah ke dashboard eksternal.
// Backend membalas { redirect_to } = <workspace.url>/sso?code=<kode>.
export async function requestWorkspaceHandoff(workspaceOptionId) {
	return api("/admin/workspace-handoff", {
		method: "POST",
		json: { workspace_option_id: workspaceOptionId },
	});
}

// datetime-local value -> ISO 8601 WIB
export const toIsoWib = (v) => (v ? `${v}:00+07:00` : "");

// ISO 8601 -> value utk <input type=datetime-local>, ditampilkan dalam WIB
export function isoToInput(iso) {
	if (!iso) return "";
	const wib = new Date(new Date(iso).getTime() + 7 * 3600000);
	return wib.toISOString().slice(0, 16);
}

export function errText(e) {
	let msg = e?.message || "Terjadi kesalahan. Silakan coba lagi.";
	if (e?.errors) {
		msg +=
			"\n" +
			Object.entries(e.errors)
				.map(([f, msgs]) => `${f}: ${Array.isArray(msgs) ? msgs.join(", ") : String(msgs)}`)
				.join("\n");
	}
	return msg;
}

// ---- Format tanggal/waktu WIB untuk tampilan ----

const DAYS = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS = [
	"Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
	"Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];
const MONTHS_FULL = [
	"Januari", "Februari", "Maret", "April", "Mei", "Juni",
	"Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// ISO -> Date yang di-shift supaya getUTC* mengembalikan angka WIB.
const asWib = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000);
const p2 = (n) => String(n).padStart(2, "0");

export function fmtTime(iso) {
	const d = asWib(iso);
	return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

export function fmtDate(iso) {
	const d = asWib(iso);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateLong(iso) {
	const d = asWib(iso);
	return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_FULL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// Rentang ringkas: "10–11 Sep 2026 · 08:00–17:00 WIB" (sehari) atau
// "10 Sep, 08:00 – 11 Sep, 17:00 WIB" (multi-hari).
export function fmtRange(startIso, endIso) {
	const s = asWib(startIso);
	const e = asWib(endIso);
	const sameDay =
		s.getUTCFullYear() === e.getUTCFullYear() &&
		s.getUTCMonth() === e.getUTCMonth() &&
		s.getUTCDate() === e.getUTCDate();
	if (sameDay)
		return `${fmtDate(startIso)} · ${fmtTime(startIso)}–${fmtTime(endIso)} WIB`;
	return `${fmtDate(startIso)}, ${fmtTime(startIso)} – ${fmtDate(endIso)}, ${fmtTime(endIso)} WIB`;
}

// Status tampilan: draft dipisah; event terbit dihitung dari waktu (server-style).
export function displayStatus(ev) {
	if (ev.status === "draft") return "draft";
	const now = Date.now();
	if (now < new Date(ev.starts_at)) return "upcoming";
	if (now > new Date(ev.ends_at)) return "past";
	return "ongoing";
}

// Tombol "Tambah ke Google Calendar" (template URL resmi, tanpa backend).
// detailUrl bisa diganti: internal event tidak punya halaman publik, jadi ia
// menunjuk ke panel (lihat utils/internal-event.js).
export function gcalUrl(ev, detailUrl = publicLink(ev)) {
	const fmt = (iso) =>
		new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const params = new URLSearchParams({
		action: "TEMPLATE",
		text: ev.title,
		dates: `${fmt(ev.starts_at)}/${fmt(ev.ends_at)}`,
		details: (ev.description || "").slice(0, 500) +
			(detailUrl ? `\n\nDetail: ${detailUrl}` : ""),
		location: ev.location || "",
	});
	return `https://calendar.google.com/calendar/render?${params}`;
}

export const publicLink = (ev) => `https://sga-cakrawala.org/events/${ev.slug}`;

async function request(url, options) {
	try {
		return await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30000) });
	} catch (error) {
		if (error.name === "AbortError") throw error;
		throw new Error(error.name === "TimeoutError"
			? "Permintaan terlalu lama. Coba lagi; periksa data sebelum mengulangi penyimpanan."
			: "Tidak dapat terhubung. Periksa koneksi internet lalu coba lagi.");
	}
}
