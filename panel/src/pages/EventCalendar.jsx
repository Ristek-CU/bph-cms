import Calendar from "../components/Calendar.jsx";

export default function EventCalendar({ events, onEdit, capabilities }) {
	return <Calendar events={events} onEdit={onEdit} capabilities={capabilities} />;
}
