import { test, expect } from '@playwright/test';

test('legacy questions with matching labels keep category-specific scores', async ({ page }) => {
	let submitted;
	await page.route('**/api/v1/**', (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (path.endsWith('/submit')) {
			submitted = request.postDataJSON();
			return route.fulfill({ json: { success: true, data: {} } });
		}
		return route.fulfill({ json: { success: true, data: {
			title: 'Evaluasi sederhana', remaining: [{ id: 'entry', name: 'Pengisi contoh' }],
			questions: [{ label: 'Komunikasi', category: 'Tim' }, { label: 'Komunikasi', category: 'Organisasi' }],
		} } });
	});
	await page.goto('/#/qpr/legacy');
	await page.getByLabel('Namamu').selectOption('Pengisi contoh');
	await page.getByRole('group', { name: 'Tim — Komunikasi', exact: true }).getByRole('radio', { name: '2 dari 5' }).check();
	await page.getByRole('group', { name: 'Organisasi — Komunikasi', exact: true }).getByRole('radio', { name: '5 dari 5' }).check();
	await expect(page.getByRole('group', { name: 'Tim — Komunikasi', exact: true }).getByRole('radio', { name: '2 dari 5' })).toBeChecked();
	await page.getByRole('button', { name: 'Kirim penilaian' }).click();
	await expect(page.getByRole('heading', { name: 'Terima kasih!' })).toBeVisible();
	expect(submitted.answers).toEqual([
		{ label: 'Komunikasi', category: 'Tim', score: 2 },
		{ label: 'Komunikasi', category: 'Organisasi', score: 5 },
	]);
});
