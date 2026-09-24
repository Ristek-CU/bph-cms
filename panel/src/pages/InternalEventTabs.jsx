import { NavLink } from "react-router-dom";
import InternalEventList from "./InternalEventList.jsx";

// Tab modul Event Internal: Daftar | Kalender. Kalender lintas divisi adalah
// view dari data yang sama — makanya digabung di sini, bukan modul sendiri
// (satu domain data, satu pintu masuk).
export default function InternalEventTabs({ user, capabilities }) {
	return (
		<>
			<div className="mod-tabs" role="tablist" aria-label="Tampilan event internal">
				<NavLink end to="/internal-events" className={({ isActive }) => `chip ${isActive ? "active" : ""}`} role="tab" aria-selected={undefined}>
					Daftar
				</NavLink>
				<NavLink to="/internal-events/kalender" className={({ isActive }) => `chip ${isActive ? "active" : ""}`} role="tab">
					<CalendarIcon /> Kalender lintas divisi
				</NavLink>
			</div>
			<InternalEventList user={user} capabilities={capabilities} />
		</>
	);
}

function CalendarIcon() {
	return <span aria-hidden style={{ marginRight: 4 }}>📅</span>;
}
