export default function WorkspaceModal({ workspaces, onSelect, busy = false, error = "" }) {
	return (
		<div className="login-page">
			<div className="login-card" style={{ maxWidth: 440 }}>
				<div style={{ marginBottom: 16 }}>
					<h2 style={{ fontSize: 20, marginBottom: 4 }}>Pilih Dashboard</h2>
					<p className="muted small">
						Akun Anda memiliki beberapa akses dashboard. Silakan pilih ruang kerja yang ingin dibuka.
					</p>
				</div>
				{error && (
					<div className="card err-text" style={{ marginBottom: 12 }} role="alert">
						{error}
					</div>
				)}
				<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
					{workspaces.map((ws, i) => (
						<button
							key={i}
							type="button"
							className="btn"
							disabled={busy}
							style={{
								textAlign: "left",
								justifyContent: "flex-start",
								padding: "12px 14px",
								background: ws.kind === "cms_hub" ? "var(--teal)" : "#0c2836",
								color: "#fff",
								opacity: busy ? 0.6 : 1,
							}}
							onClick={() => onSelect(ws)}
						>
							<div>
								<div style={{ fontWeight: 600 }}>{ws.label}</div>
								<div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
									{busy
										? "Menyiapkan handoff…"
										: ws.kind === "cms_hub"
											? "Kelola event lintas SGA dari Dashboard Terpadu."
											: "Buka dashboard eksternal khusus divisi."}
								</div>
							</div>
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
