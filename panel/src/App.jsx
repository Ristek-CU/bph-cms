import { useCallback, useEffect, useState } from "react";
import { api, getToken, toIsoWib, isoToInput } from "./api.js";

const TOKEN_KEY = "bph_cms_token";

function errText(e) {
	let msg = e?.message || "Error";
	if (e?.errors) {
		msg +=
			"\n" +
			Object.entries(e.errors)
				.map(([f, m]) => `${f}: ${m.join(", ")}`)
				.join("\n");
	}
	return msg;
}

async function signIn(email, password) {
	const res = await fetch("/api/v1/auth/sign-in", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	const b = await res.json();
	if (!res.ok || b.success === false) throw b;
	return b.data.token;
}

let sessSeq = 0;
const blankSession = () => ({
	_key: `s${++sessSeq}`,
	name: "",
	_start: "",
	_end: "",
	speaker: "",
	location: "",
	description: "",
});
const withKeys = (arr) => arr.map((s) => ({ ...s, _key: `s${++sessSeq}` }));

// ---------- Login ----------
function Login({ onLogin }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [err, setErr] = useState("");

	const submit = async (e) => {
		e?.preventDefault?.();
		setErr("");
		try {
			onLogin(await signIn(email.trim(), password));
		} catch (e2) {
			setErr(errText(e2));
		}
	};

	return (
		<div className="card" style={{ maxWidth: 380, margin: "60px auto" }}>
			<h2 style={{ fontSize: 16 }}>Login admin BPH</h2>
			<form onSubmit={(e) => { e.preventDefault(); submit(); }}>
				<label>Email</label>
				<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
				<label>Password</label>
				<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
				{err && <div className="err">{err}</div>}
				<p><button style={{ width: "100%" }}>Masuk</button></p>
			</form>
		</div>
	);
}

// ---------- Session row ----------
function SessionRow({ s, i, onChange, onRemove }) {
	const set = (k) => (e) => onChange(i, { [k]: e.target.value });
	return (
		<div className="sess">
			<input placeholder="Nama sesi *" value={s.name} onChange={set("name")} />
			<div className="row">
				<div>
					<span className="muted">Mulai (WIB)</span>
					<input type="datetime-local" value={s._start} onChange={set("_start")} />
				</div>
				<div><span className="muted">Selesai (WIB)</span><input type="datetime-local" value={s._end} onChange={set("_end")} /></div>
			</div>
			<div className="row">
				<div><input placeholder="Pemateri" value={s.speaker || ""} onChange={set("speaker")} /></div>
				<div><input placeholder="Ruang" value={s.location || ""} onChange={set("location")} /></div>
			</div>
			<button className="sec" onClick={onRemove}>Hapus sesi</button>
		</div>
	);
}

// ---------- Event form ----------
function EventForm({ event, onClose, onSaved, onDeleted }) {
	const editing = !!event;
	const [form, setForm] = useState({
		title: event?.title || "",
		slug: event?.slug || "",
		description: event?.description || "",
		starts_at: isoToInput(event?.starts_at),
		ends_at: isoToInput(event?.ends_at),
		location: event?.location || "",
		location_url: event?.location_url || "",
		registration_url: event?.registration_url || "",
		organizer: event?.organizer || "",
		registration_open: event ? event.registration_open !== false : true,
	});
	const [sessions, setSessions] = useState(
		withKeys((event?.sessions || []).map((s) => ({ ...s, _start: isoToInput(s.starts_at), _end: isoToInput(s.ends_at) }))),
	);
	const [cover, setCover] = useState(event?.cover_image_url || null);
	const [err, setErr] = useState("");
	const [saving, setSaving] = useState(false);

	const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
	const setSess = (i, patch) => setSessions(sessions.map((s, j) => (i === j ? { ...s, ...patch } : s)));
	const addSession = () =>
		setSessions([...sessions, { name: "", _start: "", _end: "", speaker: "", location: "", description: "" }]);
	const rmSession = (i) => setSessions(sessions.filter((_, j) => j !== i));

	async function upload(file) {
		const fd = new FormData();
		fd.append("file", file);
		const res = await fetch("/api/v1/admin/media", {
			method: "POST",
			headers: { Authorization: `Bearer ${getToken()}` },
			body: fd,
		});
		const b = await res.json();
		if (!res.ok || b.success === false) throw b;
		setCover(b.data.url);
	}

	async function save() {
		setErr("");
		setSaving(true);
		const payload = {
			title: form.title.trim(),
			starts_at: toIsoWib(form.starts_at),
			ends_at: toIsoWib(form.ends_at),
			location: form.location.trim(),
			description: form.description || null,
			location_url: form.location_url || null,
			registration_url: form.registration_url || null,
			registration_open: form.registration_open,
			organizer: form.organizer.trim() || null,
			cover_image_url: cover,
			sessions: sessions.map((s) => ({
				name: s.name.trim(),
				starts_at: toIsoWib(s._start),
				ends_at: toIsoWib(s._end),
				speaker: s.speaker || null,
				location: s.location || null,
				description: s.description || null,
			})),
		};
		if (!editing) payload.slug = form.slug.trim() || undefined;
		try {
			if (editing) await api(`/admin/events/${event.id}`, { method: "PUT", json: payload });
			else await api("/admin/events", { method: "POST", json: payload });
			onSaved();
		} catch (e) {
			setErr(errText(e));
			setSaving(false);
		}
	}

	async function del() {
		if (!confirm("Hapus event ini permanen beserta semua sesi?")) return;
		try {
			await api(`/admin/events/${event.id}`, { method: "DELETE" });
			onDeleted();
		} catch (e) {
			setErr(errText(e));
		}
	}

	return (
		<div className="card">
			<h2 style={{ fontSize: 16 }}>{editing ? `Edit: ${event.title}` : "Event baru"}</h2>
			<label>Judul *</label>
			<input value={form.title} onChange={set("title")} />
			{!editing && (
				<>
					<label>Slug (kosong = auto dari judul)</label>
					<input value={form.slug} onChange={set("slug")} placeholder="auto dari judul" />
				</>
			)}
			<label>Deskripsi</label>
			<textarea rows={4} value={form.description} onChange={set("description")} />
			<div className="row">
				<div><label>Mulai (WIB) *</label><input type="datetime-local" value={form.starts_at} onChange={set("starts_at")} /></div>
				<div><label>Selesai (WIB) *</label><input type="datetime-local" value={form.ends_at} onChange={set("ends_at")} /></div>
			</div>
			<div className="row">
				<div><label>Lokasi *</label><input value={form.location} onChange={set("location")} /></div>
				<div><label>Link lokasi (maps)</label><input type="url" value={form.location_url} onChange={set("location_url")} /></div>
			</div>
			<div className="row">
				<div><label>Registration URL</label><input type="url" value={form.registration_url} onChange={set("registration_url")} /></div>
				<div><label>Penyelenggara</label><input value={form.organizer} onChange={set("organizer")} /></div>
			</div>
			<label style={{ marginTop: 12 }}>Cover (JPG/PNG/WebP, maks 5MB)</label>
			<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
			{cover && <img className="cover" src={cover} alt="cover" />}
			<label style={{ marginTop: 10 }}>
				<input type="checkbox" checked={form.registration_open} onChange={(e) => setForm({ ...form, registration_open: e.target.checked })} /> Registration open
			</label>

			<h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Sesi / Runsheet</h3>
			{sessions.map((s, i) => (
				<SessionRow key={s._key} s={s} i={i} onChange={setSess} onRemove={rmSession} />
			))}
			<button className="sec" onClick={() => setSessions([...sessions, blankSession()])}>+ Tambah sesi</button>

			{err && <div className="err">{err}</div>}
			<p>
				<button onClick={save} disabled={saving}>{saving ? "Menyimpan…" : "Simpan"}</button>{" "}
				<button className="sec" onClick={onClose}>Tutup</button>{" "}
				{editing && <button className="danger" onClick={del}>Hapus permanen</button>}
			</p>
		</div>
	);
}

// ---------- Event list ----------
function EventList({ events, onEdit, onToggle }) {
	if (!events.length)
		return (
			<div className="card">
				<p className="muted">Belum ada event. Klik "+ Event baru".</p>
			</div>
		);
	return (
		<table>
			<thead><tr><th>Judul</th><th>Mulai (WIB)</th><th>Status</th><th>Aksi</th></tr></thead>
			<tbody>
				{events.map((e) => (
					<tr key={e.id}>
						<td><strong>{e.title}</strong><br /><span className="muted">/{e.slug}</span></td>
						<td>{e.starts_at}</td>
						<td><span className={`badge ${e.status}`}>{e.status}</span></td>
						<td>
							<button className="sec" onClick={() => onToggle(e)}>
								{e.status === "draft" ? "Publish" : "Unpublish"}
							</button>{" "}
							<button className="sec" onClick={() => onEdit(e)}>Edit</button>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

// ---------- App ----------
export default function App() {
	const [token, setToken] = useState(localStorage.getItem("bph_cms_token"));
	const [events, setEvents] = useState([]);
	const [editing, setEditing] = useState(null); // null = list; {} = baru; event = edit
	const [msg, setMsg] = useState("");
	const [loadErr, setLoadErr] = useState("");

	const load = useCallback(async () => {
		const d = await api("/admin/events");
		setEvents(d.items || d || []);
	}, []);

	useEffect(() => {
		if (!token) return;
		load().catch((e) => {
			if (e?.statusCode === 401) {
				localStorage.removeItem("bph_cms_token");
				setToken(null);
			} else {
				setLoadErr(errText(e));
			}
		});
	}, [token, load]);

	if (!token)
		return (
			<Login
				onLogin={(t) => {
					localStorage.setItem("bph_cms_token", t);
					setToken(t);
				}}
			/>
		);

	const togglePub = (e) => {
		api(`/admin/events/${e.id}/${e.status === "draft" ? "publish" : "unpublish"}`, { method: "POST" })
			.then(load)
			.catch((e) => setLoadErr(errText(e)));
	};

	const logout = () => {
		localStorage.removeItem("bph_cms_token");
		setToken(null);
	};

	return (
		<>
			<header>
				<h1>BPH CMS — Student Event</h1>
				<button className="sec" onClick={logout}>Keluar</button>
			</header>
			<main>
				{editing === null ? (
					<>
						<button onClick={() => setEditing({})}>+ Event baru</button>
						{msg && <span className="ok">{msg}</span>}
						{loadErr && <div className="err">{loadErr}</div>}
						<EventList events={events} onEdit={setEditing} onToggle={togglePub} />
					</>
				) : (
					<EventForm
						event={editing.id ? editing : null}
						onClose={() => setEditing(null)}
						onSaved={() => {
							setEditing(null);
							load().then(() => setMsg("Tersimpan."));
						}}
						onDeleted={() => {
							setEditing(null);
							load();
						}}
					/>
				)}
			</main>
		</>
	);
}
