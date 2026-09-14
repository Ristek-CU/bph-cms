import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "../api.js";
import { useEscape, useFocusTrap } from "./ui.jsx";
import { IconChevronRight } from "./Icons.jsx";

const hasScoped = (permissions, base) =>
	permissions?.includes(`${base}.all`) || permissions?.includes(`${base}.own_division`);
import { IconCalendar, IconClipboard, IconEye, IconEyeOff, IconGrid, IconLink, IconMenu, IconUsers } from "./Icons.jsx";

// Logomark SGA Cakrawala — outline putih transparan (dari landing page).
import logoSga from "/logo-sga.webp";

// Hash routing — panel di-host sebagai aset Worker, tanpa rewrite tambahan.
export const href = (path) => `#${path}`;

export function Login({ onLogin }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPw, setShowPw] = useState(false);
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = async (e) => {
		e.preventDefault();
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
		<div className="login-page">
			<form className="login-card" onSubmit={submit}>
				<div className="brand">
					<img className="brand-logo-img" src={logoSga} alt="Logo SGA Cakrawala" />
					<div>
						<h1>SGA CMS Hub</h1>
						<small className="sub" style={{ color: "var(--muted)" }}>
							SGA Cakrawala · Panel Pengurus
						</small>
					</div>
				</div>
				<label className="field-label" htmlFor="email">Email</label>
				<input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
				<label className="field-label" htmlFor="password">Password</label>
				<div className="pw-wrap">
					<input id="password" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
					<button type="button" className="pw-toggle" aria-label={showPw ? "Sembunyikan password" : "Lihat password"} aria-pressed={showPw} onClick={() => setShowPw((v) => !v)}>
						{showPw ? <IconEyeOff size={16} /> : <IconEye size={16} />}
					</button>
				</div>
				{err && <div className="err-text">{err}</div>}
				<button className="btn" type="submit" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
			</form>
		</div>
	);
}

export function Shell({ user, children, title, crumb, actions, onSwitchDashboard, onLogout }) {
	const [drawer, setDrawer] = useState(false);
	const navigate = useNavigate();
	useEscape(() => setDrawer(false));
	// Focus trap hanya saat drawer mobile terbuka — desktop sidebar statis.
	const drawerRef = useFocusTrap(drawer);
	// Drawer mobile harus menutup saat pindah halaman — dulu tetap terbuka
	// menutupi konten (bug "sidebar tidak ikut pindah page").
	const closeDrawer = () => setDrawer(false);
	useEffect(closeDrawer, [title]);

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
				<span className="icon" aria-hidden><IconGrid /></span> Ringkasan
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
			<a href="/docs/" target="_blank" rel="noreferrer" title="Dokumentasi API untuk developer">
				<span className="icon" aria-hidden><IconLink /></span> Dokumentasi API
			</a>
		</nav>
	);

	const sidebar = (
		<aside ref={drawer ? drawerRef : undefined} className={`sidebar ${drawer ? "open" : ""}`} aria-hidden={!drawer ? undefined : false}>
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
					<small>{user?.email}</small>
				</div>
				{onSwitchDashboard && (
					<button onClick={onSwitchDashboard} title="Pindah ke dashboard lain">Ganti</button>
				)}
				<button onClick={logout}>Keluar</button>
			</div>
		</aside>
	);

	return (
		<div className="shell">
			{sidebar}
			{drawer && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
			<div className="content">
				<header className="topbar">
					<div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
						<button className="menu-btn" aria-label="Buka menu" onClick={() => setDrawer(true)}>
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
						<span className="sys-pill" aria-hidden="true"><span className="dot" /> Sistem aktif</span>
						{actions}
					</div>
				</header>
				<main className="page">{children}</main>
			</div>
		</div>
	);
}
