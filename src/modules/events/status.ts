// Status event dihitung server (SDD §4.1) — bukan kolom input admin.
// Zona acuan: Asia/Jakarta. Input/output timestamp: ISO 8601 dengan offset.
// Fungsi pure — dipakai service & ditest di status.test.ts.

export type EventStatus = "ongoing" | "upcoming" | "past";

export const computeStatus = (
	startsAt: string,
	endsAt: string,
	now: number = Date.now(),
): EventStatus => {
	const start = Date.parse(startsAt);
	const end = Date.parse(endsAt);
	if (now >= start && now <= end) return "ongoing";
	if (now < start) return "upcoming";
	return "past";
};
