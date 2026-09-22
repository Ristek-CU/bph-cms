import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HashRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, errText, setToken as persistToken, clearToken, signIn, requestWorkspaceHandoff } from "./api.js";
import { ToastProvider, SkeletonCard, ErrorState } from "./components/ui.jsx";
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
import CrossDivisionCalendar from "./pages/CrossDivisionCalendar.jsx";
import RoroOversight from "./pages/RoroOversight.jsx";

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

const EMPTY_PERMISSIONS = [];
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
	const [eventsLoading, setEventsLoading] = useState(true);
	const [authErr, setAuthErr] = useState("");
	const [loginNotice, setLoginNotice] = useState("");
	const authGeneration = useRef(0);
	const location = useLocation();
	const navigate = useNavigate();

	const loadMe = useCallback(async () => {
		const generation = authGeneration.current;
		setAuthErr("");
		try {
			const me = await api("/me");
			if (generation !== authGeneration.current) return;
			const activeMembership = me.memberships?.find((m) => m.division.id === me.active_division_id) || me.memberships?.[0];
				setUser({
					...me.user,
					division: activeMembership?.division,
					role: activeMembership?.role,
					permissions: activeMembership?.permissions || [],
					canAccessDocs: !!me.can_access_docs,
					canAccessOversight: !!me.can_access_oversight,
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
			if (generation === authGeneration.current && e?.statusCode !== 401) setAuthErr(errText(e));
		}
	}, []);

	const load = useCallback(async () => {
		const generation = authGeneration.current;
		setLoadErr("");
		setEventsLoading(true);
		try {
			const d = await api("/admin/events");
			if (generation === authGeneration.current) setEvents(d.items || d || []);
		} catch (e) {
			if (generation === authGeneration.current && e?.statusCode !== 401) setLoadErr(errText(e));
		} finally {
			if (generation === authGeneration.current) setEventsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (token) loadMe();
	}, [token, loadMe]);

	useEffect(() => {
		if (token && user) load();
	}, [token, user, load]);

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
			clearToken();
			authGeneration.current++;
			setLoginNotice("Sesi kamu berakhir. Masuk lagi untuk melanjutkan.");
			setShowWorkspaceModal(false);
			setWorkspaces([]);
			sessionStorage.removeItem("roro_conv_id");
			localStorage.removeItem(WS_KEY);
			setUser(null);
			setEvents([]);
			setToken(null);
		};
		window.addEventListener("bph:unauthorized", onUnauthorized);
		return () => window.removeEventListener("bph:unauthorized", onUnauthorized);
	}, [navigate]);

	const handleLogin = async (email, password) => {
		const data = await signIn(email, password);
		persistToken(data.token);
		localStorage.removeItem(WS_KEY); // login baru → tanya workspace lagi
		setToken(data.token);
		setUser(null);
		setLoginNotice("");
		if (location.pathname === "/login") navigate("/", { replace: true });
	};

	// "Ganti Dashboard" eksplisit dari UI — satu-satunya jalan kembali ke selection
	// selain login baru.
	const openWorkspacePicker = useCallback(() => {
		localStorage.removeItem(WS_KEY);
		setWsErr("");
		setShowWorkspaceModal(true);
	}, []);

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
		authGeneration.current++;
		clearToken();
		sessionStorage.removeItem("roro_conv_id");
		setShowWorkspaceModal(false);
		setWsBusy(false);
		setAuthErr("");
		setLoginNotice("");
		localStorage.removeItem(WS_KEY);
		setToken(null);
		setUser(null);
		setEvents([]);
		setWorkspaces([]);
		navigate("/login", { replace: true });
	}, [navigate]);

	const permissions = user?.permissions || EMPTY_PERMISSIONS;
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
		[user, workspaces.length, handleLogout, openWorkspacePicker],
	);

	if (!token) {
		// QPR isi tetap bisa dibuka tanpa akun (model no-login).
		if (window.location.hash.startsWith("#/qpr/")) return <PublicQprRoute token={token} />;
		return <Login onLogin={handleLogin} notice={loginNotice} />;
	}
	if (!user) return <main className="auth-loading" aria-label="Menyiapkan dashboard">
		{authErr ? <ErrorState title="Dashboard belum bisa dibuka" message={authErr} onRetry={loadMe} /> : <><p role="status">Menyiapkan ruang kerja kamu…</p><SkeletonCard lines={4} /></>}
		<button className="btn ghost" onClick={handleLogout}>Kembali ke login</button>
	</main>;
	const eventContent = (children) => loadErr
		? <ErrorState title="Event belum bisa dimuat" message={loadErr} onRetry={load} />
		: eventsLoading ? <SkeletonCard lines={5} /> : children;

	return (
		<>
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
						{eventContent(<Overview events={events} onEdit={onEdit} capabilities={capabilities} user={user} />)}
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
						onBack={() => navigate(-1)}
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
						{eventContent(<EventList events={events} onEdit={onEdit} capabilities={capabilities} />)}
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
						{eventContent(<EventCalendar events={events} onEdit={onEdit} capabilities={capabilities} />)}
					</Shell>
				}
			/>
			<Route
				path="/calendar"
				 element={
					<Shell
						{...shellProps}
						title="Kalender Lintas Divisi"
						crumb={[{ label: "Modul", to: "/" }, { label: "Kalender Lintas Divisi" }]}
					>
						{hasScopedPermission(permissions, "events.read") ? <CrossDivisionCalendar /> : <NoAccess />}
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
							<Accounts permissions={permissions} />
						) : (
							<NoAccess />
						)}
					</Shell>
				}
			/>
			{/* Oversight Roro — khusus akun Ristek (allowlist RORO_OVERSIGHT_EMAILS).
			    Baca percakapan + jejak event lintas divisi. */}
			<Route
				path="/roro-oversight"
				element={
					<Shell {...shellProps} title="Oversight Roro" crumb={[{ label: "Modul", to: "/" }, { label: "Oversight Roro" }]}>
						{user?.canAccessOversight ? <RoroOversight /> : <NoAccess />}
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
		{showWorkspaceModal && workspaces.length > 1 && <WorkspaceModal workspaces={workspaces} onSelect={handleSelectWorkspace} busy={wsBusy} error={wsErr} onCancel={wsBusy ? undefined : () => {
			localStorage.setItem(WS_KEY, String(localStorage.getItem("bph_cms_token")));
			setShowWorkspaceModal(false);
		}} />}
		</>
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
	const fill = <PublicFill key={periodId} periodId={periodId} />;
	if (!token) return <main className="public-page"><div className="public-brand">SGA Cakrawala <span>Penilaian QPR</span></div>{fill}</main>;
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

function EditEventRoute({ events, capabilities }) {
	const id = window.location.hash.match(/events\/([^/]+)\/edit/)?.[1];
	const ev = events.find((e) => e.id === id);
	if (!ev) {
		// Event belum ada di state (mis. baru dibuka via link langsung) — coba refresh.
		return <Reloader key={id} id={id} capabilities={capabilities} />;
	}
	if (!capabilities.canEditEvent(ev)) return <NoAccess />;
	return <EventEditor key={ev.id} event={ev} canPublish={capabilities.canPublishEvent} canDelete={capabilities.canDeleteEvent} />;
}

function Reloader({ id, capabilities }) {
	const [ev, setEv] = useState(undefined); // undefined = loading, null = 404
	const [error, setError] = useState("");
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		api("/admin/events")
			.then((d) => {
				const found = (d.items || d || []).find((e) => e.id === id);
				setEv(found || null);
			})
			.catch((e) => setError(errText(e)));
	}, [id, attempt]);
	if (error) return <ErrorState message={error} onRetry={() => { setError(""); setAttempt((n) => n + 1); }} />;
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
