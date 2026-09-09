import { useCallback, useEffect, useMemo, useState } from "react";
import { HashRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, errText, setToken as persistToken, clearToken, signIn } from "./api.js";
import { ToastProvider } from "./components/ui.jsx";
import { Login, Shell } from "./components/Shell.jsx";
import { IconCalendar, IconPlus } from "./components/Icons.jsx";
import WorkspaceModal from "./components/WorkspaceModal.jsx";
import Overview from "./pages/Overview.jsx";
import EventList from "./pages/EventList.jsx";
import EventCalendar from "./pages/EventCalendar.jsx";
import EventEditor from "./pages/EventEditor.jsx";
import Qpr from "./pages/Qpr.jsx";

const hasScopedPermission = (permissions, base) =>
	permissions.includes(`${base}.all`) || permissions.includes(`${base}.own_division`);

const canCreateEvent = (permissions) =>
	hasScopedPermission(permissions, "events.create") ||
	hasScopedPermission(permissions, "events.create_draft");

const canUpdateEvent = (permissions, event) =>
	hasScopedPermission(permissions, "events.update") ||
	(event?.status === "draft" && hasScopedPermission(permissions, "events.update_draft"));

const canPublishEvent = (permissions) => hasScopedPermission(permissions, "events.publish");
const canDeleteEvent = (permissions) => hasScopedPermission(permissions, "events.delete");

function App() {
	const [token, setToken] = useState(localStorage.getItem("bph_cms_token"));
	const [user, setUser] = useState(null);
	const [workspaces, setWorkspaces] = useState([]);
	const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
	const [events, setEvents] = useState([]);
	const [loadErr, setLoadErr] = useState("");
	const navigate = useNavigate();

	const loadMe = useCallback(async () => {
		try {
			const me = await api("/me");
			const activeMembership = me.memberships?.[0];
			setUser({
				...me.user,
				division: activeMembership?.division,
				role: activeMembership?.role,
				permissions: activeMembership?.permissions || [],
			});
			if (me.workspace_options && me.workspace_options.length > 1) {
				setWorkspaces(me.workspace_options);
				setShowWorkspaceModal(true);
			}
		} catch {
			// ignore /me error if token is local dev fallback
		}
	}, []);

	const load = useCallback(async () => {
		setLoadErr("");
		const d = await api("/admin/events");
		setEvents(d.items || d || []);
	}, []);

	useEffect(() => {
		if (!token) return;
		loadMe();
		load().catch((e) => {
			if (e?.statusCode === 401) {
				clearToken();
				setToken(null);
				navigate("/login", { replace: true });
			} else {
				setLoadErr(errText(e));
			}
		});
	}, [token, load, loadMe, navigate]);

	useEffect(() => {
		if (!token) return;
		const refresh = () => {
			load().catch((e) => setLoadErr(errText(e)));
		};
		window.addEventListener("bph:events-changed", refresh);
		return () => window.removeEventListener("bph:events-changed", refresh);
	}, [token, load]);

	const handleLogin = async (email, password) => {
		const data = await signIn(email, password);
		persistToken(data.token);
		setToken(data.token);
		setUser(data.user || { email });
		navigate("/", { replace: true });
	};

	const handleSelectWorkspace = (ws) => {
		setShowWorkspaceModal(false);
		if (ws.kind === "external_dashboard" && ws.url) {
			window.location.href = ws.url;
		}
	};

	const onEdit = useCallback((id) => navigate(`/events/${id}/edit`), [navigate]);

	const permissions = user?.permissions || [];
	const capabilities = useMemo(
		() => ({
			canCreateEvent: canCreateEvent(permissions),
			canEditEvent: (event) => canUpdateEvent(permissions, event),
			canPublishEvent: canPublishEvent(permissions),
			canDeleteEvent: canDeleteEvent(permissions),
		}),
		[permissions],
	);
	const shellProps = useMemo(() => ({ user: user || { email: "pengurus@sga" } }), [user]);

	if (!token) return <Login onLogin={handleLogin} />;
	if (showWorkspaceModal && workspaces.length > 1) {
		return <WorkspaceModal workspaces={workspaces} onSelect={handleSelectWorkspace} />;
	}

	return (
		<Routes>
			<Route path="/login" element={<Navigate to="/" replace />} />
			<Route
				path="/"
				element={
					<Shell {...shellProps} title="Ringkasan" crumb="Beranda">
						{loadErr && <div className="card err-text">{loadErr}</div>}
						<Overview events={events} onEdit={onEdit} capabilities={capabilities} />
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
								<Link className="btn ghost" to="/events/kalender">
									<IconCalendar size={16} /> Kalender
								</Link>
								{capabilities.canCreateEvent && (
									<Link className="btn gold" to="/events/baru">
										<IconPlus size={16} /> Event baru
									</Link>
								)}
							</>
						}
					>
						<EventList events={events} onEdit={onEdit} capabilities={capabilities} />
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
						actions={
							capabilities.canCreateEvent ? (
								<Link className="btn gold" to="/events/baru">
									<IconPlus size={16} /> Event baru
								</Link>
							) : null
						}
					>
						<EventCalendar events={events} onEdit={onEdit} capabilities={capabilities} />
					</Shell>
				}
			/>
			<Route
				path="/events/baru"
				element={
					<Shell {...shellProps} title="Event Baru" crumb="Modul · Event · Baru">
						{capabilities.canCreateEvent ? (
							<NewEventRoute canPublish={capabilities.canPublishEvent} />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			<Route
				path="/events/:id/edit"
				element={
					<Shell {...shellProps} title="Edit Event" crumb="Modul · Event · Edit">
						<EditEventRoute events={events} onEdit={onEdit} capabilities={capabilities} />
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
			<Route path="/docs" element={<NavigateDocs />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

// #/docs — arahkan ke dokumentasi API (Swagger UI, buka tab baru).
function NavigateDocs() {
	const navigate = useNavigate();
	useEffect(() => {
		window.open("/docs/", "_blank");
		navigate("/", { replace: true });
	}, [navigate]);
	return null;
}

function NoAccess() {
	return (
		<div className="empty-state">
			<p>Akun ini tidak punya akses untuk aksi tersebut.</p>
			<Link className="btn" to="/events">Kembali ke daftar event</Link>
		</div>
	);
}

function NewEventRoute({ canPublish }) {
	const sp = new URLSearchParams(window.location.hash.split("?")[1] || "");
	return <EventEditor prefillDate={sp.get("date")} canPublish={canPublish} canDelete={false} />;
}

function EditEventRoute({ events, onEdit, capabilities }) {
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
	if (!capabilities.canEditEvent(ev)) return <NoAccess />;
	return (
		<EventEditor
			event={ev}
			canPublish={capabilities.canPublishEvent}
			canDelete={capabilities.canDeleteEvent}
		/>
	);
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
