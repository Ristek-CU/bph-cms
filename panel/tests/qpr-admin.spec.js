import { test, expect } from '@playwright/test';

import { periodPath, workspace, snapshot, setup } from './fixtures/qpr-admin.js';

const tab = (page, name) => page.getByRole('navigation', { name: 'Bagian kampanye' }).getByRole('button', { name, exact: true });

test('campaign links open routed workspace and all five tabs', async ({ page }) => {
  const calls = await setup(page);
  await expect(page.getByRole('heading', { name: 'Kampanye QPR' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Periode Contoh' })).toHaveAttribute('href', `#${workspace}`);
  await expect(page.getByRole('link', { name: 'Kelola', exact: true })).toHaveAttribute('href', `#${workspace}`);
  await expect(page.getByRole('link', { name: 'Rekap', exact: true })).toHaveAttribute('href', `#${workspace}?tab=responses`);
  await page.getByRole('link', { name: 'Kelola', exact: true }).click();
  await expect(tab(page, 'Ringkasan')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Progres pengisian' })).toBeVisible();
  for (const [name, key, heading] of [
    ['Pertanyaan', 'questions', 'Ketua Umum'], ['Pengisi', 'entries', 'Daftar pengisi'],
    ['Pratinjau', 'preview', 'Kesiapan kampanye'], ['Respons (0)', 'responses', 'Respons kampanye'],
  ]) {
    await tab(page, name).click();
    await expect(page).toHaveURL(new RegExp(`#${workspace}\\?tab=${key}$`));
    await expect(tab(page, name)).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText('Belum ada penilaian final.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ekspor CSV' })).toBeDisabled();
  expect(calls.some(c => c.path === `${periodPath}/recap-v2`)).toBe(true);
  await page.getByRole('link', { name: '← Semua kampanye' }).click();
  await page.getByRole('link', { name: 'Rekap', exact: true }).click();
  await expect(tab(page, 'Respons (0)')).toHaveAttribute('aria-current', 'page');
});

test('editor adds, reorders, changes type and required flag, then persists exact snapshot contract', async ({ page }) => {
  const calls = await setup(page, { path: `${workspace}?tab=questions` });
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeDisabled();
  await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Arahan Ketua dapat ditindaklanjuti?');
  await page.getByLabel('Nama target penilaian', { exact: true }).fill('Ketua Baru');
  await page.getByRole('button', { name: '+ Tambah pertanyaan', exact: true }).click();
  await page.getByLabel('Pertanyaan 3', { exact: true }).fill('Contoh dukungan Ketua');
  await page.getByLabel('Jenis jawaban pertanyaan 3', { exact: true }).selectOption('text');
  await page.getByRole('article').filter({ has: page.getByLabel('Pertanyaan 3', { exact: true }) }).getByRole('checkbox', { name: 'Wajib diisi' }).uncheck();
  await page.getByRole('button', { name: 'Naikkan pertanyaan 3', exact: true }).click();
  await expect(page.getByLabel('Pertanyaan 2', { exact: true })).toHaveValue('Contoh dukungan Ketua');
  await expect(page.getByLabel('Jenis jawaban pertanyaan 2', { exact: true })).toHaveValue('text');
  await expect(page.getByRole('article').filter({ has: page.getByLabel('Pertanyaan 2', { exact: true }) }).getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('button', { name: 'Simpan form', exact: true }).click();
  await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
  const puts = calls.filter(c => c.method === 'PUT');
  expect(puts).toHaveLength(1);
  const added = puts[0].body.sections[0].questions[1];
  expect(added.id).toMatch(/^custom-[0-9a-f-]{36}$/);
  expect(puts[0].body).toEqual({
    title: 'Periode Contoh', description: 'Evaluasi Oktober', opens_at: expect.any(String), closes_at: expect.any(String),
    expected_snapshot: snapshot,
    target_config: { targets: [{ id: 'ketum', label: 'Ketua Baru', template: 'ketum' }], controller_by_division: {} },
    sections: [{ ...snapshot.sections[0], questions: [
      { ...snapshot.sections[0].questions[0], label: 'Arahan Ketua dapat ditindaklanjuti?' },
      { id: added.id, label: 'Contoh dukungan Ketua', type: 'text', required: false }, snapshot.sections[0].questions[1],
    ] }],
  });
  expect(new Date(puts[0].body.opens_at).toISOString()).toBe('2026-10-01T08:00:00.000Z');
  expect(new Date(puts[0].body.closes_at).toISOString()).toBe('2026-10-31T08:00:00.000Z');
  await page.reload();
  await expect(page.getByLabel('Nama target penilaian')).toHaveValue('Ketua Baru');
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Arahan Ketua dapat ditindaklanjuti?');
  await expect(page.getByLabel('Pertanyaan 2', { exact: true })).toHaveValue('Contoh dukungan Ketua');
  await expect(page.getByLabel('Jenis jawaban pertanyaan 2', { exact: true })).toHaveValue('text');
  await expect(page.getByRole('article').filter({ has: page.getByLabel('Pertanyaan 2', { exact: true }) }).getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByLabel('Pertanyaan 3', { exact: true })).toHaveValue('Saran untuk Ketua');
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeDisabled();
});

test('clicking active questions tab preserves dirty edits and later discard confirmation', async ({ page }) => {
  await setup(page, { path: `${workspace}?tab=questions` });
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    // Accepting an erroneous same-tab prompt catches the old dirty-state reset.
    if (dialogs.length === 1) await dialog.accept();
    else await dialog.dismiss();
  });
  await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Edit belum disimpan');
  await tab(page, 'Pertanyaan').click();
  expect(dialogs).toEqual([]);
  await expect(page.getByText('Ada perubahan belum disimpan', { exact: true })).toBeVisible();
  page.removeAllListeners('dialog');
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await tab(page, 'Ringkasan').click();
  expect(dialogs).toEqual(['Perubahan form belum disimpan. Pindah tab akan membuang edit lokal. Lanjutkan?']);
  await expect(tab(page, 'Pertanyaan')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Edit belum disimpan');
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeEnabled();
});

test('successful structural save updates baseline even when subsequent detail GET is unavailable', async ({ page }) => {
  const calls = await setup(page, { path: `${workspace}?tab=questions` });
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Arahan Ketua jelas?');
  let failedGets = 0;
  await page.route(`**/api/v1${periodPath}`, route => {
    if (route.request().method() !== 'GET') return route.fallback();
    failedGets++;
    return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Detail temporarily unavailable' } }) });
  });
  await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Pertanyaan revisi pertama');
  await page.getByRole('button', { name: 'Simpan form' }).click();
  await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeDisabled();
  await page.getByLabel('Pertanyaan 2', { exact: true }).fill('Saran revisi kedua');
  const saved = page.waitForResponse(response => response.url().endsWith(periodPath) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Simpan form' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
  const puts = calls.filter(c => c.method === 'PUT');
  expect(puts).toHaveLength(2);
  expect(puts[1].body.expected_snapshot).toEqual({ ...snapshot, sections: puts[0].body.sections, target_config: puts[0].body.target_config });
  expect(puts[1].body.sections[0].questions.map(q => q.label)).toEqual(['Pertanyaan revisi pertama', 'Saran revisi kedua']);
  expect(failedGets).toBe(0);
  await page.unroute(`**/api/v1${periodPath}`);
  await page.reload();
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Pertanyaan revisi pertama');
  await expect(page.getByLabel('Pertanyaan 2', { exact: true })).toHaveValue('Saran revisi kedua');
});

test('browser Back and Forward recover unsaved questions with original snapshot baseline', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('link', { name: 'Kelola', exact: true }).click();
  await tab(page, 'Pertanyaan').click();
  await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Edit sebelum navigasi riwayat');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Kampanye QPR' })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Edit sebelum navigasi riwayat');
  await expect(page.getByText('Edit belum tersimpan dipulihkan setelah navigasi. Edit ini hanya disimpan dalam memori tab.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeEnabled();
  await page.getByRole('button', { name: 'Simpan form' }).click();
  await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
  const puts = calls.filter(c => c.method === 'PUT');
  expect(puts).toHaveLength(1);
  expect(puts[0].body.expected_snapshot).toEqual(snapshot);
  expect(puts[0].body.sections[0].questions[0].label).toBe('Edit sebelum navigasi riwayat');
});

test('recovered edit cannot overwrite changed server baseline and discard restores server values', async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole('link', { name: 'Kelola', exact: true }).click();
  await tab(page, 'Pertanyaan').click();
  await page.getByLabel('Pertanyaan 1', { exact: true }).fill('Perubahan lokal lama');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Kampanye QPR' })).toBeVisible();
  await page.route(`**/api/v1${periodPath}`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data: {
    id: 'period-admin', title: 'Periode Contoh', status: 'draft', firstOpenedAt: null,
    updatedAt: '2026-10-07T02:00:00Z', opensAt: null, closesAt: null, entries: [],
    questions: { ...snapshot, sections: [{ ...snapshot.sections[0], questions: [
      { ...snapshot.sections[0].questions[0], label: 'Pertanyaan terbaru dari server' }, snapshot.sections[0].questions[1],
    ] }] },
  } }) }));
  await page.goForward();
  await expect(page.getByText('Server berubah sejak edit lokal. Simpan dinonaktifkan agar perubahan server tidak tertimpa.')).toBeVisible();
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Perubahan lokal lama');
  await expect(page.getByRole('button', { name: 'Simpan form' })).toBeDisabled();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toBe('Buang edit lokal dan gunakan form server?');
    await dialog.accept();
  });
  await page.getByRole('button', { name: 'Buang edit lokal', exact: true }).click();
  await expect(page.getByLabel('Pertanyaan 1', { exact: true })).toHaveValue('Pertanyaan terbaru dari server');
  await expect(page.getByRole('button', { name: 'Buang edit lokal', exact: true })).toHaveCount(0);
  await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});

