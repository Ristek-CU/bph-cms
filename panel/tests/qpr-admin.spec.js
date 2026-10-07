import { test, expect } from '@playwright/test';

const ids = ['controller1', 'controller2', 'controller3', 'controller4', 'bendum1', 'bendum2', 'sekum1', 'sekum2', 'ketum', 'waketum'];
const snapshot = { version: 3, sections: [{ id: 'ketum', title: 'Ketua', questions: [{ id: 'k1', label: 'Pertanyaan PDF', type: 'scale', required: true }] }], target_config: { targets: ids.map(id => ({ id, label: '', template: id.startsWith('controller') ? 'controller' : id })), controller_by_division: {} }, routing: {} };

async function setup(page, { slug = 'bph', permission = true, frozen = false, legacy = false, blockers = [], status = "draft", entries = null } = {}) {
  const calls = [];
  const period = { id: 'period-admin', title: 'Periode Contoh', status, total_entries: 2, done_entries: 0, pending_entries: 2, firstOpenedAt: frozen ? '2026-10-01T00:00:00Z' : null, opensAt: '2026-10-01T08:00:00Z', closesAt: '2026-10-31T08:00:00Z', questions: legacy ? [{ category: 'Kinerja', label: 'Pertanyaan lama' }] : snapshot, entries: entries || [{ id: 'e1', name: 'Anggota Contoh', division_slug: 'ristek', role: 'anggota', done: false }] };
  await page.addInitScript(() => { sessionStorage.setItem('bph_cms_token', 'panel-session'); localStorage.setItem('bph_cms_workspace', 'panel-session');});
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    const method = route.request().method();
    calls.push({ path, method, body: route.request().postData() ? route.request().postDataJSON() : null });
    const reply = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (path === '/me') return reply({ user: { id: 'u1', name: 'Admin Contoh', email: 'admin@example.com' }, active_division_id: slug, memberships: [{ division: { id: slug, slug, name: slug }, role: 'platform_admin', permissions: permission ? ['qpr.manage'] : [] }], workspace_options: [{ id: 'hub', kind: 'cms_hub', label: 'CMS Hub' }] });
    if (path === '/qpr-participation') return reply([period]);
    if (path === '/qpr-participation/period-admin') return reply({ period, total_entries: 2, done_entries: 1, pending_entries: 1, entries: [{ name: 'Selesai Contoh', display_name: 'Selesai Contoh', role: 'anggota', done: true }, { name: 'Draft Contoh', role: 'anggota', done: false }] });
    if (path === '/admin/qpr/periods') return reply([period]);
    if (path.endsWith('/preview')) return reply({ blockers, entries: [{ id: 'e1', name: 'Anggota Contoh', display_name: 'Anggota Contoh (member-1)', division_slug: 'ristek', role: 'anggota', required: 44, targets: ['ketum', 'waketum'], sections: [] }] });
    if (path.endsWith('/recap-v2')) return reply({ done_entries: 3, total_entries: 3, pending: [], sections: [{ id: 'controller1', target_label: 'Controller Contoh', questions: [{ id: 'c1', label: 'Pertanyaan cabang', type: 'scale', responses: 1, mean: 5, distribution: [{ value: 5, count: 1 }] }] }] });
    if (path === '/admin/qpr/periods/period-admin') return reply(period);
    return reply([]);
  });
  await page.goto(`${process.env.QPR_TEST_BASE_URL || ''}/#/qpr`, { waitUntil: 'domcontentloaded' });
  return calls;
}

