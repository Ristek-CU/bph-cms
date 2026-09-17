import { useCallback, useEffect, useMemo, useState } from "react";
import { HashRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { api, errText, setToken as persistToken, clearToken, signIn, requestWorkspaceHandoff } from "./api.js";
import { ToastProvider, SkeletonCard } from "./components/ui.jsx";
import { Login, Shell } from "./components/Shell.jsx";
import { IconCalendar, IconPlus } from "./components/Icons.jsx";
import WorkspaceModal from "./components/WorkspaceModal.jsx";
import Overview from "./pages/Overview.jsx";
import Assistant from "./pages/Assistant.jsx";
import EventList from "./pages/EventList.jsx";
import EventCalendar from "./pages/EventCalendar.jsx";
import EventEditor from "./pages/EventEditor.jsx";
import Forms, { FormBuilderRoute, FormAnalyticsRoute } from "./pages/Forms.jsx";
import Qpr, { PublicFill } from "./pages/Qpr.jsx";
import Accounts from "./pages/Accounts.jsx";

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
const canSeeForms = (permissions) =>
	hasScopedPermission(permissions, "forms.read") || hasScopedPermission(permissions, "forms.submissions");

const WS_KEY = "bph_cms_workspace";

function App() {
	const [token, setToken] = useState(localStorage.getItem("bph_cms_token"));
	const [user, setUser] = useState(null);
	const [workspaces, setWorkspaces] = useState([]);
	// Pilihan workspace dipersist: modal pilih dashboard HANYA muncul saat login
	// baru (token berganti) atau saat user eksplisit menekan "Ganti Dashboard".
	// Refresh / pindah module TIDAK boleh melempar user ke selection lagi.
	const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
	const [wsBusy, setWsBusy] = useState(false);
	const [wsErr, setWsErr] = useState("");
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
				// Root-cause fix: dulu modal selalu muncul tiap /me balas —
				// refresh/pindah module meng-unmount seluruh app. Sekarang:
				// tampilkan hanya jika token BARU login (belum ada pilihan
				// tersimpan untuk token ini).
				const seenFor = localStorage.getItem(WS_KEY);
				if (!seenFor || seenFor !== String(localStorage.getItem("bph_cms_token"))) {
					setShowWorkspaceModal(true);
				}
			}
		} catch (e) {
			// 401 sudah ditangani api() (dispatch bph:unauthorized → reset + login).
			// Error lain (5xx, network): tampilkan, jangan telan diam-diam.
			if (e?.statusCode !== 401) setLoadErr(errText(e));
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

	// 401 dari modul mana pun (api() dispatch) → reset state + ke login.
	useEffect(() => {
		const onUnauthorized = () => {
			localStorage.removeItem(WS_KEY);
			setUser(null);
			setEvents([]);
			setToken(null);
			navigate("/login", { replace: true });
		};
		window.addEventListener("bph:unauthorized", onUnauthorized);
		return () => window.removeEventListener("bph:unauthorized", onUnauthorized);
	}, [navigate]);

	const handleLogin = async (email, password) => {
		const data = await signIn(email, password);
		persistToken(data.token);
		localStorage.removeItem(WS_KEY); // login baru → tanya workspace lagi
		setToken(data.token);
		setUser(data.user || { email });
		navigate("/", { replace: true });
	};

	// "Ganti Dashboard" eksplisit dari UI — satu-satunya jalan kembali ke selection
	// selain login baru.
	const openWorkspacePicker = () => {
		localStorage.removeItem(WS_KEY);
		setWsErr("");
		setShowWorkspaceModal(true);
	};

	const handleSelectWorkspace = async (ws) => {
		setWsErr("");
		localStorage.setItem(WS_KEY, String(localStorage.getItem("bph_cms_token")));

		// cms_hub (atau workspace tanpa URL): perilaku lama sudah benar —
		// tutup modal dan jatuh ke <Routes>. Dibuat eksplisit.
		if (ws.kind !== "external_dashboard" || !ws.url) {
			setShowWorkspaceModal(false);
			return;
		}

		// external_dashboard: JANGAN window.location.href = ws.url telanjang.
		// Minta kode handoff sekali pakai dulu, baru pindah ke redirect_to yang
		// dibalas backend (SDD §4.5). Modal tetap terbuka sampai berhasil supaya
		// pesan error punya tempat tampil.
		setWsBusy(true);
		try {
			const data = await requestWorkspaceHandoff(ws.id);
			window.location.href = data.redirect_to;
		} catch (e) {
			setWsBusy(false);
			setWsErr(errText(e));
		}
	};

	const onEdit = useCallback((id) => navigate(`/events/${id}/edit`), [navigate]);

	// Logout harus me-reset state App (token/user/events) — clearToken() saja tidak
	// cukup: /login me-redirect ke "/" dan app tetap render dengan user basi.
	const handleLogout = useCallback(() => {
		clearToken();
		localStorage.removeItem(WS_KEY);
		setToken(null);
		setUser(null);
		setEvents([]);
		setWorkspaces([]);
		navigate("/login", { replace: true });
	}, [navigate]);

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
	const shellProps = useMemo(
		() => ({
			user: user || { email: "pengurus@sga" },
			onSwitchDashboard: workspaces.length > 1 ? openWorkspacePicker : undefined,
			onLogout: handleLogout,
		}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[user, workspaces.length, handleLogout],
	);

	if (!token) {
		// QPR isi tetap bisa dibuka tanpa akun (model no-login).
		if (window.location.hash.startsWith("#/qpr/")) return <PublicQprRoute token={token} />;
		return <Login onLogin={handleLogin} />;
	}
	// Workspace selection = OVERLAY di atas app, bukan pengganti app.
	// Module tetap mounted di belakang — pindah workspace tidak reset state halaman.
	if (showWorkspaceModal && workspaces.length > 1) {
		return (
			<>
				<Routes>
					<Route path="/login" element={<Navigate to="/" replace />} />
					<Route
						path="/"
						element={
							<Shell {...shellProps} title="Ringkasan" crumb="Beranda">
								<Overview events={events} onEdit={onEdit} capabilities={capabilities} />
							</Shell>
						}
					/>
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
				<WorkspaceModal
					workspaces={workspaces}
					onSelect={handleSelectWorkspace}
					busy={wsBusy}
					error={wsErr}
					onCancel={wsBusy ? undefined : () => setShowWorkspaceModal(false)}
				/>
			</>
		);
	}

	return (
		<Routes>
			<Route path="/login" element={<Navigate to="/" replace />} />
			{/* Roro = landing; Ringkasan pindah ke /overview. */}
			<Route
				path="/"
				element={
					<Shell {...shellProps} title="Roro AI" crumb="Beranda">
						<Assistant user={user} />
					</Shell>
				}
			/>
			<Route
				path="/overview"
				element={
					<Shell {...shellProps} title="Ringkasan" crumb={[{ label: "Modul", to: "/" }, { label: "Ringkasan" }]}>
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
						crumb={[{ label: "Modul", to: "/" }, { label: "Event" }]}
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
						crumb={[{ label: "Modul", to: "/" }, { label: "Event", to: "/events" }, { label: "Kalender" }]}
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
					<Shell {...shellProps} title="Event Baru" crumb={[{ label: "Modul", to: "/" }, { label: "Event", to: "/events" }, { label: "Baru" }]}>
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
					<Shell {...shellProps} title="Edit Event" crumb={[{ label: "Modul", to: "/" }, { label: "Event", to: "/events" }, { label: "Edit" }]}>
						<EditEventRoute events={events} onEdit={onEdit} capabilities={capabilities} />
					</Shell>
				}
			/>
			<Route
				path="/forms"
				element={
					<Shell {...shellProps} title="Form" crumb={[{ label: "Modul", to: "/" }, { label: "Form" }]}>
						{canSeeForms(permissions) ? (
							<Forms user={user} />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			<Route
				path="/forms/:formId"
				element={
					<Shell {...shellProps} title="Form Builder" crumb={[{ label: "Modul", to: "/" }, { label: "Form", to: "/forms" }, { label: "Builder" }]}>
						{canSeeForms(permissions) ? (
							<FormBuilderRoute user={user} />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			<Route
				path="/forms/:formId/analytics"
				element={
					<Shell {...shellProps} title="Analitik Form" crumb={[{ label: "Modul", to: "/" }, { label: "Form", to: "/forms" }, { label: "Analitik" }]}>
						{canSeeForms(permissions) ? (
							<FormAnalyticsRoute user={user} />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			<Route
				path="/qpr"
				element={
					<Shell {...shellProps} title="QPR" crumb={[{ label: "Modul", to: "/" }, { label: "QPR" }]}>
						<Qpr user={user} />
					</Shell>
				}
			/>
			<Route
				path="/accounts"
				element={
					<Shell {...shellProps} title="Akun & Audit" crumb={[{ label: "Admin", to: "/" }, { label: "Akun" }]}>
						{permissions.includes("accounts.manage") || permissions.includes("audit.read") ? (
							<Accounts />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			{/* QPR isi PUBLIK (no-login): di luar guard token. Kalau tidak, anggota
			    tanpa akun dapat halaman Login padahal model QPR memang tanpa login. */}
			<Route
				path="/qpr/:periodId"
				element={<PublicQprRoute token={token} shellProps={shellProps} />}
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

// #/qpr/:periodId — halaman isi QPR. User login dapat Shell + sidebar (L2);
// tamu tetap standalone (model QPR no-login).
function PublicQprRoute({ token, shellProps }) {
	const periodId = window.location.hash.match(/qpr\/([^/?#]+)/)?.[1];
	const fill = <PublicFill periodId={periodId} />;
	if (!token) return fill;
	return (
		<Shell {...shellProps} title="Isi QPR" crumb={[{ label: "Modul", to: "/" }, { label: "QPR", to: "/qpr" }, { label: "Isi" }]}
			actions={<Link className="btn ghost" to="/qpr">Kembali ke panel</Link>}>
			{fill}
		</Shell>
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
		return <Reloader id={id} onEdit={onEdit} capabilities={capabilities} />;
	}
	return <EventEditor event={ev} />;
}

function Reloader({ id, onEdit, capabilities }) {
	const [ev, setEv] = useState(undefined); // undefined = loading, null = 404
	useEffect(() => {
		api("/admin/events")
			.then((d) => {
				const found = (d.items || d || []).find((e) => e.id === id);
				setEv(found || null);
			})
			.catch(() => setEv(null));
	}, [id]);
	if (ev === undefined) return <SkeletonCard lines={5} />;
	if (ev === null) {
		return (
			<div className="empty-state">
				<p>Event tidak ditemukan — mungkin sudah dihapus.</p>
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
