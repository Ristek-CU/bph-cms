import { useCallback, useEffect, useMemo, useState } from "react";
import { HashRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, errText, setToken as persistToken, clearToken, signIn } from "./api.js";
import { ToastProvider } from "./components/ui.jsx";
import { Login, Shell } from "./components/Shell.jsx";
import Overview from "./pages/Overview.jsx";
import EventList from "./pages/EventList.jsx";
import EventCalendar from "./pages/EventCalendar.jsx";
import EventEditor from "./pages/EventEditor.jsx";
import Qpr from "./pages/Qpr.jsx";

function App() {
	const [token, setToken] = useState(localStorage.getItem("bph_cms_token"));
	const [user, setUser] = useState(null);
	const [events, setEvents] = useState([]);
	const [loadErr, setLoadErr] = useState("");
	const navigate = useNavigate();

	const load = useCallback(async () => {
		const d = await api("/admin/events");
		setEvents(d.items || d || []);
	}, []);

	useEffect(() => {
		if (!token) return;
		load().catch((e) => {
			if (e?.statusCode === 401) {
				clearToken();
				setToken(null);
				navigate("/login", { replace: true });
			} else {
				setLoadErr(errText(e));
			}
		});
	}, [token, load, navigate]);

	const handleLogin = async (email, password) => {
		const data = await signIn(email, password);
		persistToken(data.token);
		setToken(data.token);
		setUser(data.user || { email });
		navigate("/", { replace: true });
	};

	const onEdit = useCallback((id) => navigate(`/events/${id}/edit`), [navigate]);

	const shellProps = useMemo(() => ({ user: user || { email: "pengurus@sga" } }), [user]);

	if (!token) return <Login onLogin={handleLogin} />;

	return (
		<Routes>
			<Route path="/login" element={<Navigate to="/" replace />} />
			<Route
				path="/"
				element={
					<Shell {...shellProps} title="Ringkasan" crumb="Beranda">
						{loadErr && <div className="card err-text">{loadErr}</div>}
						<Overview events={events} onEdit={onEdit} />
					</Shell>
				}
			/>
			<Route
				path="/events"
				element={
					<Shell
						{...shellProps}
						title="Event"
						crumb="Modul · Event"
						actions={
							<>
								<Link className="btn ghost" to="/events/kalender">📅 Kalender</Link>
								<Link className="btn gold" to="/events/baru">+ Event baru</Link>
							</>
						}
					>
						<EventList events={events} onEdit={onEdit} />
					</Shell>
				}
			/>
			<Route
				path="/events/kalender"
				element={
					<Shell
						{...shellProps}
						title="Kalender Event"
						crumb="Modul · Event · Kalender"
						actions={<Link className="btn gold" to="/events/baru">+ Event baru</Link>}
					>
						<EventCalendar events={events} onEdit={onEdit} />
					</Shell>
				}
			/>
			<Route
				path="/events/baru"
				element={
					<Shell {...shellProps} title="Event Baru" crumb="Modul · Event · Baru">
						<NewEventRoute events={events} />
					</Shell>
				}
			/>
			<Route
				path="/events/:id/edit"
				element={
					<Shell {...shellProps} title="Edit Event" crumb="Modul · Event · Edit">
						<EditEventRoute events={events} onEdit={onEdit} />
					</Shell>
				}
			/>
			<Route
				path="/qpr"
				element={
					<Shell {...shellProps} title="QPR" crumb="Modul · QPR">
						<Qpr />
					</Shell>
				}
			/>
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

function NewEventRoute() {
	const sp = new URLSearchParams(window.location.hash.split("?")[1] || "");
	return <EventEditor prefillDate={sp.get("date")} />;
}

function EditEventRoute({ events, onEdit }) {
	const id = window.location.hash.match(/events\/([^/]+)\/edit/)?.[1];
	const ev = events.find((e) => e.id === id);
	if (!ev) {
		// Event belum ada di state (mis. baru dibuka via link langsung) — coba refresh.
		return ev === null ? null : <Reloader id={id} onEdit={onEdit} />;
	}
	return <EventEditor event={ev} />;
}

function Reloader({ id, onEdit }) {
	const [ev, setEv] = useState(undefined); // undefined = loading, null = 404
	useEffect(() => {
		api("/admin/events")
			.then((d) => {
				const found = (d.items || d || []).find((e) => e.id === id);
				setEv(found || null);
			})
			.catch(() => setEv(null));
	}, [id]);
	if (ev === undefined) return <div className="card muted">Memuat event…</div>;
	if (ev === null) {
		return (
			<div className="empty-state">
				<p>Event tidak ditemukan — mungkin sudah dihapus.</p>
				<button className="btn" onClick={onEdit ? () => onEdit("") : undefined} style={{ display: "none" }} />
				<Link className="btn" to="/events">Kembali ke daftar event</Link>
			</div>
		);
	}
	return <EventEditor event={ev} />;
}

export default function Root() {
	return (
		<ToastProvider>
			<HashRouter>
				<App />
			</HashRouter>
		</ToastProvider>
	);
}
