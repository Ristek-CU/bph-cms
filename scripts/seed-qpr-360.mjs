#!/usr/bin/env node
/**
 * Seed satu periode QPR 360° (matriks v5) lengkap dengan roster pengurus SGA.
 *
 * Semua divisi dipetakan ke slug kanonis yang SUDAH ada di tabel `divisions`
 * (seed migration 0001) — tidak ada divisi/slug baru yang dibuat:
 *
 *   Executive Board                     -> bph
 *   Media and Information               -> media
 *   Research and Technology             -> ristek
 *   Public and Community Relations      -> pr
 *   Student Societies                   -> ukm
 *   Business and Partnership            -> bnp
 *   Intellectual and Career Development -> icd
 *   Student Advocacy and Welfare        -> advo
 *
 * Pemakaian:
 *   node scripts/seed-qpr-360.mjs
 *   node scripts/seed-qpr-360.mjs --base http://localhost:8791
 *   node scripts/seed-qpr-360.mjs --title "QPR 360 Periode Lain"
 *   node scripts/seed-qpr-360.mjs --recreate   # hapus periode judul sama (bila belum ada respons)
 *
 * Idempoten: bila periode dengan judul sama sudah ada, script berhenti dengan
 * pesan jelas (atau membuat ulang bila --recreate dan belum ada respons final).
 */

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] ?? fallback : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = (flag("base", "http://localhost:8791") || "").replace(/\/$/, "");
const EMAIL = flag("email", "bph@cakrawala.com");
const PASSWORD = flag("password", "fixture-password");
const TITLE = flag("title", "QPR 360° Pengurus SGA 2026/2027");
const RECREATE = has("recreate");

// ── Rubrik matriks v5 ───────────────────────────────────────────────────────
// Periode dibuat dengan instrumen KOSONG: BPH menyusun pasangan penilai →
// target dan pertanyaannya sendiri di editor matriks panel.
const INSTRUMENTS = [];

// ── Roster ──────────────────────────────────────────────────────────────────
// `manages` hanya untuk controller (divisi yang diurus). Urutan baris mengikuti
// daftar BPH; dropdown publik sendiri diurutkan abjad oleh server.
const divisions = {
	eb: "bph",
	media: "media",
	ristek: "ristek",
	pr: "pr",
	ukm: "ukm",
	bnp: "bnp",
	icd: "icd",
	advo: "advo",
};

