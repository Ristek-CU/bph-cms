import { NavLink } from "react-router-dom";
import { IconCalendar } from "./Icons.jsx";

export default function InternalEventNav() {
	return <nav className="mod-tabs" aria-label="Tampilan event internal">
		<NavLink end to="/internal-events" className={({ isActive }) => `chip ${isActive ? "active" : ""}`}>Daftar</NavLink>
		<NavLink to="/internal-events/kalender" className={({ isActive }) => `chip ${isActive ? "active" : ""}`}><IconCalendar size={16} /> Kalender lintas divisi</NavLink>
	</nav>;
}
