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

export async function api(path, { method = "GET", json, form } = {}) {
	const opts = { method, headers: { Authorization: `Bearer ${getToken()}` } };
	if (json !== undefined) {
		opts.headers["Content-Type"] = "application/json";
		opts.body = JSON.stringify(json);
	} else if (opts.body) {
		// multipart: caller set body sendiri
	}
	const res = await fetch(`/api/v1${path}`, opts);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || body.success === false) throw body;
	return body.data;
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