const ROSTER = [
	// Executive Board
	["Aguini Providensia Tjandra", divisions.eb, "president"],
	["Aldridge Mika Gunawan", divisions.eb, "vice_president"],
	["Firaas Andaru Athaa Ramadhan", divisions.eb, "controller", ["ukm", "pr"]],
	["Vania", divisions.eb, "controller", ["advo", "bnp"]],
	["Vincensius Anthony", divisions.eb, "controller", ["ristek"]],
	["Nyssa Mutiara Syakieb", divisions.eb, "controller", ["media", "icd"]],
	["Marshelinda Rukmana", divisions.eb, "sekum"],
	["Raihan Firdaus Hadi Saputra", divisions.eb, "sekum"],
	["Fatimah Tri Lestari", divisions.eb, "bendum"],
	["Atikah Nurfatkiyah", divisions.eb, "bendum"],

	// Media and Information
	["Dita Wilia Wardah", divisions.media, "kadiv"],
	["Estrella Illda Meisya", divisions.media, "wakadiv"],
	["Anisa Ayu Listiani", divisions.media, "sekdiv"],
	["Aulia Ajeng Ramadhani", divisions.media, "bendiv"],
	["M. Fazril", divisions.media, "anggota"],
	["Royhan Sidqi Almutta Ali", divisions.media, "anggota"],
	["Katharina Ayesha Lintang Marchariyalya", divisions.media, "anggota"],
	["Aisha Omar Hussen Alamodi", divisions.media, "anggota"],
	["Dian Monik Rosita", divisions.media, "anggota"],
	["Linggar Fahlevi", divisions.media, "anggota"],
	["Farlencia Kayla Anggraeni", divisions.media, "anggota"],
	["Nailendra Noeza Sahira", divisions.media, "anggota"],
	["Andrew Farrelino Afdinal", divisions.media, "anggota"],

	// Research and Technology
	["Yaa Siin", divisions.ristek, "kadiv"],
	["Andi Fauzan", divisions.ristek, "wakadiv"],
	["Qonita Putri Amalia Firdausah", divisions.ristek, "sekdiv"],
	["Kanaya Anantani Syafikri", divisions.ristek, "bendiv"],
	["Robby Fabian", divisions.ristek, "anggota"],
	["Muhamad Rizki", divisions.ristek, "anggota"],
	["Ivander Daniel Napitupulu", divisions.ristek, "anggota"],
	["Muhammad Salman Firdaus", divisions.ristek, "anggota"],
	["Mohamad Rafli Ramadhan", divisions.ristek, "anggota"],
	["Faza Qinthoro", divisions.ristek, "anggota"],
	["Novendy Farhanudin", divisions.ristek, "anggota"],
	["Satrio Lehandika Putra", divisions.ristek, "anggota"],

	// Public and Community Relations
	["Muhammad Aurel Luneto", divisions.pr, "kadiv"],
	["Thalita Nurul Fauzan", divisions.pr, "wakadiv"],
	["Iqbal Azhari Pasaribu", divisions.pr, "sekdiv"],
	["Az Zahra Nabila", divisions.pr, "bendiv"],
	["Orentscia Januiver S", divisions.pr, "anggota"],
	["Muhammad Afiq Aqhdaq", divisions.pr, "anggota"],
	["Kayla Azwa Nasifa", divisions.pr, "anggota"],
	["Melsiano Rafi Anggara", divisions.pr, "anggota"],
	["Refa Maharani Imaniar", divisions.pr, "anggota"],
	["Ursulla Ningtyas Kirey", divisions.pr, "anggota"],
	["Zahir Ali Izzaturrahman", divisions.pr, "anggota"],
	["Diva Almadea Vasya", divisions.pr, "anggota"],

	// Student Societies
	["Sachiko Alexandra Zaida Kendra", divisions.ukm, "kadiv"],
	["Nayla Affiyah Syafini", divisions.ukm, "wakadiv"],
	["Askia Fazila Pasha", divisions.ukm, "sekdiv"],
	["Nasywa Najiyah", divisions.ukm, "bendiv"],
	["Tasyel Triajanisya", divisions.ukm, "anggota"],
	["Aileen Alvina Fahrudin", divisions.ukm, "anggota"],
	["Muhammad Saiful Rohim", divisions.ukm, "anggota"],
	["Alfhie Marsya Ayudannie", divisions.ukm, "anggota"],

	// Business and Partnership
	["Rakha Ariya Pratama", divisions.bnp, "kadiv"],
	["Muhammad Rakah Yansyah", divisions.bnp, "wakadiv"],
	["Rahmadsyah Firdaus", divisions.bnp, "sekdiv"],
	["Muhammad Luthfie Alfathin", divisions.bnp, "anggota"],
	["Farrel Abda Aghazka", divisions.bnp, "anggota"],
	["Fityah Najwa S.", divisions.bnp, "anggota"],
	["Adelaide Dione Griselda Kean", divisions.bnp, "anggota"],
	["Adinda Azka. F", divisions.bnp, "anggota"],
	["Muhammad Radja Fadhlurrohman", divisions.bnp, "anggota"],
	["Aris Irhamni A. P", divisions.bnp, "anggota"],
	["Laudya Pricilla Putri", divisions.bnp, "anggota"],
	["Vanesa Delova", divisions.bnp, "anggota"],
	["Aulia Barokah Khaerani", divisions.bnp, "anggota"],
	["Xaverius Pinontoan", divisions.bnp, "anggota"],

	// Intellectual and Career Development
	["Uswatun Hasanah", divisions.icd, "kadiv"],
	["Azka Abdillah", divisions.icd, "wakadiv"],
	["Alya Mutiara Lattifa", divisions.icd, "sekdiv"],
	["Wandasari Tunggul Hadi Kusumo Astuti", divisions.icd, "bendiv"],
	["Nadia Katerina", divisions.icd, "anggota"],
	["Yusuf Nugroho", divisions.icd, "anggota"],
	["Defa Luna", divisions.icd, "anggota"],
	["Tiara Putri Ramadhani", divisions.icd, "anggota"],
	["Yolanda Viviani", divisions.icd, "anggota"],
	["Nabila Aprilia", divisions.icd, "anggota"],
	["Stepanus Teo", divisions.icd, "anggota"],
	["Murni Agustina Andini", divisions.icd, "anggota"],
	["Seva Ayu Rocintia Bella", divisions.icd, "anggota"],
	["Debora Dwi Putri Hutasoit", divisions.icd, "anggota"],
	["Leroy Christopher Gerson", divisions.icd, "anggota"],

	// Student Advocacy and Welfare
	["Mohammad Thareq Ziyad", divisions.advo, "kadiv"],
	["Rifqi Khairan Kamal", divisions.advo, "wakadiv"],
	["Jauzaa Gina Nabilla", divisions.advo, "sekdiv"],
	["Zaskia Claudya Yasmin", divisions.advo, "bendiv"],
	["Farhan Athalla Azis", divisions.advo, "anggota"],
	["Ainun Kholishah", divisions.advo, "anggota"],
	["Andhika Putri Lestari", divisions.advo, "anggota"],
	["Diva Nabilla", divisions.advo, "anggota"],
	["Moh. Rama Saputra", divisions.advo, "anggota"],
	["Rafli Ramdhan Pratama", divisions.advo, "anggota"],
	["Adisty Kayla Putri", divisions.advo, "anggota"],
];

// ── HTTP helper ─────────────────────────────────────────────────────────────
let token = "";

