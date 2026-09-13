import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";

// ---- Toast ----
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

// Counter monotonic — Math.random() bisa duplikat (key React bentrok).
let toastSeq = 0;

export function ToastProvider({ children }) {
	const [toasts, setToasts] = useState([]);
	const push = useCallback((msg, kind = "ok") => {
		const id = ++toastSeq;
		setToasts((t) => [...t, { id, msg, kind }]);
		setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
	}, []);
	return (
		<ToastCtx.Provider value={push}>
			{children}
			<div className="toast-wrap" role="status" aria-live="polite">
				{toasts.map((t) => (
					<div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`} role={t.kind === "err" ? "alert" : undefined}>{t.msg}</div>
				))}
			</div>
		</ToastCtx.Provider>
	);
}

// ---- Modal konfirmasi (pengganti confirm()) ----
// Kartu dasar panel — satu tempat atur radius/padding card (M19). Saat ini
// alias tipis atas div.card (CSS sudah var(--radius)); menerima props standar div.
export function Card({ as: Tag = "div", className = "", style, children, ...rest }) {
	return (
		<Tag className={`card ${className}`.trim()} style={style} {...rest}>
			{children}
		</Tag>
	);
}

export function Confirm({ open, title, children, confirmLabel = "Ya, lanjutkan", danger, onConfirm, onCancel }) {
	const ref = useFocusTrap(open);
	if (!open) return null;
	return (
		<div className="modal-backdrop" onClick={onCancel}>
			<div ref={ref} className="modal" tabIndex={-1} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
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

// ---- Focus trap: fokus tetap di dalam dialog (Tab di-cycle), balik ke elemen
// sebelumnya saat tutup. Dipakai modal + drawer mobile. ----
export function useFocusTrap(active) {
	const ref = useRef(null);
	useEffect(() => {
		if (!active) return;
		const node = ref.current;
		if (!node) return;
		const prev = document.activeElement;
		const focusables = () =>
			Array.from(node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
				.filter((el) => !el.disabled);
		// Fokus awal ke elemen interaktif pertama (atau container).
		(focusables()[0] ?? node).focus?.();
		const onKey = (e) => {
			if (e.key !== "Tab") return;
			const items = focusables();
			if (!items.length) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		node.addEventListener("keydown", onKey);
		return () => {
			node.removeEventListener("keydown", onKey);
			prev?.focus?.();
		};
	}, [active]);
	return ref;
}

// ---- Field: label terasosiasi + help + error (pola Field di EventEditor). ----
export function Field({ label, required, help, error, children }) {
	const id = useId();
	// Anak tunggal elemen form otomatis dapat id + aria-invalid.
	const cloned =
		children && !Array.isArray(children) && children.props
			? cloneElement(children, { id: children.props.id || id, "aria-invalid": error ? true : undefined })
			: children;
	return (
		<div>
			<label className="field-label" htmlFor={cloned?.props?.id}>
				{label} {required && <span className="req">*</span>}
			</label>
			{cloned}
			{help && <p className="field-help">{help}</p>}
			{error && <div className="field-err">{error}</div>}
		</div>
	);
}

// ---- Skeleton loading (ganti teks "Memuat…") ----
export function SkeletonCard({ lines = 3 }) {
	return (
		<div className="card skeleton-card" aria-hidden>
			<SkeletonLine width="40%" />
			{Array.from({ length: lines }, (_, i) => <SkeletonLine key={i} />)}
		</div>
	);
}
export function SkeletonLine({ width }) {
	return <div className="skeleton-line" style={width ? { width } : undefined} />;
}
