import { test, expect } from '@playwright/test';

const sections = ['Ketua', 'Wakil'].map((title, index) => ({
	id: `section-${index}`, title, targetId: `target-${index}`, targetLabel: index === 0 ? 'Pengurus A' : null,
	questions: [
		{ id: `scale-${index}`, type: 'scale', label: `Nilai ${title}`, required: true },
		{ id: `text-${index}`, type: 'text', label: `Saran ${title}`, required: true },
		{ id: `note-${index}`, type: 'text', label: `Pesan ${title}`, required: true },
	],
}));
const entries = [
	{ id: 'a', name: 'Nadia', division: 'Ristek', role: 'anggota' },
	{ id: 'b', name: 'Bima', division: 'Ristek', role: 'kadiv' },
	{ id: 'c', name: 'Citra', division: 'UKM', role: 'anggota' },
];
const full = sections.flatMap((s, index) => s.questions.map((q) => ({ question_id: q.id, value: q.type === 'scale' ? 4 : `Jawaban ${index}` })));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

async function setup(page, { draft = [], conflict = false, hold = false, offline = false, alreadyFinal = false } = {}) {
	const state = { puts: [], submits: [], gets: [], versions: { a: 3, b: 0, c: 0 }, drafts: { a: draft, b: [], c: [] }, release: deferred(), offline };
	await page.route('**/qpr-test', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
		import RefreshRuntime from '/@react-refresh';
		RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;
		const { default: React } = await import('/node_modules/.vite/deps/react.js');
		const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
		const { default: QprFill } = await import('/src/pages/QprFill.jsx');
		await import('/src/index.css');
		ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(QprFill, { periodId: 'test' }));
	</script></body></html>` }));
	await page.route('**/api/v1/**', async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		const reply = (data) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
		if (path === '/api/v1/qpr/test') return reply({ title: 'QPR test', remaining: entries, questions: { version: 3 } });
		const match = path.match(/entries\/([abc])\/draft$/);
		if (match && request.method() === 'GET') {
			const id = match[1]; state.gets.push(id);
			return reply({ entry: entries.find((e) => e.id === id), sections, questions: sections.flatMap((s) => s.questions), draft: state.drafts[id], draft_version: state.versions[id], progress: { required: 6 }, scale_legend: { 1: 'Sangat Kurang', 2: 'Kurang', 3: 'Cukup', 4: 'Baik', 5: 'Sangat Baik' } });
		}
		if (match && request.method() === 'PUT') {
			const id = match[1]; const body = request.postDataJSON(); state.puts.push({ id, ...body });
			if (hold && state.puts.length === 1) await state.release.promise;
			if (state.offline) return route.abort('internetdisconnected');
			if (conflict || body.expected_version !== state.versions[id]) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Konflik versi' }) });
			state.drafts[id] = body.answers; state.versions[id]++;
			return reply({ draft_version: state.versions[id] });
		}
		if (path.endsWith('/submit-v2')) {
			state.submits.push(request.postDataJSON());
			if (alreadyFinal) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Sudah final', errors: { code: 'QPR_ALREADY_FINAL', state: ['already_final'] } }) });
			return reply({ entry_id: 'a' });
		}
		throw new Error(`Unexpected API request: ${request.method()} ${path}`);
	});
	page.on('pageerror', (error) => console.error(error.message));
	await page.goto('/qpr-test');
	await expect(page.getByLabel('Divisimu')).toBeVisible();
	expect(await page.evaluate(() => sessionStorage.getItem('bph_cms_token'))).toBeNull();
	await page.getByLabel('Divisimu').selectOption('Ristek');
	await expect(page.getByLabel('Namamu').locator('option')).toHaveCount(3);
	await page.getByLabel('Namamu').selectOption('a');
	return state;
}

async function fillSection(page, title, value = 'Saran lengkap') {
	await page.getByRole('radio', { name: '4 — Baik', exact: true }).check();
	await page.getByLabel(`Saran ${title}`, { exact: true }).fill(value);
	await page.getByLabel(`Pesan ${title}`, { exact: true }).fill('Tetap semangat');
}

test('guest edits during in-flight save advance latest version without self-conflict', async ({ page }) => {
	const state = await setup(page, { hold: true });
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Awal');
	await expect.poll(() => state.puts.length).toBe(1);
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Terbaru');
	state.release.resolve();
	await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
	expect(state.puts.map((p) => p.expected_version)).toEqual([3, 4]);
	expect(state.puts[1].answers).toContainEqual({ question_id: 'text-0', value: 'Terbaru' });
	await expect(page.getByLabel('Saran Ketua', { exact: true })).toHaveValue('Terbaru');
});

test('switch name flushes active save before changing identity', async ({ page }) => {
	const state = await setup(page, { hold: true });
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Nadia saja');
	await expect.poll(() => state.puts.length).toBe(1);
	await page.getByRole('button', { name: 'Ganti nama' }).click();
	await expect(page.getByRole('button', { name: 'Ganti nama' })).toBeDisabled();
	state.release.resolve();
	await page.getByLabel('Namamu').selectOption('b');
	await expect(page.getByText('Bima', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Saran Ketua', { exact: true })).toHaveValue('');
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Bima saja');
	await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
	expect(state.puts[1]).toMatchObject({ id: 'b', expected_version: 0 });
	expect(state.puts[1].answers).not.toContainEqual({ question_id: 'text-0', value: 'Nadia saja' });
});

test('resume missing section, enforce required fields, review, back, final with latest CAS', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 800 });
	const state = await setup(page, { draft: full.filter((a) => !['text-1', 'note-1'].includes(a.question_id)) });
	await expect(page.getByRole('heading', { name: 'Langkah 2 dari 2: Wakil' })).toBeVisible();
	await page.getByRole('button', { name: 'Tinjau jawaban' }).click();
	await expect(page.getByRole('heading', { name: 'Tinjau penilaian' })).toHaveCount(0);
	await fillSection(page, 'Wakil');
	await page.getByRole('button', { name: 'Kembali', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Langkah 1 dari 2: Ketua: Pengurus A' })).toBeVisible();
	await page.getByRole('button', { name: 'Berikutnya' }).click();
	await expect(page.getByLabel('Saran Wakil', { exact: true })).toHaveValue('Saran lengkap');
	await page.getByRole('button', { name: 'Tinjau jawaban' }).click();
	await expect(page.getByRole('heading', { name: 'Tinjau penilaian' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Kirim penilaian' })).toBeDisabled();
	await page.getByRole('checkbox').check();
	await page.getByRole('button', { name: 'Kirim penilaian' }).click();
	await expect(page.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
	expect(state.submits).toHaveLength(1);
	expect(state.submits[0]).toMatchObject({ entry_id: 'a', expected_version: 4 });
	expect(state.submits[0].answers).toHaveLength(6);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('conflict preserves local text and forbids automatic overwrite or final', async ({ page }) => {
	const state = await setup(page, { conflict: true });
	await fillSection(page, 'Ketua', 'Lokal dipertahankan');
	await expect(page.getByText('Konflik — edit lokal belum tersimpan. Tidak akan menimpa draft server.')).toBeVisible();
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Edit sesudah konflik');
	await expect(page.getByRole('button', { name: 'Berikutnya' })).toBeDisabled();
	await expect(page.getByLabel('Saran Ketua', { exact: true })).toHaveValue('Edit sesudah konflik');
	page.once('dialog', (dialog) => dialog.dismiss());
	await page.getByRole('button', { name: 'Muat draft terbaru' }).click();
	expect(state.puts).toHaveLength(1);
	expect(state.gets).toEqual(['a']);
	expect(state.submits).toHaveLength(0);
});

test('offline failure keeps answers and explicit retry uses unchanged version', async ({ page }) => {
	const state = await setup(page, { offline: true });
	await page.getByLabel('Saran Ketua', { exact: true }).fill('Jawaban offline');
	await expect(page.getByText('Gagal tersimpan — edit lokal tetap ada.')).toBeVisible();
	state.offline = false;
	await page.getByRole('button', { name: 'Coba simpan lagi' }).click();
	await expect(page.getByText('Tersimpan', { exact: true })).toBeVisible();
	expect(state.puts.map((p) => p.expected_version)).toEqual([3, 3]);
	await expect(page.getByLabel('Saran Ketua', { exact: true })).toHaveValue('Jawaban offline');
});

 test('already-final retry counts as accepted and same-tick final sends once', async ({ page }) => {
	const state = await setup(page, { draft: full, alreadyFinal: true });
	await page.getByRole('checkbox').check();
	await page.locator('form').evaluate((form) => {
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
	});
	await expect(page.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
	expect(state.submits).toHaveLength(1);
 });