const request = async (path, { method = "GET", json } = {}) => {
	const headers = { Origin: BASE };
	if (token) headers.Authorization = `Bearer ${token}`;
	if (json !== undefined) headers["Content-Type"] = "application/json";
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers,
		...(json !== undefined && method !== "GET" ? { body: JSON.stringify(json) } : {}),
	});
	const text = await res.text();
	let body;
	try { body = text ? JSON.parse(text) : null; } catch { body = text; }
	if (!res.ok) {
		const detail = body?.error?.message || body?.error || text;
		const extra = body?.error?.details ? ` ${JSON.stringify(body.error.details)}` : "";
		throw new Error(`${method} ${path} -> ${res.status}: ${detail}${extra}`);
	}
	return body;
};

const assertLocal = () => {
	const host = new URL(BASE).hostname;
	if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) {
		throw new Error(`Script ini hanya untuk server lokal, bukan ${BASE}.`);
	}
};

// ── Alur ────────────────────────────────────────────────────────────────────
const main = async () => {
	assertLocal();

	const signIn = await request("/api/v1/auth/sign-in", {
		method: "POST",
		json: { email: EMAIL, password: PASSWORD },
	});
	token = signIn?.data?.token ?? "";
	if (!token) throw new Error("Login tidak mengembalikan token.");
	console.log(`✓ Login sebagai ${EMAIL}`);

	const list = await request("/api/v1/admin/qpr/periods");
	const existing = (list?.data ?? []).find((p) => p.title === TITLE);
	let periodId;

	if (existing) {
		if (!RECREATE) {
			console.error(`\nPeriode "${TITLE}" sudah ada (id ${existing.id}).`);
			console.error(`Jalankan dengan --recreate untuk membuat ulang, atau --title "..." untuk judul lain.`);
			process.exitCode = 1;
			return;
		}
		await request(`/api/v1/admin/qpr/periods/${existing.id}`, { method: "DELETE" });
		console.log(`✓ Periode lama "${TITLE}" dihapus`);
	}

	const created = await request("/api/v1/admin/qpr/periods", {
		method: "POST",
		json: {
			title: TITLE,
			description: "Penilaian 360° seluruh pengurus SGA: atasan, bawahan, dan rekan kerja.",
			form_kind: "division",
			division_slug: null,
			instruments: INSTRUMENTS,
		},
	});
	periodId = created?.data?.id;
	if (!periodId) throw new Error("Periode dibuat tapi tanpa id.");
	console.log(`✓ Periode dibuat: ${periodId}`);

	const entries = ROSTER.map(([name, division_slug, role, manages]) => ({
		name,
		division_slug,
		role,
		...(manages ? { manages } : {}),
	}));

	const added = await request(`/api/v1/admin/qpr/periods/${periodId}/entries`, {
		method: "POST",
		json: { entries },
	});
	console.log(`✓ ${added?.data?.length ?? entries.length} nama pengisi ditambahkan`);

	// Verifikasi roster (bukan kelengkapan pertanyaan — matriks sengaja kosong).
	const preview = await request(`/api/v1/admin/qpr/periods/${periodId}/preview`);
	const blockers = preview?.data?.blockers ?? [];
	const rosterBlockers = blockers.filter((b) => /Roster|Controller|jabatan|divisi belum|President|Vice President/.test(b));
	if (rosterBlockers.length) {
		console.error("\n✗ Roster belum valid:");
		for (const b of rosterBlockers) console.error(`  - ${b}`);
		process.exitCode = 1;
		return;
	}
	console.log(`✓ Roster valid; ${blockers.length - rosterBlockers.length} penanda pertanyaan belum diisi (normal untuk matriks kosong)`);

	const perDivision = new Map();
	for (const row of ROSTER) {
		perDivision.set(row[1], (perDivision.get(row[1]) ?? 0) + 1);
	}
	const label = { bph: "Executive Board", media: "Media and Information", ristek: "Research and Technology", pr: "Public and Community Relations", ukm: "Student Societies", bnp: "Business and Partnership", icd: "Intellectual and Career Development", advo: "Student Advocacy and Welfare" };

	console.log("\nRingkasan roster:");
	for (const [slug, count] of perDivision) console.log(`  ${label[slug].padEnd(34)} ${slug.padEnd(7)} ${count} orang`);
	console.log(`  ${"TOTAL".padEnd(34)} ${"".padEnd(7)} ${ROSTER.length} orang`);

	const perRole = new Map();
	for (const [, , role] of ROSTER) perRole.set(role, (perRole.get(role) ?? 0) + 1);
	console.log("\nRingkasan jabatan:");
	for (const [role, count] of perRole) console.log(`  ${role.padEnd(16)} ${count} orang`);

	console.log(`\n✓ Selesai. Buka workspace: ${BASE}/#/qpr/periods/${periodId}`);
	console.log(`  Link publik (setelah "Buka kampanye"): ${BASE}/#/qpr/${periodId}`);
	console.log("  Pertanyaan belum diisi: susun instrumen penilai → target di tab Pertanyaan.");
};

main().catch((error) => {
	console.error(`\n✗ ${error.message}`);
	process.exitCode = 1;
});
