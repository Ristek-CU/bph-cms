import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { clearToken } from "../api.js";
import { useEscape, useFocusTrap } from "./ui.jsx";
import { IconChevronRight, IconBarChart } from "./Icons.jsx";

const hasScoped = (permissions, base) =>
	permissions?.includes(`${base}.all`) || permissions?.includes(`${base}.own_division`);
import { IconCalendar, IconClipboard, IconEye, IconEyeOff, IconGrid, IconLink, IconMenu, IconUsers } from "./Icons.jsx";

// Logomark SGA Cakrawala — outline putih transparan (dari landing page).
import logoSga from "/logo-sga.webp";
import { ReleaseStamp } from "./ReleaseStamp.jsx";

// Hash routing — panel di-host sebagai aset Worker, tanpa rewrite tambahan.
export const href = (path) => `#${path}`;

export function Login({ onLogin, notice }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPw, setShowPw] = useState(false);
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const [capsLock, setCapsLock] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
		if (busy) return;
		setErr("");
		setBusy(true);
		try {
			await onLogin(email.trim(), password);
		} catch (e2) {
			setErr(e2?.message || "Gagal masuk. Cek email dan password.");
			setBusy(false);
		}
	};

	return (
		<main className="login-page">
			<section className="login-story" aria-label="SGA CMS Hub">
				<div className="login-wordmark"><img src={logoSga} alt="" /><span>SGA CAKRAWALA<small>Ruang kerja pengurus</small></span></div>
				<div className="login-story-body login-roro-story">
					<span className="login-eyebrow">TEMAN KERJA TIM SGA</span>
					<div className="login-roro-stage"><span className="login-roro-greeting">Hai, aku Roro! <span aria-hidden>✦</span></span><img src="/roro-login-hd.png" width={1254} height={1254} fetchPriority="high" className="login-roro-mascot" alt="Roro, asisten SGA yang siap membantu" draggable={false} /><span className="login-roro-shadow" aria-hidden /></div>
					<h1>Ide kamu.<br /><em>Kita wujudkan bareng.</em></h1>
					<p>Dari agenda kampus sampai suara mahasiswa. Roro siap bantu kamu mulai.</p>
				</div>
				<span className="login-story-footer">Student Government Association · Cakrawala University</span>
			</section>
			<section className="login-form-panel">
				<form className="login-card" onSubmit={submit} aria-busy={busy}>
					<div className="login-form-mark"><img className="brand-logo-img" src={logoSga} alt="SGA Cakrawala" /> CMS Hub</div>
					<p className="studio-kicker">SELAMAT DATANG KEMBALI</p>
					<h2>Masuk ke ruang kerja</h2>
					<p className="login-intro">Gunakan akun pengurus untuk melanjutkan.</p>
					{notice && <div className="login-notice" role="status">{notice}</div>}
					<label className="field-label" htmlFor="email">Email pengurus</label>
					<input id="email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="nama@email.com" required disabled={busy} />
					<label className="field-label" htmlFor="password">Password</label>
					<div className="pw-wrap">
						<input id="password" name="password" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))} onBlur={() => setCapsLock(false)} autoComplete="current-password" placeholder="Masukkan password" required disabled={busy} aria-describedby={capsLock ? "caps-lock" : undefined} />
						<button type="button" className="pw-toggle" aria-label={showPw ? "Sembunyikan password" : "Lihat password"} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>{showPw ? <IconEyeOff size={18} /> : <IconEye size={18} />}</button>
					</div>
					{capsLock && <p id="caps-lock" className="field-help">Caps Lock aktif.</p>}
					{err && <div className="login-error" role="alert">{err}</div>}
					<button className="btn" type="submit" disabled={busy}>{busy ? "Memeriksa akun…" : <>Masuk <IconChevronRight size={18} /></>}</button>
					<p className="login-help">Belum punya akses atau lupa password?<br />Hubungi admin BPH untuk bantuan akun.</p>
					<div className="login-footnote">Akses sesuai peran dan divisi kamu.<ReleaseStamp /></div>
				</form>
			</section>
		</main>
	);

}