test('first opening permanently freezes questions and roster but metadata still saves', async ({ page }) => {
  const calls = await setup(page, { frozen: true, path: `${workspace}?tab=questions` });
  await expect(page.getByText(/Pernah dibuka — pertanyaan, target, dan roster terkunci permanen/)).toBeVisible();
  await expect(page.getByLabel('Nama target penilaian')).toBeDisabled();
  for (const n of [1, 2]) {
    await expect(page.getByLabel(`Pertanyaan ${n}`, { exact: true })).toBeDisabled();
    await expect(page.getByLabel(`Jenis jawaban pertanyaan ${n}`, { exact: true })).toBeDisabled();
  }
  for (const checkbox of await page.getByRole('checkbox', { name: 'Wajib diisi' }).all()) await expect(checkbox).toBeDisabled();
  await expect(page.getByRole('button', { name: /Tambah pertanyaan|Naikkan pertanyaan|Turunkan pertanyaan|Hapus pertanyaan/ })).toHaveCount(0);
  await page.getByLabel('Judul periode', { exact: true }).fill('Metadata baru');
  await page.getByRole('button', { name: 'Simpan form' }).click();
  await expect(page.getByRole('heading', { name: 'Metadata baru', exact: true })).toBeVisible();
  const put = calls.find(c => c.method === 'PUT');
  expect(Object.keys(put.body).sort()).toEqual(['closes_at', 'description', 'opens_at', 'title']);
  expect(put.body.title).toBe('Metadata baru');
  await tab(page, 'Pengisi').click();
  await expect(page.getByRole('button', { name: '+ Tambah nama' })).toBeDisabled();
  for (const button of await page.getByRole('button', { name: 'Hapus', exact: true }).all()) await expect(button).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Hapus', exact: true })).toHaveCount(2);
  expect(calls.filter(c => c.method !== 'GET')).toEqual([put]);
});

