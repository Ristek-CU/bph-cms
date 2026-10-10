import InternalEventNav from "../components/InternalEventNav.jsx";
import InternalEventList from "./InternalEventList.jsx";

// Tab modul Event Internal: Daftar | Kalender. Kalender lintas divisi adalah
// view dari data yang sama — makanya digabung di sini, bukan modul sendiri
// (satu domain data, satu pintu masuk).
export default function InternalEventTabs({ user, capabilities }) {
	return (
		<>
			<InternalEventNav />
			<InternalEventList user={user} capabilities={capabilities} />
		</>
	);
}
