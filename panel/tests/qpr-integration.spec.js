import { test, expect } from '@playwright/test';

const targets = ['controller1', 'controller2', 'controller3', 'controller4', 'bendum1', 'bendum2', 'sekum1', 'sekum2', 'ketum', 'waketum'];

async function login(page, email, password) {
	await page.goto('/#/qpr');
	await page.getByLabel('Email pengurus').fill(email);
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Masuk', exact: true }).click();
}

async function guest(browser, baseURL) {
	const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 800 } });
	return context;
}

async function fillSection(page) {
	const groups = page.locator('fieldset.qpr-question');
	for (let index = 0; index < await groups.count(); index++) {
		const group = groups.nth(index);
		const radios = group.getByRole('radio');
		if (await radios.count()) await radios.nth(3).check();
		else await group.getByRole('textbox').fill('Masukan sintetis untuk pengujian.');
	}
}

test('BPH membuat, tamu melanjutkan lintas browser, divisi hanya melihat status', async ({ page, browser, baseURL }) => {
	await login(page, 'bph@cakrawala.com', 'fixture-password');
	await page.getByRole('button', { name: '+ Periode baru' }).click();
	await page.getByLabel('Judul periode', { exact: true }).fill('QPR browser nyata');
	const created = page.waitForResponse((r) => r.url().endsWith('/admin/qpr/periods') && r.request().method() === 'POST');
	await page.getByRole('button', { name: 'Buat periode', exact: true }).click();
	const response = await created;
	expect(response.status()).toBe(201);
	const { data: period } = await response.json();
	await expect(page.getByLabel('Bagian penilaian')).toBeVisible();
	for (const id of targets) {
		await page.getByLabel('Bagian penilaian').selectOption(`section-${id}`);
		await page.getByLabel('Nama target penilaian').fill(`Target sintetis ${id}`);
	}
	await page.getByLabel('Bagian penilaian').selectOption('section-ketum');
	await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Pertanyaan custom browser nyata');
	await page.getByRole('button', { name: 'Simpan form', exact: true }).click();
	await expect(page.getByText('Semua perubahan tersimpan')).toBeVisible();
	await page.getByRole('button', { name: 'Pengisi', exact: true }).click();
	await page.getByRole('button', { name: '+ Tambah nama' }).click();
	await page.getByLabel('Nama | division_slug').fill('Pengisi Ristek | ristek | anggota | test-ristek\nPengisi UKM | ukm | anggota | test-ukm');
	await page.getByRole('button', { name: 'Preview impor', exact: true }).click();
	await page.getByRole('button', { name: 'Impor', exact: true }).click();
	await expect(page.getByRole('dialog')).toHaveCount(0);
	await page.getByRole('button', { name: 'Pratinjau', exact: true }).click();
	await expect(page.getByRole('option', { name: /Pengisi Ristek.*44 wajib/ })).toHaveCount(1);
	await expect(page.getByRole('group', { name: 'Pertanyaan custom browser nyata', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Ringkasan', exact: true }).click();
	const opened = page.waitForResponse((r) => r.url().endsWith(`/${period.id}/open`));
	await page.getByRole('button', { name: 'Buka kampanye', exact: true }).click();
	await page.getByRole('button', { name: 'Ya, buka', exact: true }).click();
	expect((await opened).ok()).toBe(true);

	const first = await guest(browser, baseURL);
	const second = await guest(browser, baseURL);
	const division = await guest(browser, baseURL);
	try {
		const fill = await first.newPage();
		await fill.goto(`/#/qpr/${period.id}`);
		expect(await fill.evaluate(() => sessionStorage.getItem('bph_cms_token'))).toBeNull();
		await fill.getByLabel('Divisimu').selectOption({ label: 'Ristek' });
		await fill.getByLabel('Namamu').selectOption(await fill.getByRole('option', { name: /Pengisi Ristek/ }).getAttribute('value'));
		await fill.getByRole('radio', { name: '4 — Baik', exact: true }).first().check();
		await expect(fill.getByText('Tersimpan', { exact: true })).toBeVisible();

		const resumed = await second.newPage();
		await resumed.goto(`/#/qpr/${period.id}`);
		await resumed.getByLabel('Divisimu').selectOption({ label: 'Ristek' });
		await resumed.getByLabel('Namamu').selectOption(await resumed.getByRole('option', { name: /Pengisi Ristek/ }).getAttribute('value'));
		await expect(resumed.getByRole('radio', { name: '4 — Baik', exact: true }).first()).toBeChecked();
		await fillSection(resumed);
		await resumed.getByRole('button', { name: 'Berikutnya', exact: true }).click();
		await expect(resumed.getByRole('heading', { name: /Langkah 2/ })).toBeVisible();
		await resumed.getByRole('button', { name: 'Kembali', exact: true }).click();
		await expect(resumed.getByRole('radio', { name: '4 — Baik', exact: true }).first()).toBeChecked();
		await resumed.getByRole('button', { name: 'Berikutnya', exact: true }).click();
		await fillSection(resumed);
		await resumed.getByRole('button', { name: 'Tinjau jawaban', exact: true }).click();
		await expect(resumed.getByRole('heading', { name: 'Tinjau penilaian' })).toBeVisible();
		expect(await resumed.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await resumed.getByRole('checkbox').check();
		await resumed.getByRole('button', { name: 'Kirim penilaian', exact: true }).click();
		await expect(resumed.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
		await fill.reload();
		await expect(fill.getByRole('option', { name: /Pengisi Ristek/ })).toHaveCount(0);

		await page.getByRole('button', { name: /^Respons/ }).click();
		await expect(page.getByText('Rekap — 1/2 sudah isi')).toBeVisible();
		const download = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click();
		expect((await download).suggestedFilename()).toMatch(/\.csv$/);

		const status = await division.newPage();
		await login(status, 'admin.a@example.com', 'fixture-password');
		await expect(status.getByRole('heading', { name: 'Status pengisian QPR' })).toBeVisible();
		await expect(status.getByText(/Pengisi Ristek.*Sudah mengisi/)).toBeVisible();
		await expect(status.getByText(/Pengisi UKM/)).toHaveCount(0);
		await expect(status.getByRole('button', { name: '+ Periode baru' })).toHaveCount(0);
		const denied = await status.evaluate(async (id) => {
			const response = await fetch(`/api/v1/admin/qpr/periods/${id}/recap-v2`, { credentials: 'same-origin', headers: { Authorization: 'Bearer panel-session' } });
			return response.status;
		}, period.id);
		expect(denied).toBe(403);
	} finally {
		await first.close(); await second.close(); await division.close();
	}
});