for (const [name, slug, permission, path] of [
  ['non-BPH list', 'ristek', true, '/qpr'],
  ['non-BPH deep link', 'ristek', true, `${workspace}?tab=responses`],
  ['BPH without manage permission deep link', 'bph', false, `${workspace}?tab=questions`],
]) test(`${name} shows only own-division participation without admin QPR requests`, async ({ page }) => {
  const calls = await setup(page, { slug, permission, path });
  await expect(page.getByRole('heading', { name: 'Status pengisian QPR' })).toBeVisible();
  await expect(page.getByText('1 sudah mengisi · 1 belum mengisi · 2 anggota')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Progres respons final' })).toHaveAttribute('value', '1');
  await expect(page.getByRole('progressbar', { name: 'Progres respons final' })).toHaveAttribute('max', '2');
  await expect(page.getByRole('link', { name: 'Buka form pengisian' })).toHaveAttribute('href', '#/qpr/period-admin');
  if (path !== '/qpr') await expect(page.getByText('Pengelolaan dan hasil QPR khusus BPH.')).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('pending');
  await expect(page.getByText('Draft Ristek (anggota) — Belum mengisi')).toBeVisible();
  await expect(page.getByText('Selesai Ristek (anggota) — Sudah mengisi')).toHaveCount(0);
  await expect(page.getByText('Pengisi Kedua', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Bagian kampanye' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Periode baru' })).toHaveCount(0);
  expect(calls.some(c => c.path === '/qpr-participation/period-admin')).toBe(true);
  expect(calls.filter(c => c.path.startsWith('/admin/qpr'))).toEqual([]);
});

