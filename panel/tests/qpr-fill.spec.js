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
	await page.getByLabel('Divisimu').selectOption('Ristek');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await expect(page.getByText('Mengisi sebagai', { exact: false })).toBeVisible();
	// Draft lama terbaca: radio pertama tercentang 4
	await expect(page.getByRole('radio', { name: /^4 — Baik/ }).first()).toBeChecked();
	// Ubah jawaban → autosave (PUT dengan expected_version 1)
	await page.getByRole('radio', { name: /^5 — Sangat Baik/ }).first().click();
	await expect(page.getByText('Tersimpan')).toBeVisible({ timeout: 4000 });
});

test('konflik CAS tidak menimpa draft server', async ({ page }) => {
	// setup dulu (mock umum), lalu PUT dioverride selalu 409 — konflik paksa.
	await setup(page, [], 0);
	await page.route('**/api/v1/qpr/period-v2/entries/entry-1/draft', (route) => {
		if (route.request().method() === 'PUT')
			return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Konflik versi' }) });
		return route.fallback();
	});
	await page.goto('/#/qpr/period-v2');
	await page.getByLabel('Divisimu').selectOption('Ristek');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await page.getByRole('radio', { name: /^2 — Kurang/ }).first().click();
	await expect(page.getByText('Konflik — edit lokal belum tersimpan.', { exact: false })).toBeVisible({ timeout: 4000 });
});

test('submit final sukses menampilkan layar terima kasih', async ({ page }) => {
	// Draft lengkap dari server: semua wajib terisi → tombol kirim aktif.
	const draftFull = [...SCALE_QUESTIONS.map((q) => ({ question_id: q.id, value: 4 })), { question_id: 'ketum-t01', value: 'Baik' }];
	await setup(page, draftFull, 3);
	await page.goto('/#/qpr/period-v2');
	await page.getByLabel('Divisimu').selectOption('Ristek');
	await page.getByLabel('Namamu').selectOption('entry-1');
	await page.getByRole('checkbox', { name: 'Saya sudah meninjau jawaban', exact: false }).check();
	await page.getByRole('button', { name: 'Kirim penilaian' }).click();
	await expect(page.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
});

test('rekap v2 tampil di panel admin dengan distribusi dan tombol ekspor', async ({ page }) => {
	await page.addInitScript(() => {
		sessionStorage.setItem('bph_cms_token', 'panel-session');
	});
	const RECAP = {
		period: { id: 'period-v2', title: 'QPR BPH Oktober 2026', status: 'open', form_kind: 'bph' },
		total_entries: 2,
		done_entries: 1,
		pending: [{ id: 'entry-2', name: 'Fauzan', division: 'UKM', role: null }],
		sections: [
			{
				id: 'section-ketum', title: 'Ketua Umum', target_id: 'ketum', target_label: 'Ketua Umum',
				questions: [
					{ id: 'ketum-s01', type: 'scale', label: 'Pertanyaan skala 1 untuk Ketua Umum?', required: true, responses: 1, distribution: [{ value: 1, count: 0 }, { value: 2, count: 0 }, { value: 3, count: 0 }, { value: 4, count: 1 }, { value: 5, count: 0 }], mean: 4 },
					{ id: 'ketum-t01', type: 'text', label: 'Apa saran untuk Ketua Umum?', required: true, responses: 1, texts: ['Lanjutkan!'] },
				],
			},
		],
	};
	await page.route('**/api/v1/**', (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.replace('/api/v1', '');
		const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: true, data: body }) });
		if (path === '/me') return reply({ can_access_oversight: false, user: { id: 'u-1', name: 'Nadia Putri', email: 'nadia@example.com' }, active_division_id: 'bph', memberships: [{ division: { id: 'bph', slug: 'bph', name: 'BPH' }, role: 'platform_admin', permissions: ['qpr.manage'] }], workspace_options: [] });
		if (path === '/admin/qpr/periods') return reply([{ id: 'period-v2', title: 'QPR BPH Oktober 2026', status: 'open', formKind: 'bph', description: '', total_entries: 2, done_entries: 1, questions: V2_ROSTER.questions }]);
		if (path === '/admin/qpr/periods/period-v2') return reply({ id: 'period-v2', title: 'QPR BPH Oktober 2026', status: 'open', entries: [{ id: 'e1', name: 'Nadia', done: true }, { id: 'e2', name: 'Pengisi lain', done: false }], questions: V2_ROSTER.questions });
		if (path === '/admin/qpr/periods/period-v2/recap-v2') return reply(RECAP);
		return reply({});
	});
	await page.goto('/#/qpr');
	await page.getByRole('link', { name: 'Rekap' }).click();
	await expect(page.getByRole('heading', { name: 'Ketua Umum' })).toBeVisible();
	await expect(page.getByText('4 — Baik')).toBeVisible();
	await expect(page.getByText('Lanjutkan!')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Ekspor CSV' })).toBeEnabled();
});
