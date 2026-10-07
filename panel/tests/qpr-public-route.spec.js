import { test, expect } from '@playwright/test';

test('tautan QPR publik tidak bergantung sesi atau workspace', async ({ page }) => {
	await page.addInitScript(() => {
		sessionStorage.setItem('bph_cms_token', 'panel-session');
	});
	const privateRequests = [];
	await page.route('**/api/v1/**', (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path !== '/api/v1/qpr/public-test') privateRequests.push(path);
		return route.fulfill({
			contentType: 'application/json',
			body: JSON.stringify({ success: true, data: {
				id: 'public-test', title: 'Formulir publik mandiri',
				questions: [], remaining: [],
			} }),
		});
	});
	await page.goto('/#/qpr/public-test');
	await expect(page.getByRole('heading', { name: 'Formulir publik mandiri' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Modul' })).toHaveCount(0);
	await expect(page.getByRole('dialog')).toHaveCount(0);
	expect(privateRequests).toEqual([]);
});

test('401 ekspor sesi lama tidak menghapus sesi baru', async ({ page }) => {
	await page.goto('/');
	const result = await page.evaluate(async () => {
		const { apiRaw, getToken, setToken, clearToken } = await import('/src/api.js');
		const original = window.fetch;
		let finish;
		window.fetch = () => new Promise((resolve) => { finish = resolve; });
		try {
			setToken();
			const pending = apiRaw('/admin/qpr/periods/old/export').catch((error) => error.statusCode);
			clearToken();
			setToken();
			finish(new Response('{}', { status: 401 }));
			return { status: await pending, token: getToken() };
		} finally {
			window.fetch = original;
			clearToken();
		}
	});
	expect(result).toEqual({ status: 401, token: 'panel-session' });
});