test('non-BPH permission does not expose administration; draft remains pending', async ({ page }) => {
  const calls = await setup(page, { slug: 'ristek' });
  await expect(page.getByRole('heading', { name: 'Status pengisian QPR' })).toBeVisible();
  await expect(page.getByText('1 sudah mengisi · 1 belum mengisi · 2 anggota')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Periode baru' })).toHaveCount(0);
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await expect(page.getByText('Draft Contoh (anggota) — Belum mengisi')).toBeVisible();
  await expect(page.getByText('Selesai Contoh (anggota) — Sudah mengisi')).toHaveCount(0);
  expect(calls.some(c => c.path.startsWith('/admin/qpr'))).toBe(false);
});

test('BPH without permission gets status only', async ({ page }) => {
  await setup(page, { permission: false });
  await expect(page.getByRole('heading', { name: 'Status pengisian QPR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kelola' })).toHaveCount(0);
});

test('snapshot Kelola and edit configure fixed targets without question editor', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: 'Edit periode', exact: true }).click();
  await expect(page.getByText('Kustomisasi pertanyaan (1)')).toBeVisible();
  await expect(page.getByLabel('Pertanyaan (satu per baris')).toHaveCount(0);
  for (const id of ids) await page.getByLabel(`Nama ${id}`, { exact: true }).fill(`Target ${id}`);
  await page.getByLabel('Controller untuk ristek', { exact: true }).selectOption('controller2');
  await page.getByText('Kustomisasi pertanyaan (1)').click();
  await page.getByLabel('k1', { exact: true }).fill('Pertanyaan PDF versi baru');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const put = calls.find(c => c.method === 'PUT');
  expect(put.body.target_config.targets).toHaveLength(10);
  expect(put.body.target_config.controller_by_division.ristek).toBe('controller2');
  expect(put.body.question_labels).toEqual({ k1: 'Pertanyaan PDF versi baru' });
  expect(put.body).not.toHaveProperty('questions');
  expect(new Date(put.body.opens_at).toISOString()).toBe('2026-10-01T08:00:00.000Z');
  expect(new Date(put.body.closes_at).toISOString()).toBe('2026-10-31T08:00:00.000Z');
});

test('preview blockers stop opening and show route', async ({ page }) => {
  const calls = await setup(page, { blockers: ['Controller ristek belum dipetakan'] });
  await page.getByRole('button', { name: 'Buka', exact: true }).click();
  await expect(page.getByText('Controller ristek belum dipetakan')).toBeVisible();
  await expect(page.getByText(/Anggota Contoh \(member-1\) · ristek · anggota · 44 wajib/)).toBeVisible();
  expect(calls.some(c => c.path.endsWith('/open'))).toBe(false);
});

test('frozen snapshot locks roster/config, preserves metadata editing', async ({ page }) => {
  const calls = await setup(page, { frozen: true });
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Tambah nama' })).toBeDisabled();
  await page.getByRole('button', { name: 'Edit periode', exact: true }).click();
  await expect(page.getByText('Pertanyaan template PDF hanya baca.')).toBeVisible();
  await expect(page.getByLabel('Nama controller1', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('k1', { exact: true })).toHaveCount(0);
  await page.getByLabel('Judul periode', { exact: true }).fill('Metadata baru');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find(c => c.method === 'PUT').body).not.toHaveProperty('target_config');
});

test('v3 roster requires stable keys and previews before import', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: '+ Tambah nama' }).click();
  await page.getByLabel('Nama | division_slug').fill('Nama Kembar | ristek | anggota | member-1\nNama Kembar | ristek | kadiv | member-2');
  await page.getByRole('button', { name: 'Preview impor', exact: true }).click();
  await expect(page.getByText('Preview impor (2)')).toBeVisible();
  expect(calls.some(c => c.method === 'POST' && c.path.endsWith('/entries'))).toBe(false);
  await page.getByRole('button', { name: 'Impor', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find(c => c.method === 'POST' && c.path.endsWith('/entries')).body.entries.map(e => e.member_key)).toEqual(['member-1', 'member-2']);
});

test('recap uses actual snapshot and branch response denominator', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Rekap', exact: true }).click();
  await expect(page.getByText('Pertanyaan cabang')).toBeVisible();
  await expect(page.locator('.poll-bar-fill')).toHaveAttribute('style', 'width: 100%;');
  expect(calls.some(c => c.path.endsWith('/recap-v2'))).toBe(true);
});

