// Test UI QPR v2 — form publik bertahap (pilih nama → draft autosave → submit).
// Mock API per pattern ui.spec.js. Run: npm --prefix panel run test:ui -- qpr-fill.spec.js
import { test, expect } from '@playwright/test';

const SCALE_QUESTIONS = Array.from({ length: 20 }, (_, i) => ({
	id: `ketum-s${String(i + 1).padStart(2, '0')}`,
	type: 'scale',
	label: `Pertanyaan skala ${i + 1} untuk Ketua Umum?`,
	required: true,
}));
const TEXT_QUESTIONS = [
	{ id: 'ketum-t01', type: 'text', label: 'Apa saran untuk Ketua Umum?', required: true },
];
// Anggota: hanya ketum + waketum, 44 wajib — mock ringkas: 20 skala + 1 teks saja
// untuk melihat perilaku UI; jumlah wajib dari server dipercaya UI.
const V2_ROSTER = {
	id: 'period-v2',
	title: 'QPR BPH Oktober 2026',
	description: 'Penilaian pengurus BPH',
	status: 'open',
	remaining: [
		{ id: 'entry-1', name: 'Nadia', division: 'Ristek' },
		{ id: 'entry-2', name: 'Fauzan', division: 'UKM' },
	],
	questions: {
		version: 2,
		sections: [
			{ id: 'section-ketum', title: 'Ketua Umum', targetId: 'ketum', questions: [...SCALE_QUESTIONS, ...TEXT_QUESTIONS] },
		],
	},
};

async function setup(page, draft = [], version = 0) {
	await page.addInitScript(() => {
		sessionStorage.setItem('bph_cms_token', 'panel-session');
		// Maintenance wall mati untuk test (Qpr.jsx baca flag ini saat modul load).
		window.__QPR_MAINTENANCE__ = false;
	});
	await page.route('**/api/v1/**', (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace('/api/v1', '');
		const method = route.request().method();
		const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data: body }) });
		if (path === '/qpr/period-v2') return reply(V2_ROSTER);
		if (path === '/qpr/period-v2/entries/entry-1/draft' && method === 'GET')
			return reply({
				entry: { id: 'entry-1', name: 'Nadia', division: 'Ristek' },
				sections: V2_ROSTER.questions.sections,
				questions: [...SCALE_QUESTIONS, ...TEXT_QUESTIONS],
				draft,
				draft_version: version,
				progress: { required: 21, filled: draft.length, next_question_id: 'ketum-s01' },
				scale_legend: { 1: 'Sangat Kurang', 2: 'Kurang', 3: 'Cukup', 4: 'Baik', 5: 'Sangat Baik' },
			});
		if (path === '/qpr/period-v2/entries/entry-1/draft' && method === 'PUT') {
			const body = route.request().postDataJSON();
			if (body.expected_version !== version) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Konflik versi' }) });
			return reply({ draft_version: version + 1, saved_at: '2026-10-05T00:00:00Z' });
		}
		if (path === '/qpr/period-v2/submit-v2') return reply({ entry_id: 'entry-1', name: 'Nadia' });
		return reply({});
	});
}

test('pilih nama memuat draft dan autosave berjalan', async ({ page }) => {
	await setup(page, [{ question_id: 'ketum-s01', value: 4 }], 1);
	await page.goto('/#/qpr/period-v2');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await expect(page.getByText('Mengisis sebagai').or(page.getByText('Mengisi sebagai'))).toBeVisible();
	// Draft lama terbaca: radio pertama tercentang 4
	await expect(page.getByRole('radio', { name: /^4 — Baik/ }).first()).toBeChecked();
	// Ubah jawaban → autosave (PUT dengan expected_version 1)
	await page.getByRole('radio', { name: /^5 — Sangat Baik/ }).first().click();
	await expect(page.getByText('Tersimpan')).toBeVisible({ timeout: 4000 });
});

test('ganti nama mengisolasi state dan konflik CAS tidak menimpa', async ({ page }) => {
	// setup dulu (mock umum), lalu PUT dioverride selalu 409 — konflik paksa.
	await setup(page, [], 0);
	await page.route('**/api/v1/qpr/period-v2/entries/entry-1/draft', (route) => {
		if (route.request().method() === 'PUT')
			return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Konflik versi' }) });
		return route.fallback();
	});
	await page.goto('/#/qpr/period-v2');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await page.getByRole('radio', { name: /^2 — Kurang/ }).first().click();
	await expect(page.getByText('Gagal tersimpan — versi berubah')).toBeVisible({ timeout: 4000 });
});

test('submit final sukses menampilkan layar terima kasih', async ({ page }) => {
	// Draft lengkap dari server: semua wajib terisi → tombol kirim aktif.
	const draftFull = [...SCALE_QUESTIONS.map((q) => ({ question_id: q.id, value: 4 })), { question_id: 'ketum-t01', value: 'Baik' }];
	await setup(page, draftFull, 3);
	await page.goto('/#/qpr/period-v2');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await page.getByRole('button', { name: 'Kirim penilaian' }).click();
	await expect(page.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
});
