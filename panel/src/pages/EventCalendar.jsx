import Calendar from "../components/Calendar.jsx";

export default function EventCalendar({ events, onEdit }) {
	return <Calendar events={events} onEdit={onEdit} />;
}