test('legacy question editing still works', async ({ page }) => {
  const calls = await setup(page, { legacy: true });
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: 'Edit periode', exact: true }).click();
  await page.getByLabel('Pertanyaan (satu per baris').fill('Kinerja | Pertanyaan baru');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(calls.find(c => c.method === 'PUT').body.questions).toEqual([{ category: 'Kinerja', label: 'Pertanyaan baru' }]);
});

 test('v3 roster rejects missing stable key before preview', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: '+ Tambah nama' }).click();
  await page.getByLabel('Nama | division_slug').fill('Anggota Contoh | ristek | anggota');
  await page.getByRole('button', { name: 'Preview impor', exact: true }).click();
  await expect(page.getByText('Wajib nama, division_slug kanonis, jabatan valid, dan member_key stabil.')).toBeVisible();
  expect(calls.some(c => c.method === 'POST' && c.path.endsWith('/entries'))).toBe(false);
});


test('closed period reopens only after fresh preview', async ({ page }) => {
  const calls = await setup(page, { status: 'closed', frozen: true });
  await page.getByRole('button', { name: 'Buka kembali', exact: true }).click();
  await expect.poll(() => calls.filter(c => c.method === 'POST' && c.path.endsWith('/open')).length).toBe(1);
  const previewIndex = calls.findIndex(c => c.path.endsWith('/preview'));
  const openIndex = calls.findIndex(c => c.method === 'POST' && c.path.endsWith('/open'));
  expect(previewIndex).toBeLessThan(openIndex);
});

test('closed period blockers prevent reopening', async ({ page }) => {
  const calls = await setup(page, { status: 'closed', frozen: true, blockers: ['Konfigurasi lama perlu diperiksa'] });
  await page.getByRole('button', { name: 'Buka kembali', exact: true }).click();
  await expect(page.getByText('Konfigurasi lama perlu diperiksa')).toBeVisible();
  expect(calls.some(c => c.method === 'POST' && c.path.endsWith('/open'))).toBe(false);
});

test('roster import invalidates previously displayed preview', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: 'Preview jalur', exact: true }).click();
  await expect(page.getByText(/44 wajib/)).toBeVisible();
  await page.getByRole('button', { name: '+ Tambah nama' }).click();
  await page.getByLabel('Nama | division_slug').fill('Anggota Baru | ristek | anggota | member-new');
  await page.getByRole('button', { name: 'Preview impor', exact: true }).click();
  await page.getByRole('button', { name: 'Impor', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/44 wajib/)).toHaveCount(0);
});

test('detail reload invalidates previously displayed preview', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await page.getByRole('button', { name: 'Preview jalur', exact: true }).click();
  await expect(page.getByText(/44 wajib/)).toBeVisible();
  await page.getByRole('button', { name: 'Tutup detail', exact: true }).click();
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await expect(page.getByRole('button', { name: '+ Tambah nama' })).toBeVisible();
  await expect(page.getByText(/44 wajib/)).toHaveCount(0);
});

test('namesake roster exposes stable keys and deletion invalidates preview', async ({ page }) => {
  const calls = await setup(page, { entries: [
    { id: 'e1', name: 'Nama Kembar', divisionSlug: 'ristek', memberRole: 'anggota', memberKey: 'member-1', done: false },
    { id: 'e2', name: 'Nama Kembar', divisionSlug: 'ristek', memberRole: 'anggota', memberKey: 'member-2', done: false },
  ] });
  await page.getByRole('button', { name: 'Kelola', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Nama Kembar (anggota) · member-1', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Nama Kembar (anggota) · member-2', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview jalur', exact: true }).click();
  await expect(page.getByText(/Anggota Contoh \(member-1\) · ristek/)).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'member-2' }).getByRole('button', { name: 'Hapus', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, hapus', exact: true }).click();
  await expect.poll(() => calls.some(c => c.method === 'DELETE' && c.path.endsWith('/entries/e2'))).toBe(true);
  await expect(page.getByText(/44 wajib/)).toHaveCount(0);
});
