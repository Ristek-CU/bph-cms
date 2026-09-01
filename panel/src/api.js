const TOKEN_KEY = "bph_cms_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export class ApiFail extends Error {
	constructor(body, status) {
		super(body?.message || "Error");
		this.statusCode = body?.statusCode ?? status;
		this.errors = body?.errors;
	}
}

export async function api(path, { method = "GET", json } = {}) {
	const opts = { method, headers: { Authorization: `Bearer ${getToken()}` } };
	if (json !== undefined) {
		opts.headers["Content-Type"] = "application/json";
		opts.body = JSON.stringify(json);
	}
	const res = await fetch(`/api/v1${path}`, opts);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) throw new ApiFail(body, res.status);
	return body.data;
}

// Login lewat proxy /auth/sign-in (binding AUTH_SERVICE).
export async function signIn(email, password) {
	const res = await fetch("/api/v1/auth/sign-in", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	const b = await res.json().catch(() => ({}));
	if (!res.ok || b.success === false) throw new ApiFail(b, res.status);
	return b.data; // { token, user }
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
	let msg = e?.message || "Error";
	if (e?.errors) {
		msg +=
			"\n" +
			Object.entries(e.errors)
				.map(([f, msgs]) => `${f}: ${msgs.join(", ")}`)
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
export function gcalUrl(ev) {
	const fmt = (iso) =>
		new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
	const params = new URLSearchParams({
		action: "TEMPLATE",
		text: ev.title,
		dates: `${fmt(ev.starts_at)}/${fmt(ev.ends_at)}`,
		details: (ev.description || "").slice(0, 500) +
			`\n\nDetail: https://sga-cakrawala.org/events/${ev.slug}`,
		location: ev.location || "",
	});
	return `https://calendar.google.com/calendar/render?${params}`;
}

export const publicLink = (ev) => `https://sga-cakrawala.org/events/${ev.slug}`;