export function Shell({ user, children, title, crumb, actions, onSwitchDashboard, onLogout }) {
	const [drawer, setDrawer] = useState(false);
	const navigate = useNavigate();
	const location = useLocation();
	useEscape(() => setDrawer(false));
	// Focus trap hanya saat drawer mobile terbuka — desktop sidebar statis.
	const drawerRef = useFocusTrap(drawer);
	// Drawer mobile harus menutup saat pindah halaman — dulu tetap terbuka
	// menutupi konten (bug "sidebar tidak ikut pindah page").
	const closeDrawer = () => setDrawer(false);
	useEffect(closeDrawer, [location.pathname]);
	useEffect(() => { document.title = `${title} — SGA CMS Hub`; }, [title]);

	const logout = () => {
		clearToken();
		// Reset state App (token/user/events) supaya /login tidak me-redirect balik
		// ke app dengan user basi.
		if (onLogout) onLogout();
		navigate("/login", { replace: true });
	};

	const initials = (user?.name || user?.email || "?")
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join("")
		.toUpperCase();

	const permissions = user?.permissions || [];
	const canManageQpr = permissions.includes("qpr.manage");
	const canSeeForms =
		hasScoped(permissions, "forms.read") || hasScoped(permissions, "forms.submissions");
	const canManageAccounts = permissions.includes("accounts.manage");
	const canReadAudit = permissions.includes("audit.read");

	const nav = (
		<nav className="nav" aria-label="Modul">
			<p className="nav-group-label">CMS Hub</p>
			<NavLink to="/" end onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconGrid /></span> Roro AI
			</NavLink>
			<NavLink to="/overview" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconBarChart size={18} /></span> Ringkasan
			</NavLink>
			<NavLink to="/events" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconCalendar /></span> Event
			</NavLink>
			{canSeeForms && (
				<NavLink to="/forms" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
					<span className="icon" aria-hidden><IconClipboard /></span> Form
				</NavLink>
			)}
			{/* QPR: semua user punya penugasan menilai; kelola periode khusus qpr.manage */}
			<NavLink to="/qpr" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconClipboard /></span> QPR {!canManageQpr && <span className="soon">Penilaian</span>}
			</NavLink>
			{(canManageAccounts || canReadAudit) && (
				<NavLink to="/accounts" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
					<span className="icon" aria-hidden><IconUsers size={18} /></span> Akun &amp; Audit
				</NavLink>
			)}
			<div className="nav-sep" />
			{/* Oversight Roro — khusus akun Ristek (allowlist RORO_OVERSIGHT_EMAILS). */}
			{user?.canAccessOversight && (
				<NavLink to="/roro-oversight" onClick={closeDrawer} className={({ isActive }) => (isActive ? "active" : "")}>
					<span className="icon" aria-hidden><IconBarChart size={18} /></span> Oversight Roro
				</NavLink>
			)}
			{/* Dokumentasi API khusus Ristek (allowlist server DOCS_ALLOW_EMAILS) —
			    divisi lain tidak diperlihatkan linknya sama sekali. */}
			{user?.canAccessDocs && (
				<a href="/docs/" target="_blank" rel="noreferrer" title="Dokumentasi API untuk developer">
					<span className="icon" aria-hidden><IconLink /></span> Dokumentasi API
				</a>
			)}
		</nav>
	);

	const sidebar = (
		<aside id="main-navigation" role={drawer ? "dialog" : undefined} aria-modal={drawer || undefined} aria-label="Navigasi utama" tabIndex={-1} ref={drawer ? drawerRef : undefined} className={`sidebar ${drawer ? "open" : ""}`} aria-hidden={!drawer ? undefined : false}>
			<div className="brand">
				<img className="brand-logo-img" src={logoSga} alt="Logo SGA Cakrawala" />
				<div>
					<strong>SGA CMS Hub</strong>
					<small>{user?.division?.name ? `Divisi ${user.division.name}` : "SGA Cakrawala"}</small>
				</div>
				{/* Tombol tutup drawer — hanya muncul saat drawer mobile terbuka */}
				<button className="sidebar-close" aria-label="Tutup menu" onClick={() => setDrawer(false)}>×</button>
			</div>
			{nav}
			<div className="userbox">
				<div className="avatar" aria-hidden>{initials}</div>
				<div className="meta">
					<div>{user?.name || "Pengurus"}</div>
					<small title={user?.email}>{user?.email}</small>
				</div>
				<div className="userbox-actions">
				{onSwitchDashboard && (
					<button onClick={onSwitchDashboard} title="Pindah ke dashboard lain">Ganti dashboard</button>
				)}
				<button onClick={logout}>Keluar</button>
				</div>
			</div>
			<ReleaseStamp />
		</aside>
	);

	return (
		<div className="shell">
			<a className="skip-link" href="#main-content" onClick={(e) => { e.preventDefault(); document.getElementById("main-content")?.focus(); }}>Lewati ke konten</a>
			{sidebar}
			{drawer && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
			<div className="content" inert={drawer || undefined}>
				<header className="topbar">
					<div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
						<button className="menu-btn" aria-label="Buka menu" aria-expanded={drawer} aria-controls="main-navigation" onClick={() => setDrawer(true)}>
							<IconMenu />
						</button>
						<div style={{ minWidth: 0 }}>
							<h1>{title}</h1>
							{crumb && (
								<nav className="crumb" aria-label="Breadcrumb">
									{(Array.isArray(crumb) ? crumb : [{ label: crumb }]).map((c, i, arr) => (
										<span key={i} className="crumb-item">
											{i > 0 && <IconChevronRight size={11} aria-hidden />}
											{c.to && i < arr.length - 1 ? <Link to={c.to}>{c.label}</Link> : c.label}
										</span>
									))}
								</nav>
							)}
						</div>
					</div>
					<div className="topbar-actions">
						<span className="workspace-label">{user?.division?.name || "Ruang kerja SGA"}</span>
						{actions}
					</div>
				</header>
				<main id="main-content" tabIndex={-1} className="page">{children}</main>
			</div>
		</div>
	);
}
