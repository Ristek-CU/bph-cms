import { useCallback, useEffect, useState } from "react";
import { api, errText } from "../api.js";
import { useToast, SkeletonCard, ErrorState } from "../components/ui.jsx";

const ROLES = [
	["platform_admin", "Platform Admin"],
	["division_admin", "Admin Divisi"],
	["contributor", "Contributor"],
	["viewer", "Viewer"],
];

// Kelola akun + divisi + audit log (hanya platform_admin — di-gate permission
// backend accounts.manage / audit.read, link sidebar di-gate di Shell).
export default function Accounts({ permissions = [] }) {
	const canManage = permissions.includes("accounts.manage");
	const canAudit = permissions.includes("audit.read");
	const [tab, setTab] = useState(canManage ? "accounts" : "audit");
	return <>
		<div className="page-intro"><h2>Akses tim, tertata.</h2><p>Kelola keanggotaan, divisi, dan riwayat aktivitas pengurus.</p></div>
		<div className="toolbar" aria-label="Bagian pengelolaan akun">
			{[["accounts", "Akun", canManage], ["divisions", "Divisi", canManage], ["audit", "Audit log", canAudit]].filter((t) => t[2]).map(([id, label]) => <button key={id} className={`chip ${tab === id ? "active" : ""}`} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
		</div>
		{tab === "accounts" && canManage && <AccountsTab />}
		{tab === "divisions" && canManage && <DivisionsTab />}
		{tab === "audit" && canAudit && <AuditTab />}
	</>;
}

function AccountsTab() {
	const toast = useToast();
	const [rows, setRows] = useState(null);
	const [divisions, setDivisions] = useState([]);
	const [err, setErr] = useState("");
	const [form, setForm] = useState({ user_id: "", user_email: "", division_id: "", role: "contributor" });
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			setRows(await api("/admin/accounts"));
			setDivisions(await api("/admin/divisions"));
			setErr("");
		} catch (e) {
			setErr(errText(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const create = async (e) => {
		e.preventDefault();
		setBusy(true);
		try {
			await api("/admin/accounts", { method: "POST", json: form });
			toast("Membership dibuat.");
			setForm({ user_id: "", user_email: "", division_id: "", role: "contributor" });
			await load();
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setBusy(false);
		}
	};

	if (err) return <ErrorState message={err} onRetry={load} />;
	if (rows === null) return <SkeletonCard />;

	return (
		<div style={{ display: "grid", gap: 16 }}>
			<div className="card">
				<h3 style={{ marginBottom: 10 }}>Tambah membership</h3>
				<p className="muted small" style={{ marginBottom: 10 }}>
					Tambahkan pengurus yang sudah memiliki akun Superapp, lalu pilih divisi dan hak aksesnya.
				</p>
				<form onSubmit={create} className="grid-2">
					<div>
						<label className="field-label" htmlFor="acc-uid">User ID</label>
						<input id="acc-uid" value={form.user_id} onChange={(e) => setForm({ ...form, user_id: e.target.value })} required />
					</div>
					<div>
						<label className="field-label" htmlFor="acc-email">Email</label>
						<input id="acc-email" type="email" value={form.user_email} onChange={(e) => setForm({ ...form, user_email: e.target.value })} required />
					</div>
					<div>
						<label className="field-label" htmlFor="acc-div">Divisi</label>
						<select id="acc-div" value={form.division_id} onChange={(e) => setForm({ ...form, division_id: e.target.value })} required>
							<option value="" disabled>Pilih divisi…</option>
							{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
						</select>
					</div>
					<div>
						<label className="field-label" htmlFor="acc-role">Role</label>
						<select id="acc-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
							{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
						</select>
					</div>
					<button className="btn gold" type="submit" disabled={busy || !form.user_id.trim() || !form.division_id}>
						{busy ? "Menyimpan…" : "Tambah membership"}
					</button>
				</form>
			</div>
			<div className="card">
				<h3 style={{ marginBottom: 10 }}>Akun ({rows.length})</h3>
				{rows.length === 0 ? (
					<p className="muted">Belum ada membership.</p>
				) : (
					<div className="tbl-wrap">
						<table className="tbl">
						<thead><tr><th>Email</th><th>Divisi</th><th>Role</th><th>Status</th><th>Dibuat</th></tr></thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.id}>
									<td>{r.user_email}</td>
									<td>{r.division?.name ?? "—"}</td>
									<td><span className="badge">{ROLES.find(([v]) => v === r.role)?.[1] ?? r.role}</span></td>
									<td>{r.status}</td>
									<td className="muted">{new Date(r.created_at).toLocaleDateString("id-ID")}</td>
								</tr>
							))}
						</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}

function DivisionsTab() {
	const toast = useToast();
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");
	const [form, setForm] = useState({ slug: "", name: "", email: "" });
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			setRows(await api("/admin/divisions"));
			setErr("");
		} catch (e) {
			setErr(errText(e));
		}
	}, []);
	useEffect(() => {
		load();
	}, [load]);

	const create = async (e) => {
		e.preventDefault();
		setBusy(true);
		try {
			await api("/admin/divisions", { method: "POST", json: { ...form, email: form.email || null } });
			toast("Divisi dibuat.");
			setForm({ slug: "", name: "", email: "" });
			await load();
		} catch (e2) {
			toast(errText(e2), "err");
		} finally {
			setBusy(false);
		}
	};

	if (err) return <ErrorState message={err} onRetry={load} />;
	if (rows === null) return <SkeletonCard />;

	return (
		<div style={{ display: "grid", gap: 16 }}>
			<div className="card">
				<h3 style={{ marginBottom: 10 }}>Divisi baru</h3>
				<form onSubmit={create} className="grid-2">
					<div>
						<label className="field-label" htmlFor="div-slug">Slug</label>
						<input id="div-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="ristek" required />
					</div>
					<div>
						<label className="field-label" htmlFor="div-name">Nama</label>
						<input id="div-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Riset & Teknologi" required />
					</div>
					<div>
						<label className="field-label" htmlFor="div-email">Email (opsional)</label>
						<input id="div-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
					</div>
					<button className="btn gold" type="submit" disabled={busy || !form.slug.trim() || !form.name.trim()}>
						{busy ? "Menyimpan…" : "Buat divisi"}
					</button>
				</form>
			</div>
			<div className="card">
				<h3 style={{ marginBottom: 10 }}>Divisi ({rows.length})</h3>
				<div className="tbl-wrap">
					<table className="tbl">
					<thead><tr><th>Nama</th><th>Slug</th><th>Email</th><th>Aktif</th></tr></thead>
					<tbody>
						{rows.map((d) => (
							<tr key={d.id}>
								<td>{d.name}</td>
								<td className="muted">/{d.slug}</td>
								<td>{d.email || "—"}</td>
								<td>{d.is_active ? "Ya" : "Tidak"}</td>
							</tr>
						))}
					</tbody>
					</table>
				</div>
			</div>
		</div>
	);
}

function AuditTab() {
	const [rows, setRows] = useState(null);
	const [err, setErr] = useState("");

	const load = useCallback(() => {
		setErr("");
		api("/admin/audit-logs").then((d) => setRows(d.items || d || [])).catch((e) => setErr(errText(e)));
	}, []);
	useEffect(() => { load(); }, [load]);
	if (err) return <ErrorState message={err} onRetry={load} />;
	if (rows === null) return <SkeletonCard />;

	return (
		<div className="card">
			<h3 style={{ marginBottom: 10 }}>Audit Log (50 terbaru)</h3>
			{rows.length === 0 ? (
				<p className="muted">Belum ada aktivitas.</p>
			) : (
				<div className="tbl-wrap">
					<table className="tbl">
					<thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Resource</th><th>IP</th></tr></thead>
					<tbody>
						{rows.map((l) => (
							<tr key={l.id}>
								<td className="muted">{new Date(l.created_at).toLocaleString("id-ID")}</td>
								<td>{l.actor_email || l.actor_user_id || "—"}</td>
								<td><span className="badge">{l.action}</span></td>
								<td className="muted">{l.resource_type}{l.resource_id ? ` · ${l.resource_id.slice(0, 8)}` : ""}</td>
								<td className="muted">{l.ip_address || "—"}</td>
							</tr>
						))}
					</tbody>
					</table>
				</div>
			)}
		</div>
	);
}
