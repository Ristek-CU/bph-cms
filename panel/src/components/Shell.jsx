import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "../api.js";
import { useEscape } from "./ui.jsx";
import { IconCalendar, IconClipboard, IconGrid, IconLink, IconMenu } from "./Icons.jsx";

// Logomark SGA Cakrawala — outline putih transparan (dari landing page).
import logoSga from "/logo-sga.webp";

// Hash routing — panel di-host sebagai aset Worker, tanpa rewrite tambahan.
export const href = (path) => `#${path}`;

export function Login({ onLogin }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
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
						<h1>CMS BPH</h1>
						<small className="sub" style={{ color: "var(--muted)" }}>
							SGA Cakrawala · Panel Pengurus
						</small>
					</div>
				</div>
				<label className="field-label" htmlFor="email">Email</label>
				<input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
				<label className="field-label" htmlFor="password">Password</label>
				<input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
				{err && <div className="err-text">{err}</div>}
				<button className="btn" type="submit" disabled={busy}>{busy ? "Memeriksa…" : "Masuk"}</button>
			</form>
		</div>
	);
}

export function Shell({ user, children, title, crumb, actions }) {
	const [drawer, setDrawer] = useState(false);
	const navigate = useNavigate();
	useEscape(() => setDrawer(false));

	const logout = () => {
		clearToken();
		navigate("/login", { replace: true });
	};

	const initials = (user?.name || user?.email || "?")
		.split(/\s+/)
		.map((w) => w[0])
		.slice(0, 2)
		.join("")
		.toUpperCase();

	const nav = (
		<nav className="nav" aria-label="Modul">
			<NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconGrid /></span> Ringkasan
			</NavLink>
			<NavLink to="/events" className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconCalendar /></span> Event
			</NavLink>
			<NavLink to="/qpr" className={({ isActive }) => (isActive ? "active" : "")}>
				<span className="icon" aria-hidden><IconClipboard /></span> QPR <span className="soon">SEGERA</span>
			</NavLink>
			<div className="nav-sep" />
			<a href="/docs/" target="_blank" rel="noreferrer" title="Dokumentasi API untuk developer">
				<span className="icon" aria-hidden><IconLink /></span> Dokumentasi API
			</a>
		</nav>
	);

	const sidebar = (
		<aside className={`sidebar ${drawer ? "open" : ""}`}>
			<div className="brand">
				<img className="brand-logo-img" src={logoSga} alt="Logo SGA Cakrawala" />
				<div>
					<strong>CMS BPH</strong>
					<small>SGA Cakrawala</small>
				</div>
			</div>
			{nav}
			<div className="userbox">
				<div className="avatar" aria-hidden>{initials}</div>
				<div className="meta">
					<div>{user?.name || "Pengurus"}</div>
					<small>{user?.email}</small>
				</div>
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
							{crumb && <div className="crumb">{crumb}</div>}
						</div>
					</div>
					<div className="topbar-actions">{actions}</div>
				</header>
				<main className="page">{children}</main>
			</div>
		</div>
	);
}
