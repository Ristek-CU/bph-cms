import { test, expect } from '@playwright/test';

import { periodPath, workspace, snapshot as baseSnapshot } from './fixtures/qpr-admin.js';

// Fixture khusus analitik: recap-v2 berisi distribusi nyata + endpoint analytics
// per periode + overview lintas kampanye. Terpisah dari fixtures/qpr-admin.js
// supaya test admin lama (yang mengharapkan recap kosong) tidak berubah.
async function setupAnalytics(page, { snapshot = baseSnapshot, withOverview = true } = {}) {
  const calls = [];
  const period = {
    id: 'period-admin', title: 'Periode Contoh', description: 'Evaluasi Oktober', status: 'closed',
    total_entries: 2, done_entries: 1, pending_entries: 1,
    firstOpenedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    opensAt: '2026-10-01T08:00:00Z', closesAt: '2026-10-31T08:00:00Z',
    questions: structuredClone(snapshot),
    entries: [
      { id: 'e1', name: 'Anggota Contoh', divisionSlug: 'ristek', memberRole: 'anggota', memberKey: 'member-1', done: true },
      { id: 'e2', name: 'Pengisi Kedua', divisionSlug: 'media', memberRole: 'anggota', memberKey: 'member-2', done: false },
    ],
  };
  await page.addInitScript(() => {
    sessionStorage.setItem('bph_cms_token', 'panel-session');
    localStorage.setItem('bph_cms_workspace', 'panel-session');
  });
  await page.route('**/api/v1/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    calls.push({ path, method });
    const reply = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (path === '/me') return reply({ user: { id: 'u1', name: 'Admin Contoh' }, active_division_id: 'bph',
      memberships: [{ division: { id: 'bph', slug: 'bph', name: 'BPH' }, role: 'platform_admin', permissions: ['qpr.manage'] }],
      workspace_options: [{ id: 'hub', kind: 'cms_hub', label: 'CMS Hub' }] });
    if (path === periodPath && method === 'GET') return reply(period);
    if (Array.isArray(period.questions)) {
      // Periode legacy → analytics dilarang (422 di server); UI menampilkan notice.
      if (path === `${periodPath}/analytics`) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'legacy' } }) });
    }
    if (path === `${periodPath}/analytics`) return reply({
      period: { id: period.id, title: period.title, status: period.status, form_kind: 'bph' },
      respondents: 4,
      by_division: [
        { division_slug: 'ristek', respondents: 3, mean: 40.67, max: 44, min: 38 },
        { division_slug: null, respondents: 1, mean: null, max: null, min: null },
      ],
    });
    if (path === '/admin/qpr/analytics') {
      return reply(withOverview ? [
        { period_id: 'period-lama', title: 'Kampanye September', status: 'closed', form_kind: 'bph', opens_at: null, closes_at: null, created_at: '2026-09-01T00:00:00Z', total_entries: 5, done_entries: 5, respondents: 5, participation_pct: 100, avg_question_mean: 3.2 },
        { period_id: period.id, title: period.title, status: period.status, form_kind: 'bph', opens_at: period.opensAt, closes_at: period.closesAt, created_at: '2026-10-01T00:00:00Z', total_entries: 2, done_entries: 1, respondents: 4, participation_pct: 50, avg_question_mean: 3.8 },
      ] : []);
    }
    if (path === `${periodPath}/recap-v2`) return reply({
      total_entries: 2, done_entries: 1, pending: period.entries,
      score_total: { responses: 4, mean: 38, max: 44, min: 30 },
      sections: [
        { id: 'ketum', title: 'Ketua Umum', target_id: 'ketum', target_label: 'Ketua Contoh', questions: [
          { id: 'ketum-s01', label: 'Arahan Ketua jelas?', type: 'scale', responses: 3, mean: 4, distribution: [{ value: 1, count: 0 }, { value: 2, count: 0 }, { value: 3, count: 1 }, { value: 4, count: 2 }, { value: 5, count: 0 }] },
          { id: 'ketum-t01', label: 'Saran untuk Ketua', type: 'text', responses: 1, texts: ['Saran baik'] },
        ] },
        { id: 'sekum', title: 'Sekretaris Umum', target_id: 'sekum', target_label: 'Sekum Contoh', questions: [
          { id: 'sekum-s01', label: 'Notulen rapi?', type: 'scale', responses: 3, mean: 3.67, distribution: [{ value: 1, count: 0 }, { value: 2, count: 0 }, { value: 3, count: 1 }, { value: 4, count: 1 }, { value: 5, count: 1 }] },
        ] },
      ],
    });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: `Unexpected ${method} ${path}` } }) });
  });
  await page.goto(`${process.env.QPR_TEST_BASE_URL || ''}/#${workspace}?tab=analytics`, { waitUntil: 'domcontentloaded' });
  return calls;
}

test('analytics tab renders stat cards, donut, ranking, distribution, per-division table, and trend', async ({ page }) => {
  const calls = await setupAnalytics(page);
  await expect(page.getByRole('button', { name: 'Analitik', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Respons final', { exact: true })).toBeVisible();
  await expect(page.getByText('Partisipasi (1/2)', { exact: true })).toBeVisible();
  await expect(page.getByText('Rata-rata skor /5', { exact: true })).toBeVisible();
  await expect(page.getByText('Responden tercatat', { exact: true })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Partisipasi' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Partisipasi 50%' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Ranking target (rata-rata /5)' })).toBeVisible();
  const ranking = page.getByRole('img', { name: /Ketua Contoh — Ketua Umum: 4/ });
  await expect(ranking).toContainText('Ketua Contoh');
  await expect(ranking).toContainText('Sekum Contoh');

  await expect(page.getByLabel('Distribusi skor per target')).toHaveValue('ketum');
  await expect(page.getByRole('img', { name: /Distribusi Ketua Contoh/ })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Per divisi pengisi' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ristek', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '40.67' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'digabung (n<3)' })).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Tren lintas kampanye' })).toBeVisible();
  await expect(page.getByText('Kampanye September')).toBeVisible();

  expect(calls.some(c => c.path === `${periodPath}/analytics`)).toBe(true);
  expect(calls.some(c => c.path === '/admin/qpr/analytics')).toBe(true);
  expect(calls.some(c => c.path === `${periodPath}/recap-v2`)).toBe(true);
});

test('analytics without cross-period overview hides the trend card', async ({ page }) => {
  await setupAnalytics(page, { withOverview: false });
  await expect(page.getByRole('button', { name: 'Analitik', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Partisipasi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tren lintas kampanye' })).toHaveCount(0);
});

test('legacy period shows notice instead of analytics and skips fetches', async ({ page }) => {
  const calls = await setupAnalytics(page, { snapshot: [{ label: 'Kinerja', category: 'Umum' }] });
  await expect(page.getByText(/Analitik hanya tersedia untuk kampanye rubrik/)).toBeVisible();
  expect(calls.some(c => c.path === `${periodPath}/analytics`)).toBe(false);
  expect(calls.some(c => c.path === `${periodPath}/recap-v2`)).toBe(false);
});
