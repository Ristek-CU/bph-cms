import { createContext, useCallback, useContext, useEffect, useState } from "react";

// ---- Toast ----
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
	const [toasts, setToasts] = useState([]);
	const push = useCallback((msg, kind = "ok") => {
		const id = Math.random();
		setToasts((t) => [...t, { id, msg, kind }]);
		setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
	}, []);
	return (
		<ToastCtx.Provider value={push}>
			{children}
			<div className="toast-wrap">
				{toasts.map((t) => (
					<div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>{t.msg}</div>
				))}
			</div>
		</ToastCtx.Provider>
	);
}

// ---- Modal konfirmasi (pengganti confirm()) ----
export function Confirm({ open, title, children, confirmLabel = "Ya, lanjutkan", danger, onConfirm, onCancel }) {
	if (!open) return null;
	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
				<h3>{title}</h3>
				<p>{children}</p>
				<div className="row-actions">
					<button className="btn ghost" onClick={onCancel}>Batal</button>
					<button className={`btn ${danger ? "danger" : ""}`} onClick={onConfirm} autoFocus>{confirmLabel}</button>
				</div>
			</div>
		</div>
	);
}

// ---- Escape helper untuk drawer/modal ----
export function useEscape(onEscape) {
	useEffect(() => {
		const h = (e) => e.key === "Escape" && onEscape();
		window.addEventListener("keydown", h);
		return () => window.removeEventListener("keydown", h);
	}, [onEscape]);
}
