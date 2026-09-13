import { useEffect } from "react";
import { useEscape, useFocusTrap } from "./ui.jsx";

// Overlay pemilihan dashboard. Tampil HANYA saat login baru atau saat user
// menekan "Ganti" — bukan tiap refresh (root-cause fix navigation reset).
// onCancel ditutup user dapat membatalkan (bila tidak ada handoff berjalan).
export default function WorkspaceModal({ workspaces, onSelect, busy = false, error = "", onCancel }) {
	useEscape(() => !busy && onCancel?.());
	const modalRef = useFocusTrap(true);

	// Escape / klik backdrop = kembali ke app yang sudah terbuka di belakang.
	const cancellable = !busy && !!onCancel;

	return (
		<div className="modal-backdrop ws-backdrop" onClick={cancellable ? onCancel : undefined}>
			<div ref={modalRef} className="modal ws-modal" tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Pilih Dashboard">
				<div className="ws-head">
					<h3>Selamat datang 👋</h3>
					<p>Pilih ruang kerja yang ingin dibuka. Kamu bisa berpindah kapan saja lewat tombol "Ganti".</p>
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
							className="ws-card"
							disabled={busy}
							onClick={() => onSelect(ws)}
						>
							<span className={`ws-icon ${ws.kind === "cms_hub" ? "hub" : "ext"}`} aria-hidden>
								{ws.kind === "cms_hub" ? "SGA" : "↗"}
							</span>
							<span className="ws-body">
								<span className="ws-label">{ws.label}</span>
								<span className="ws-desc">
									{busy
										? "Menyiapkan handoff…"
										: ws.kind === "cms_hub"
											? "Kelola event, form, dan QPR lintas divisi."
											: "Buka dashboard eksternal khusus divisi."}
								</span>
							</span>
							<span className="ws-arrow" aria-hidden>→</span>
						</button>
					))}
				</div>
				{cancellable && (
					<button className="btn ghost ws-cancel" onClick={onCancel}>
						Lanjut ke dashboard saat ini
					</button>
				)}
			</div>
		</div>
	);
}