test('preview answers and review stay local, switching respondent clears answers', async ({ page }) => {
  const calls = await setup(page, { path: `${workspace}?tab=preview` });
  await expect(page.getByText('Mode pratinjau. Jawaban hanya lokal dan tidak dikirim sebagai respons.')).toBeVisible();
  await page.getByRole('radio', { name: '4 — Baik', exact: true }).check();
  await page.getByLabel('Saran untuk Ketua', { exact: true }).fill('Pertahankan komunikasi rutin.');
  await expect(page.getByRole('progressbar', { name: 'Pertanyaan wajib terisi' })).toHaveAttribute('value', '2');
  await page.getByRole('button', { name: 'Tinjau jawaban', exact: true }).click();
  await expect(page.getByRole('definition').filter({ hasText: 'Pertahankan komunikasi rutin.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kirim|Simpan draft/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ubah Ketua Umum', exact: true }).click();
  await expect(page.getByRole('radio', { name: '4 — Baik', exact: true })).toBeChecked();
  await page.getByLabel('Pratinjau sebagai pengisi').selectOption('e2');
  await expect(page.getByLabel('Saran untuk Ketua', { exact: true })).toHaveValue('');
  await expect(page.getByRole('radio', { name: '4 — Baik', exact: true })).not.toBeChecked();
  await expect(page.getByRole('progressbar', { name: 'Pertanyaan wajib terisi' })).toHaveAttribute('value', '0');
  await tab(page, 'Ringkasan').click();
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
  expect(calls.filter(c => c.path.startsWith('/qpr/'))).toEqual([]);
});

test('opening with preview blockers never posts open and exposes blocker', async ({ page }) => {
  const calls = await setup(page, { path: workspace, blockers: ['Nama target Ketua belum lengkap'] });
  await page.getByRole('button', { name: 'Buka kampanye', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, buka', exact: true }).click();
  await expect(tab(page, 'Pratinjau')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Nama target Ketua belum lengkap', { exact: true })).toBeVisible();
  expect(calls.some(c => c.path === `${periodPath}/preview`)).toBe(true);
  expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
});
