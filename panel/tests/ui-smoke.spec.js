import { test, expect } from '@playwright/test';
import { setup, visit, noOverflow, event } from './fixtures/panel.js';
import { setup as setupQpr, workspace } from './fixtures/qpr-admin.js';

const scanDir = process.env.UI_SCAN_DIR;
const widths = [1440, 1024, 768, 390, 320];
const longTitle = 'Rapat koordinasi pengurus lintas divisi — persiapan kegiatan mahasiswa semester berikutnya';

async function populated(page) {
  const state = await setup(page, { oversight: true });
  state.events[0].title = longTitle;
  state.form.title = longTitle;
  const agenda = { ...event, id: 'internal-1', title: longTitle, division_id: 'bph', division_name: 'BPH', status: 'published', description: 'Koordinasi persiapan acara dan pembagian tugas. '.repeat(12), sessions: [{ id: 's1', name: 'Pembahasan agenda dan kebutuhan kegiatan', starts_at: event.starts_at, ends_at: event.ends_at, speaker: 'Pengurus divisi', location: 'Ruang rapat' }] };
  await page.route('**/admin/internal-events**', route => route.fulfill({ json: { success: true, data: new URL(route.request().url()).pathname.endsWith('/internal-1') ? agenda : { items: [agenda] } } }));
  await page.route('**/admin/forms/form-1/analytics', route => route.fulfill({ json: { success: true, data: {
    title: longTitle, status: 'published', total_submissions: 10,
    last_7_days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-0${i + 1}`, count: i % 3 })),
    fields: [
      { id: 'choice', label: 'Kegiatan mana yang paling bermanfaat untuk pengembangan mahasiswa?', type: 'multiple_choice', response_rate: 100, distribution: { 'Diskusi bersama pengurus lintas divisi dan komunitas mahasiswa': 7, 'Lokakarya keterampilan untuk kegiatan semester berikutnya': 3 } },
      { id: 'text', label: 'Masukan untuk pengurus', type: 'paragraph', response_rate: 100, recent: ['Mohon informasi kegiatan dibagikan lebih awal. '.repeat(5)] },
    ],
  } } }));
  await page.route('**/admin/forms/form-1/submissions?**', route => route.fulfill({ json: { success: true, data: { items: [{ id: 'sub1', created_at: '2026-10-09T00:00:00Z', status: 'new', answers: [{ field_id: 'field-1', label: 'Saran untuk kegiatan berikutnya', value: 'Mohon informasi kegiatan dibagikan lebih awal. '.repeat(15) }] }], meta: { total: 1 } } } }));
  return state;
}

async function capture(page, name) {
  if (scanDir) await page.screenshot({ path: `${scanDir}/${name}.png` });
}

async function inspect(page, label) {
  await noOverflow(page);
  const unlabeled = await page.locator('main input:not([type="hidden"]), main textarea, main select').evaluateAll(nodes => nodes.filter(el => el.checkVisibility() && !el.labels?.length && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby')).map(el => el.outerHTML.slice(0, 180)));
  expect.soft(unlabeled, `${label}: controls need labels`).toEqual([]);
  const wide = await page.locator('main').evaluate(el => [...el.querySelectorAll('*')].filter(node => {
    if (!node.checkVisibility() || node.closest('.tbl-wrap, .cal-cell')) return false;
    const r = node.getBoundingClientRect(); const parent = el.getBoundingClientRect();
    return r.width > 0 && (r.left < parent.left - 1 || r.right > parent.right + 1);
  }).slice(0, 8).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 100) })));
  expect.soft(wide, `${label}: content escapes main`).toEqual([]);
}

for (const width of widths) test(`visual smoke populated routes at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await populated(page);
  for (const route of ['/overview', '/events', '/events/kalender', '/events/event-1/edit', '/internal-events', '/internal-events/internal-1', '/internal-events/internal-1/edit', '/internal-events/kalender', '/forms', '/forms/form-1', '/forms/form-1/analytics', '/accounts', '/roro-oversight']) {
    await visit(page, route);
    await expect(page.locator('.skeleton-card, .auth-loading')).toHaveCount(0);
    const name = `${width}${route.replaceAll('/', '-')}`;
    await inspect(page, name);
    await capture(page, `${name}-top`);
    if (route.endsWith('/analytics')) {
      await page.getByRole('img', { name: /Distribusi jawaban/ }).scrollIntoViewIfNeeded();
      await capture(page, `${name}-chart`);
    }
    if (route === '/forms') expect((await page.locator('.form-card').first().boundingBox()).width).toBeGreaterThanOrEqual(Math.min(300, width - 28));
    if (route.endsWith('/edit')) {
      const fields = page.locator('.section').first().locator('.field-block');
      const first = await fields.nth(0).boundingBox(); const next = await fields.nth(1).boundingBox();
      expect(next.y - first.y - first.height).toBeGreaterThanOrEqual(16);
    }
    const scroll = page.locator('.event-editor-scroll, main.page').last();
    // Scroll the actual content pane: a full-page screenshot only captures its first screen.
    await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await inspect(page, `${name}-bottom`);
    await capture(page, `${name}-bottom`);
  }
  expect(errors).toEqual([]);
});

for (const width of [1440, 390, 320]) test(`visual smoke QPR workspace tabs at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await setupQpr(page, { path: workspace });
  for (const name of ['Ringkasan', 'Pertanyaan', 'Pengisi', 'Pratinjau', 'Respons (0)']) {
    await page.getByRole('navigation', { name: 'Bagian kampanye' }).getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.skeleton-card')).toHaveCount(0);
    await inspect(page, `QPR ${width} ${name}`);
    await capture(page, `${width}-qpr-${name}`);
    if (name === 'Pertanyaan') {
      const bar = await page.locator('.qpr-save-bar').boundingBox();
      expect(900 - bar.y - bar.height).toBeLessThanOrEqual(24);
      await page.getByLabel('Pertanyaan 2', { exact: true }).scrollIntoViewIfNeeded();
      await page.getByLabel('Pertanyaan 2', { exact: true }).fill('Masukan yang bisa dilakukan pada periode berikutnya');
      await expect(page.getByRole('button', { name: 'Simpan form' })).toBeEnabled();
      await page.getByRole('button', { name: 'Simpan form' }).click();
      await expect(page.getByText('Semua perubahan tersimpan', { exact: true })).toBeVisible();
      await capture(page, `${width}-qpr-editor-bottom`);
    }
  }
});

test('read-only calendar does not offer a create action', async ({ page }) => {
  await setup(page, { permissions: ['events.read.all'] });
  await visit(page, '/internal-events/kalender');
  await expect(page.getByText(/Belum ada agenda internal untuk/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buat internal event' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: 'Tampilan event internal' });
  await expect(nav.getByRole('link', { name: 'Kalender lintas divisi' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Daftar', exact: true }).click();
  await expect(nav.getByRole('link', { name: 'Daftar', exact: true })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('link', { name: 'Kalender lintas divisi' }).click();
  await expect(page.getByText(/Belum ada agenda internal untuk/)).toBeVisible();
});

test('mobile account tabs, long tables and form editor remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await populated(page); await visit(page, '/accounts');
  await page.getByRole('button', { name: 'Divisi', exact: true }).click();
  await expect(page.getByLabel('Nama', { exact: true })).toBeVisible();
  await page.getByLabel('Nama', { exact: true }).fill('Riset dan Teknologi');
  await inspect(page, 'divisions');
  await page.getByRole('button', { name: 'Audit log', exact: true }).click();
  await expect(page.getByText('Belum ada aktivitas.')).toBeVisible();
  await capture(page, '320-audit-empty');
  await visit(page, '/forms/form-1');
  await page.getByRole('button', { name: 'Edit pertanyaan Aspirasi kamu' }).click();
  await page.getByLabel('Label pertanyaan', { exact: true }).fill('Apa yang perlu diperbaiki dari kegiatan semester berikutnya?');
  await page.getByRole('button', { name: 'Pilih tipe pertanyaan', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.getByLabel('Label pertanyaan')).toHaveValue('Apa yang perlu diperbaiki dari kegiatan semester berikutnya?');
  await expect(page.getByRole('button', { name: 'Pilih tipe pertanyaan', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: 'Jawaban singkat', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Selesai', exact: true }).scrollIntoViewIfNeeded();
  await inspect(page, 'inline form editor'); await capture(page, '320-field-editor');
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(page.getByText('Pertanyaan diperbarui.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hapus form', exact: true }).click();
  const modal = page.getByRole('alertdialog'); await expect(modal).toBeVisible();
  const cancel = modal.getByRole('button', { name: 'Batal', exact: true });
  expect((await cancel.boundingBox()).width).toBeGreaterThan(240);
  await cancel.scrollIntoViewIfNeeded(); await capture(page, '320-form-confirm');
  await cancel.click(); await expect(modal).toHaveCount(0);
});

test('list errors have working retry and search explains empty results', async ({ page }) => {
  const state = await setup(page); state.failEvents = true;
  await visit(page, '/events');
  await expect(page.getByText('Event gagal dimuat', { exact: true })).toBeVisible();
  state.failEvents = false;
  await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
  await page.getByLabel('Cari event').fill('Tidak ada kegiatan ini');
  await expect(page.locator('.empty-state')).toBeVisible();
  await capture(page, 'events-search-empty');
});

test('mobile navigation remains usable after resizing to desktop', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await visit(page, '/events');
  await page.getByRole('button', { name: 'Buka menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Navigasi utama' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.content')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('dialog', { name: 'Navigasi utama' })).toHaveCount(0);
  await page.getByLabel('Cari event').fill('Cakrawala');
});
