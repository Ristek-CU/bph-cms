// Self-check logika status (SDD §9) — assert polos, tanpa framework.
// Run: npm test
import { computeStatus } from "./status";

let passed = 0;
let failed = 0;

const eq = (label: string, actual: unknown, expected: unknown) => {
	if (JSON.stringify(actual) === JSON.stringify(expected)) {
		console.log(`ok  ${label}`);
		passed++;
	} else {
		console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
		failed++;
	}
};

const HOUR = 3600_000;

// Sesi event 10 Sep 08:00 – 11 Sep 17:00 WIB
const S = "2026-09-10T08:00:00+07:00";
const END = "2026-09-11T17:00:00+07:00";
const START = Date.parse(S);
const ENDMS = Date.parse(END);

// Tepat mulai -> ongoing (boundary inclusive: now >= starts_at)
eq("tepat mulai = ongoing", computeStatus(S, END, START), "ongoing");
// Tepat selesai -> ongoing (boundary inclusive: now <= ends_at)
eq("tepat selesai = ongoing", computeStatus(S, END, ENDMS), "ongoing");
// 1ms setelah selesai -> past
eq("1ms setelah selesai = past", computeStatus(S, END, ENDMS + 1), "past");
// 1ms sebelum mulai -> upcoming
eq("1ms sebelum mulai = upcoming", computeStatus(S, END, START - 1), "upcoming");
// Tengah hari pertama -> ongoing
eq("tengah hari pertama = ongoing", computeStatus(S, END, START + 5 * HOUR), "ongoing");
// Lintas tengah hari (01:00 WIB 11 Sep) -> ongoing
eq("lintas tengah hari = ongoing", computeStatus(S, END, START + 17 * HOUR), "ongoing");
// Multi-hari: hari tengah (11 Sep 12:00 WIB) -> ongoing
eq("multi-hari tengah = ongoing", computeStatus("2026-09-10T08:00:00+07:00", "2026-09-12T17:00:00+07:00", Date.parse("2026-09-11T12:00:00+07:00")), "ongoing");
// Upcoming jauh (sehari sebelum)
eq("sehari sebelum = upcoming", computeStatus(S, END, START - 24 * HOUR), "upcoming");
// Offset beda tapi momen sama: event selesai 17:00 WIB, now 17:00+07 = ongoing
eq("offset beda, momen sama = ongoing", computeStatus(S, END, Date.parse("2026-09-11T10:00:00Z")), "ongoing");

if (failed > 0) {
	console.error(`\n${failed} test(s) FAILED, ${passed} passed`);
	process.exit(1);
}
console.log(`\nall ${passed} status checks passed`);
