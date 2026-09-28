import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isoToInput } from "../api.js";
import { useEscape, useFocusTrap } from "./ui.jsx";

const pad = (n) => String(n).padStart(2, "0");
const dateString = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateLabel = (d) => d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

function TimeColumn({ label, count, value, onChange }) {
	const ref = useRef(null);
	useEffect(() => {
		const list = ref.current;
		const selected = list?.querySelector('[aria-pressed="true"]');
		if (selected) list.scrollTop = selected.offsetTop - list.clientHeight / 2 + selected.clientHeight / 2;
	}, [value]);
	const scroll = (direction) => ref.current?.scrollBy({ top: direction * 120, behavior: "smooth" });
	return <div className="picker-time-column">
		<strong>{label}</strong>
		<button type="button" className="btn ghost sm" aria-label={`Gulir ${label.toLowerCase()} ke atas`} onClick={() => scroll(-1)}>▲</button>
		<div ref={ref} className="picker-time-list" role="group" aria-label={label}>
			{Array.from({ length: count }, (_, i) => <button type="button" key={i} aria-label={`${label} ${pad(i)}`} aria-pressed={value === pad(i)} onClick={() => onChange(pad(i))}>{pad(i)}</button>)}
		</div>
		<button type="button" className="btn ghost sm" aria-label={`Gulir ${label.toLowerCase()} ke bawah`} onClick={() => scroll(1)}>▼</button>
	</div>;
}

function PickerDialog({ type, value, onCommit, onClose }) {
	const today = isoToInput(new Date().toISOString());
	const hasDate = type !== "time";
	const hasTime = type !== "date";
	const initialDate = hasDate && value ? value.slice(0, 10) : today.slice(0, 10);
	const initialTime = type === "time" ? value : value.slice(11, 16);
	const [date, setDate] = useState(initialDate);
	const [hour, setHour] = useState(initialTime?.slice(0, 2) || "08");
	const [minute, setMinute] = useState(initialTime?.slice(3, 5) || "00");
	const [month, setMonth] = useState(() => new Date(`${initialDate}T12:00:00`));
	const ref = useFocusTrap(true);
	useEscape(onClose);
	const title = type === "date" ? "Pilih tanggal" : type === "time" ? "Pilih waktu" : "Pilih tanggal dan waktu";
	const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
	const start = new Date(first);
	start.setDate(1 - (first.getDay() + 6) % 7);
	const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12));
	const moveMonth = (delta) => setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1, 12));
	return createPortal(<div className="modal-backdrop" onClick={onClose}>
		<div ref={ref} className="modal datetime-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
			<div className="dlg-head"><h3>{title}</h3><p className="muted small">Waktu Indonesia Barat (WIB)</p></div>
			<div className="dlg-body">
				{hasDate && <div className="picker-calendar">
					<div className="picker-month">
						<button type="button" className="btn ghost sm" aria-label="Bulan sebelumnya" onClick={() => moveMonth(-1)}>‹</button>
						<strong aria-live="polite">{month.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</strong>
						<button type="button" className="btn ghost sm" aria-label="Bulan berikutnya" onClick={() => moveMonth(1)}>›</button>
					</div>
					<div className="picker-days">
						{["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map(d => <span key={d} className="small muted">{d}</span>)}
						{days.map(d => <button type="button" key={dateString(d)} className={d.getMonth() !== month.getMonth() ? "muted" : ""} aria-label={dateLabel(d)} aria-pressed={date === dateString(d)} onClick={() => setDate(dateString(d))}>{d.getDate()}</button>)}
					</div>
				</div>}
				{hasTime && <>
					<p className="field-help">Gulir atau gunakan panah untuk memilih jam dan menit.</p>
					<div className="picker-time">
						<TimeColumn label="Jam" count={24} value={hour} onChange={setHour} />
						<TimeColumn label="Menit" count={60} value={minute} onChange={setMinute} />
					</div>
				</>}
				<div className="picker-footer">
					{hasDate && <button type="button" className="btn ghost sm" onClick={() => { setDate(today.slice(0, 10)); setMonth(new Date(`${today.slice(0, 10)}T12:00:00`)); }}>Hari ini</button>}
					<button type="button" className="btn ghost sm" onClick={() => onCommit("")}>Kosongkan</button>
					<button type="button" className="btn sec sm" onClick={onClose}>Batal</button>
					<button type="button" className="btn sm" onClick={() => onCommit(type === "time" ? `${hour}:${minute}` : type === "date" ? date : `${date}T${hour}:${minute}`)}>Selesai</button>
				</div>
			</div>
		</div>
	</div>, document.body);
}

// Keep native text entry and validation; the calendar button opens an app-owned
// dialog so confirmation and scrolling behave consistently across browsers.
export default function DateTimePicker({ type = "datetime-local", value, onChange, pickerLabel, "data-field-control": _fieldControl, ...props }) {
	const [open, setOpen] = useState(false);
	const action = type === "date" ? "Pilih tanggal" : type === "time" ? "Pilih waktu" : "Pilih tanggal dan waktu";
	return <div className="datetime-control">
		<input {...props} type={type} value={value} onChange={onChange} onClick={(e) => { e.preventDefault(); setOpen(true); }} onKeyDown={(e) => { if (e.key === "ArrowDown" && e.altKey) { e.preventDefault(); setOpen(true); } }} />
		<button type="button" className="btn ghost picker-open" aria-label={`${action}: ${pickerLabel}`} aria-haspopup="dialog" aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(true)}>▦</button>
		{open && <PickerDialog type={type} value={value} onClose={() => setOpen(false)} onCommit={(next) => { onChange({ target: { value: next } }); setOpen(false); }} />}
	</div>;
}
