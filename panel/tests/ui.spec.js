import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { admin, event, form, workspaces, setup, visit, noOverflow } from './fixtures/panel.js';

test('event search includes later API pages', async ({ page }) => {
  await setup(page);
  await page.route('**/admin/events?**', route => {
    const second = new URL(route.request().url()).searchParams.get('page') === '2';
    return route.fulfill({ json: { success: true, data: { items: [{ ...event, id: second ? 'later' : event.id, title: second ? 'Event halaman kedua' : event.title }], meta: { page: second ? 2 : 1, per_page: 1, total: 2 } } } });
  });
  await visit(page, '/events');
  await page.getByLabel('Cari event').fill('Event halaman kedua');
  await expect(page.getByRole('heading', { name: 'Event halaman kedua' })).toBeVisible();
});

test('calendar ignores an older month response that arrives after navigation', async ({ page }) => {
  await setup(page);
  let releaseOld;
  const oldResponse = new Promise(resolve => { releaseOld = resolve; });
  let requested = 0;
  let firstMonth;
  await page.route('**/admin/internal-events/calendar?**', async route => {
    requested++;
    const month = new URL(route.request().url()).searchParams.get('month');
    firstMonth ??= month;
    const first = month === firstMonth;
    if (first) await oldResponse;
    await route.fulfill({ json: { success: true, data: { items: [{ ...event, status: 'published', title: first ? 'Agenda bulan lama' : 'Agenda bulan terpilih' }] } } });
  });
  await visit(page, '/internal-events/kalender');
  await expect.poll(() => requested).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Bulan berikutnya' }).click();
  await expect(page.getByRole('heading', { name: 'Agenda bulan terpilih' })).toBeVisible();
  const receivedOld = page.waitForResponse(r => r.url().includes('/internal-events/calendar?'));
  releaseOld(); await receivedOld;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('heading', { name: 'Agenda bulan terpilih' })).toBeVisible();
});

test('form autosave keeps server question IDs across successive edits', async ({ page }) => {
  const state = await setup(page);
  await visit(page, '/forms/form-1');
  await page.getByRole('button', { name: 'Edit pertanyaan Aspirasi kamu' }).click();
  await page.getByLabel('Label pertanyaan').fill('Aspirasi terbaru');
  await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(page.getByText('Pertanyaan diperbarui.', { exact: true })).toBeVisible();
  expect(state.calls.find(c => c.method === 'PUT').body.fields[0].id).toBe('field-1');
});

test('mobile form configuration is reachable before expanding sharing tools', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, '/forms/form-1');
  const bounds = await page.getByRole('heading', { name: 'Konfigurasi & publikasi' }).boundingBox();
  expect(bounds.y).toBeLessThan(650);
  await page.locator('summary').filter({ hasText: 'Bagikan form' }).click();
  await expect(page.getByAltText('QR code menuju form Aspirasi Mahasiswa')).toBeVisible();
  await noOverflow(page);
});

test('failed logout keeps the session and explains how to retry', async ({ page }) => {
  await setup(page); await visit(page, '/events');
  await page.route('**/auth/panel-sign-out', route => route.fulfill({ status: 503, json: { success: false, message: 'Logout belum berhasil. Coba lagi.' } }));
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Logout belum berhasil' })).toBeVisible();
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('bph_cms_token'))).toBe('panel-session');
});

test('form response export escapes formulas and retains distinct same-label answers', async ({ page }) => {
  await setup(page);
  await page.route('**/admin/forms/form-1/analytics', route => route.fulfill({ json: { success: true, data: { total_submissions: 1, last_7_days: [], fields: [] } } }));
  await page.route('**/admin/forms/form-1/submissions?**', route => route.fulfill({ json: { success: true, data: { items: [{
    id: 'submission-1', created_at: '2026-10-09T00:00:00Z', status: 'new',
    answers: [{ field_id: 'first', label: 'Jawaban', value: '=1+1' }, { field_id: 'second', label: 'Jawaban', value: 'Jawaban kedua' }],
  }], meta: { total: 1 } } } }));
  await visit(page, '/forms/form-1/analytics');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Ekspor CSV' }).click();
  const csv = await readFile(await (await downloaded).path(), 'utf8');
  expect(csv).toContain("'=1+1");
  expect(csv).toContain('Jawaban kedua');
});

test('response attachments download with the panel session and readable filename', async ({ page }) => {
  await setup(page);
  await page.route('**/admin/forms/form-1/analytics', route => route.fulfill({ json: { success: true, data: { total_submissions: 1, last_7_days: [], fields: [] } } }));
  await page.route('**/admin/forms/form-1/submissions?**', route => route.fulfill({ json: { success: true, data: { items: [{
    id: 'submission-1', created_at: '2026-10-09T00:00:00Z', status: 'new', answers: [],
    files: [{ id: 'file-1', original_filename: 'bukti.pdf', file_size: 15 }],
  }], meta: { total: 1 } } } }));
  let authorization;
  await page.route('**/submissions/submission-1/files/file-1', route => {
    authorization = route.request().headers().authorization;
    return route.fulfill({ contentType: 'application/octet-stream', body: '%PDF-1.4 fixture' });
  });
  await visit(page, '/forms/form-1/analytics');
  await page.locator('.sub-summary').click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Unduh bukti.pdf' }).click();
  expect((await downloaded).suggestedFilename()).toBe('bukti.pdf');
  expect(authorization).toBe('Bearer panel-session');
});

test('topbar back preserves unsaved form changes when departure is cancelled', async ({ page }) => {
  await setup(page); await visit(page, '/forms/form-1');
  await page.getByLabel('Judul', { exact: true }).fill('Belum disimpan');
  let confirmation = false;
  page.on('dialog', async dialog => { confirmation = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Kembali ke halaman sebelumnya' }).click();
  await expect(page.getByLabel('Judul', { exact: true })).toHaveValue('Belum disimpan');
  expect(confirmation).toBe(true);
});

test('login preserves a protected deep link and workspace dismissal', async ({ page }) => {
  await setup(page, { signedIn: false, workspace: true });
  await visit(page, '/events/event-1/edit');
  await page.getByLabel('Email pengurus').fill('test@example.com');
  await page.getByLabel('Password', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Lihat password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Nama event')).toHaveValue(event.title);
  await expect(page).toHaveURL(/events\/event-1\/edit/);
  await page.reload();
  await expect(page.getByLabel('Nama event')).toHaveValue(event.title);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('workspace overlay retains unsaved editor state', async ({ page }) => {
  await setup(page, { workspace: true }); await visit(page, '/events/event-1/edit');
  await page.getByLabel('Nama event').fill('Perubahan belum disimpan');
  await page.getByRole('button', { name: 'Ganti dashboard' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Nama event')).toHaveValue('Perubahan belum disimpan');
});

test('contributor can edit drafts but cannot publish or delete', async ({ page }) => {
  await setup(page, { permissions: ['events.read.own_division', 'events.update_draft.own_division'] });
  await visit(page, '/events/event-1/edit');
  await expect(page.getByRole('button', { name: 'Simpan Perubahan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Terbitkan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hapus Permanen' })).toHaveCount(0);
});

test('viewer direct edit route has no editing controls', async ({ page }) => {
  await setup(page, { permissions: ['events.read.own_division'] }); await visit(page, '/events/event-1/edit');
  await expect(page.getByText('Akun ini tidak punya akses untuk aksi tersebut.')).toBeVisible();
  await expect(page.getByLabel('Nama event')).toHaveCount(0);
});

test('failed loading has retry instead of empty events', async ({ page }) => {
  const state = await setup(page); state.failEvents = true; await visit(page, '/events');
  await expect(page.getByRole('heading', { name: 'Event belum bisa dimuat' })).toBeVisible();
  await expect(page.getByText('Belum ada event sama sekali.')).toHaveCount(0);
  state.failEvents = false; await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
});

test('failed identity lookup can recover', async ({ page }) => {
  const state = await setup(page); state.failMe = true; await visit(page, '/forms');
  await expect(page.getByRole('heading', { name: 'Dashboard belum bisa dibuka' })).toBeVisible();
  state.failMe = false; await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByRole('heading', { name: 'Campaign & Polling' })).toBeVisible();
});

test('search can reset without showing the first-event action', async ({ page }) => {
  await setup(page); await visit(page, '/events');
  await page.getByLabel('Cari event').fill('no-match');
  await expect(page.getByRole('button', { name: 'Buat event pertama' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset pencarian & filter' }).click();
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
});

test('published event saves report the correct state', async ({ page }) => {
  await setup(page, { eventStatus: 'published' }); await visit(page, '/events/event-1/edit');
  await page.getByLabel('Nama event').fill('Festival diperbarui');
  await page.getByRole('button', { name: 'Simpan Perubahan' }).click();
  await expect(page.getByText('Perubahan event tersimpan dan tampil di portal.')).toBeVisible();
});

test('invalid new event focuses first invalid field', async ({ page }) => {
  await setup(page); await visit(page, '/events/baru');
  await page.getByRole('button', { name: 'Simpan Draft', exact: true }).click();
  await expect(page.getByLabel('Nama event')).toBeFocused();
  await expect(page.getByLabel('Nama event')).toHaveAttribute('aria-invalid', 'true');
});

test('form dates preserve WIB and publication saves latest changes first', async ({ page }) => {
  const state = await setup(page); await visit(page, '/forms/form-1');
  await expect(page.getByLabel('Buka (WIB)')).toHaveValue('2026-10-10T08:00');
  await page.getByLabel('Judul', { exact: true }).fill('Aspirasi terbaru');
  await page.getByRole('button', { name: 'Simpan & terbitkan' }).click();
  await expect(page.getByText('Form diterbitkan — link publik aktif.')).toBeVisible();
  const writes = state.calls.filter(c => c.method !== 'GET');
  expect(writes.map(c => [c.method, c.path])).toEqual([['PUT', '/admin/forms/form-1'], ['POST', '/admin/forms/form-1/publish']]);
  expect(writes[0].body.title).toBe('Aspirasi terbaru');
  expect(writes[0].body.opens_at).toBe('2026-10-10T08:00:00+07:00');
});

test('published form public link opens normally', async ({ page, context }) => {
  await setup(page, { formStatus: 'published' });
  await context.route('https://sga-cakrawala.org/**', route => route.fulfill({ body: 'Fixture public form' }));
  await visit(page, '/forms/form-1');
  const popup = page.waitForEvent('popup'); await page.getByRole('link', { name: 'Form publik', exact: true }).click();
  await expect(await popup).toHaveURL('https://sga-cakrawala.org/aspirasi');
});

test('question edits survive failed save and can retry', async ({ page }) => {
  const state = await setup(page); await visit(page, '/forms/form-1');
  await page.getByRole('button', { name: 'Edit pertanyaan Aspirasi kamu' }).click();
  await page.getByLabel('Label pertanyaan').fill('Pertanyaan yang diperbarui');
  state.failSave = true; await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(page.getByText('Gagal menyimpan', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Label pertanyaan')).toHaveValue('Pertanyaan yang diperbarui');
  state.failSave = false; await page.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(page.getByText('Pertanyaan diperbarui.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Label pertanyaan')).toHaveCount(0);
});

test('audit-only user does not see account mutation tabs', async ({ page }) => {
  await setup(page, { permissions: ['audit.read'] }); await visit(page, '/accounts');
  await expect(page.getByRole('heading', { name: 'Audit Log (50 terbaru)' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Akun', exact: true })).toHaveCount(0);
});

test('QPR campaign dashboard and legacy public form remain available', async ({ page }) => {
  const state = await setup(page);
  await visit(page, '/qpr');
  await expect(page.getByRole('button', { name: '+ Periode baru' })).toBeVisible();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.setViewportSize({ width: 320, height: 844 });
  await visit(page, '/qpr/period-1');
  await expect(page.getByLabel('Namamu')).toBeVisible();
  await expect(page.getByRole('group', { name: /Kerja sama tim/ })).toBeVisible();
  expect(state.calls.filter(c => c.path.includes('/qpr/') && c.method !== 'GET')).toEqual([]);
  await noOverflow(page);
});

test('mobile navigation and Roro history work with keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page); await visit(page, '/');
  await page.getByRole('button', { name: 'Riwayat chat', exact: true }).click();
  await page.getByRole('button', { name: 'Rencana festival', exact: true }).click();
  await expect(page.getByText('Mari siapkan festival.')).toBeVisible();
  await page.getByRole('button', { name: 'Buka menu' }).click();
  await page.getByRole('link', { name: 'Event', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Buka menu' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
  await noOverflow(page);
});

test('expired session returns to login with explanation and keeps route', async ({ page }) => {
  const state = await setup(page); await visit(page, '/events');
  await expect(page.getByRole('heading', { name: event.title })).toBeVisible();
  state.expire = true; await page.evaluate(() => window.dispatchEvent(new Event('bph:events-changed')));
  await expect(page.getByRole('heading', { name: 'Masuk ke ruang kerja' })).toBeVisible();
  await expect(page.getByText('Sesi kamu berakhir. Masuk lagi untuk melanjutkan.')).toBeVisible();
  await expect(page).toHaveURL(/#\/events$/);
});

test('all main pages render at desktop and narrow mobile widths', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/overview', '/events', '/events/kalender', '/events/baru', '/forms', '/forms/form-1', '/qpr', '/accounts']) {
      await visit(page, route);
      await expect(page.locator('.auth-loading')).toHaveCount(0);
      await page.locator('.skeleton-card').waitFor({ state: 'hidden' }).catch(() => {});
      await noOverflow(page);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(901);
      if (width !== 320) await page.screenshot({ path: testInfo.outputPath(`${width}-${route.replaceAll('/', '_') || 'home'}.png`), fullPage: true });
    }
  }
  expect(errors).toEqual([]);
});


test('Roro login mascot and release remain visible on narrow mobile', async ({ page }, testInfo) => {
  await setup(page, { signedIn: false });
  await page.setViewportSize({ width: 375, height: 812 });
  await visit(page, '/login');
  await expect(page.getByAltText('Roro, asisten SGA yang siap membantu')).toBeVisible();
  const mascotBounds = await page.locator('.login-roro-mascot').boundingBox();
  const storyBounds = await page.locator('.login-story').boundingBox();
  expect(mascotBounds.y + mascotBounds.height).toBeLessThanOrEqual(storyBounds.y + storyBounds.height - 12);
  await expect(page.locator('.release-stamp')).toHaveText(/^SGA Hub CMS v1\.0(?:\.\d+)?$/);
  expect(await page.locator('.login-roro-mascot').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('login-mobile.png'), fullPage: true });
});

test('mobile chat composer stays in view on short screens and long conversations', async ({ page }, testInfo) => {
  await setup(page);
  await page.route('**/admin/assistant/conversations/chat-1', route => route.fulfill({ json: { success: true, data: Array.from({ length: 30 }, (_, i) => ({ id: `m-${i}`, role: i % 2 ? 'assistant' : 'user', content: 'Rencana kegiatan divisi. '.repeat(12) })) } }));
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 390, height: 400 }, { width: 390, height: 300 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await visit(page, '/');
    const input = page.getByRole('textbox', { name: 'Pesan untuk Roro' });
    const menu = await page.getByRole('button', { name: 'Buka menu' }).boundingBox();
    expect(menu.width).toBeGreaterThanOrEqual(44);
    expect(menu.height).toBeGreaterThanOrEqual(44);
    // visualViewport resize is delivered asynchronously after setViewportSize.
    await expect.poll(() => input.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(viewport.height);
    expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Riwayat chat', exact: true }).click();
    await page.getByRole('button', { name: 'Rencana festival', exact: true }).click();
    await expect(page.locator('.roro-msg')).toHaveCount(30);
    await input.fill('Baris satu\nBaris dua\nBaris tiga');
    if (viewport.height === 300) await input.fill('Pesan panjang\n'.repeat(8));
    const after = await input.boundingBox();
    expect(after.y + after.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height + 1);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`chat-${viewport.width}-${viewport.height}.png`) });
  }
});

test('Roro login image has enough resolution for a 3x display', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ deviceScaleFactor: 3, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  try {
    await setup(page, { signedIn: false });
    await visit(page, '/login');
    const mascot = page.getByAltText('Roro, asisten SGA yang siap membantu');
    await expect.poll(() => mascot.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await mascot.evaluate(el => el.naturalWidth >= el.clientWidth * devicePixelRatio && el.naturalHeight >= el.clientHeight * devicePixelRatio)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('login-retina.png'), fullPage: true });
  } finally { await context.close(); }
});

test('Roro Enter creates new lines and long messages wrap on mobile', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await visit(page, '/');
  const input = page.getByRole('textbox', { name: 'Pesan untuk Roro' });
  const initialHeight = await input.evaluate(el => el.clientHeight);
  await input.fill('Baris pertama');
  await input.press('Enter');
  await input.pressSequentially('Baris kedua');
  await expect(input).toHaveValue('Baris pertama\nBaris kedua');
  expect(state.calls.filter(c => c.path.includes('/chat/stream'))).toHaveLength(0);
  expect(await input.evaluate(el => el.clientHeight)).toBeGreaterThan(initialHeight);
  const message = 'Baris pertama\nBaris kedua\n' + 'panjang'.repeat(150);
  await input.fill(message);
  expect(await input.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await input.evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(180);
  await page.route('**/admin/assistant/chat/stream', route => {
    expect(route.request().postDataJSON().message).toBe(message);
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', conversation_id: 'chat-1', message_id: 'reply-1', reply: 'Pesan diterima.' })}\n\n` });
  });
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await expect(page.locator('.roro-msg.user .roro-bubble')).toHaveText(message);
  expect(await page.locator('.roro-msg.user .roro-bubble').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(input).toHaveValue('');
  await noOverflow(page);
});

test('Ristek can inspect blocked prompt and sort token and chat leaders', async ({ page }) => {
  await setup(page, { oversight: true });
  await visit(page, '/roro-oversight');
  await page.getByText('Detail aktivitas', { exact: true }).click();
  await expect(page.getByText(/Ignore previous instructions/)).toBeVisible();
  await page.getByRole('button', { name: 'Penggunaan', exact: true }).click();
  await expect(page.locator('.usage-row').first()).toContainText('token-terbanyak@example.com');
  await expect(page.locator('.usage-row').first()).toContainText('2.000 input / 500 output');
  await page.getByLabel('Urutkan').selectOption('requests');
  await expect(page.locator('.usage-row').first()).toContainText('chat-terbanyak@example.com');
  await page.setViewportSize({ width: 375, height: 812 });
  await noOverflow(page);
});

// QA regression cases: populated fixtures and short desktop viewports matter.
test('QA login banner is flush at every desktop height', async ({ page }) => {
  await setup(page, { signedIn: false });
  for (const height of [600, 768, 1000]) {
    await page.setViewportSize({ width: 1280, height });
    await visit(page, '/login');
    expect((await page.locator('.login-story').boundingBox()).y).toBe(0);
  }
});

test('QA event actions never cover the form scroll area', async ({ page }) => {
  await setup(page); await visit(page, '/events/baru');
  await page.getByRole('button', { name: '+ Tambah sesi', exact: true }).click();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 768 });
    const scroll = await page.locator('.event-editor-scroll').count() ? page.locator('.event-editor-scroll') : page.locator('main.page');
    await expect(scroll).toBeVisible();
    for (const offset of [0, 450, 99999]) {
      await scroll.evaluate((el, y) => { el.scrollTop = y; }, offset);
      const content = await scroll.boundingBox();
      const bar = await page.locator('.sticky-bar').boundingBox();
      expect(content.y + content.height).toBeLessThanOrEqual(bar.y + 1);
      expect(bar.y + bar.height).toBeLessThanOrEqual(768);
    }
    await page.getByLabel('Jam selesai sesi 1', { exact: true }).scrollIntoViewIfNeeded();
    const field = await page.getByLabel('Jam selesai sesi 1', { exact: true }).boundingBox();
    expect(field.y + field.height).toBeLessThanOrEqual((await page.locator('.sticky-bar').boundingBox()).y);
  }
});

test('QA event list has a working back button on direct entry', async ({ page }) => {
  await setup(page); await visit(page, '/events');
  await page.getByRole('button', { name: 'Kembali ke halaman sebelumnya', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('QA draft saves with an untouched optional session and stays private', async ({ page }) => {
  const state = await setup(page); await visit(page, '/events/baru?date=2026-10-10');
  await page.getByLabel('Nama event').fill('QA draft');
  await page.getByLabel(/^Lokasi/).fill('Auditorium');
  await page.getByRole('button', { name: '+ Tambah sesi', exact: true }).click();
  await expect(page.locator('.sess-head strong')).toHaveText('Sesi 1');
  await page.getByRole('button', { name: 'Simpan Draft', exact: true }).click();
  await expect(page.getByText('Event tersimpan sebagai draft.', { exact: true })).toBeVisible();
  const writes = state.calls.filter(c => c.method === 'POST');
  expect(writes).toHaveLength(1);
  expect(writes[0].body.status).toBe('draft');
  expect(writes[0].body.sessions).toEqual([]);
  await expect(page).toHaveURL(/events\/new-event\/edit/);
});

test('QA session identity and numbering stay stable while editing times', async ({ page }) => {
  await setup(page); await visit(page, '/events/baru?date=2026-10-10');
  await page.getByRole('button', { name: '+ Tambah sesi', exact: true }).click();
  await page.getByLabel('Nama sesi').fill('Pertama');
  await page.getByRole('button', { name: '+ Tambah sesi', exact: true }).click();
  await page.getByLabel('Nama sesi').nth(1).fill('Kedua');
  await page.getByLabel('Jam mulai sesi 2', { exact: true }).fill('07:00');
  await expect(page.getByLabel('Nama sesi').first()).toHaveValue('Pertama');
  await expect(page.locator('.sess-head strong')).toHaveText(['Sesi 1', 'Sesi 2']);
  await page.getByRole('button', { name: 'Hapus sesi', exact: true }).first().click();
  await expect(page.locator('.sess-head strong')).toHaveText('Sesi 1');
  await expect(page.getByLabel('Nama sesi')).toHaveValue('Kedua');
});

test('QA populated upcoming events keep full links and readable actions', async ({ page }, testInfo) => {
  await setup(page);
  const slug = 'agenda-publik-dengan-nama-yang-panjang-'.repeat(3);
  await page.route('**/admin/events/calendar', route => route.fulfill({ json: { success: true, data: { items: [{ ...event, status: 'published', slug, starts_at: '2099-10-10T08:00:00+07:00', ends_at: '2099-10-10T17:00:00+07:00' }] } } }));
  for (const width of [1280, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 }); await visit(page, '/overview');
    const link = page.locator('.overview-grid .slug');
    await expect(link).toContainText(slug);
    await expect(page.locator('.upcoming-event p')).not.toContainText('WIB WIB');
    expect(await link.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const button = page.getByRole('button', { name: 'Salin link', exact: true });
    expect(await button.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('nowrap');
    await page.locator('.upcoming-events').screenshot({ path: testInfo.outputPath(`upcoming-${width}.png`) });
    await noOverflow(page);
  }
});

test('QA Roro retires an earlier proposal when a revision arrives', async ({ page }) => {
  await setup(page);
  const proposal = { tool: 'create_event', data: event };
  await page.route('**/admin/assistant/conversations/chat-1', route => route.fulfill({ json: { success: true, data: [{ id: 'old', role: 'assistant', content: 'Draf awal', proposal_json: proposal, proposal_status: 'pending' }] } }));
  await page.route('**/admin/assistant/chat/stream', route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', conversation_id: 'chat-1', message_id: 'new', reply: 'Draf diperbarui', proposal })}\n\n` }));
  await visit(page, '/');
  await page.getByRole('button', { name: 'Rencana festival', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pesan untuk Roro' }).fill('Revisi nama event');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await expect(page.getByText('Draf diperbarui', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iya, buatkan event', exact: true })).toHaveCount(1);
});

test('QA date and time picker has explicit commit, cancel and scroll controls', async ({ page }, testInfo) => {
  await setup(page); await visit(page, '/events/baru?date=2026-10-10');
  await page.getByRole('button', { name: 'Pilih tanggal dan waktu: Mulai', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Pilih tanggal dan waktu' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '11 Oktober 2026', exact: true }).click();
  await dialog.getByRole('button', { name: 'Jam 09', exact: true }).click();
  await dialog.getByRole('button', { name: 'Menit 45', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Gulir menit ke bawah' })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('picker-desktop.png') });
  await expect(page.getByLabel(/^Mulai \*/)).toHaveValue('2026-10-10T08:00');
  await dialog.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel(/^Mulai \*/)).toHaveValue('2026-10-11T09:45');
  await page.getByRole('button', { name: 'Pilih tanggal dan waktu: Mulai', exact: true }).click();
  await dialog.getByRole('button', { name: '12 Oktober 2026', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel(/^Mulai \*/)).toHaveValue('2026-10-11T09:45');
});

test('QA Roro keeps earlier messages when a follow-up stream fails', async ({ page }) => {
  await setup(page);
  let turn = 0;
  await page.route('**/admin/assistant/chat/stream', route => route.fulfill({ contentType: 'text/event-stream', body: ++turn === 1
    ? `data: ${JSON.stringify({ type: 'done', conversation_id: 'chat-1', message_id: 'reply-1', reply: 'Jawaban pertama' })}\n\n`
    : `data: ${JSON.stringify({ type: 'error', message: 'Provider sementara tidak tersedia' })}\n\n` }));
  await visit(page, '/');
  const input = page.getByRole('textbox', { name: 'Pesan untuk Roro' });
  await input.fill('Pesan pertama');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await expect(page.getByText('Jawaban pertama', { exact: true })).toBeVisible();
  await input.fill('Pesan lanjutan');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await expect(input).toHaveValue('Pesan lanjutan');
  await expect(page.locator('.roro-msg.user')).toHaveText('Pesan pertama');
  await expect(page.getByText('Jawaban pertama', { exact: true })).toBeVisible();
});

test('QA public and internal drafts persist through the real Worker API', async ({ page }) => {
  test.setTimeout(90000);
  const { startHarness } = await import('../../src/test/harness.ts');
  const h = await startHarness();
  try {
    await setup(page);
    await page.route(/\/api\/v1\/admin\/(?:internal-)?events(?:[/?]|$)/, async route => {
      const req = route.request();
      const url = new URL(req.url());
      const response = await h.req(url.pathname + url.search, { method: req.method(), token: 'tok-bph', ...(req.method() !== 'GET' ? { json: req.postDataJSON() } : {}) });
      await route.fulfill({ status: response.status, json: response.body });
    });
    for (const internal of [false, true]) {
      const module = internal ? 'internal-events' : 'events';
      const table = internal ? 'internal_events' : 'events';
      const title = internal ? 'QA internal integration draft' : 'QA public integration draft';
      await visit(page, `/${module}/baru?date=2026-10-10`);
      await page.getByLabel('Nama event').fill(title);
      await page.getByLabel(/^Lokasi/).fill('Auditorium');
      await page.getByRole('button', { name: '+ Tambah sesi', exact: true }).click();
      await page.getByRole('button', { name: 'Simpan Draft', exact: true }).click();
      await expect(page.getByText(internal ? 'Internal event tersimpan sebagai draft divisi kamu.' : 'Event tersimpan sebagai draft.', { exact: true })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${module}/[^/]+/edit`));
      const rows = await h.sql(`SELECT id, slug, status FROM ${table} WHERE title = ?`, title);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('draft');
      expect((await h.req(`/api/v1/events/${rows[0].slug}`)).status).toBe(404);
      await page.reload();
      await expect(page.getByLabel('Nama event')).toHaveValue(title);
      await page.getByLabel('Nama event').fill(`${title} updated`);
      await page.getByRole('button', { name: 'Simpan Perubahan', exact: true }).click();
      await expect.poll(async () => (await h.sql(`SELECT title FROM ${table} WHERE id = ?`, rows[0].id))[0]?.title).toBe(`${title} updated`);
      await page.getByRole('button', { name: 'Kembali ke halaman sebelumnya', exact: true }).click();
      await expect(page.getByRole('heading', { name: `${title} updated`, exact: true })).toBeVisible();
    }
  } finally { await h.dispose(); }
});

// New picker also works with the narrow viewport where the original session fields clipped.
test('QA picker remains usable on mobile and returns focus after confirmation', async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await visit(page, '/internal-events/baru?date=2026-10-10');
  const trigger = page.getByRole('button', { name: 'Pilih tanggal dan waktu: Mulai', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Pilih tanggal dan waktu' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Bulan berikutnya' }).click();
  await dialog.getByRole('button', { name: '1 November 2026', exact: true }).click();
  await dialog.getByRole('button', { name: 'Selesai', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('picker-mobile.png') });
  await dialog.getByRole('button', { name: 'Selesai', exact: true }).click();
  await expect(trigger).toBeFocused();
  await expect(page.getByLabel(/^Mulai \*/)).toHaveValue('2026-11-01T08:00');
  await noOverflow(page);
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('QA ')) await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true });
});

test('Roro displays every draft from one multi-event response', async ({ page }) => {
  await setup(page);
  const proposals = [1, 2, 3].map(n => ({ tool: 'create_event', data: { ...event, title: `Agenda batch ${n}` } }));
  await page.route('**/admin/assistant/chat/stream', route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'done', conversation_id: 'chat-1', message_id: 'batch-1', reply: 'Tiga draf siap', proposal: proposals[0], additional_proposals: proposals.slice(1).map((proposal_json, i) => ({ id: `batch-${i + 2}`, role: 'assistant', content: 'Periksa draf ini', proposal_json, proposal_status: 'pending' })) })}\n\n` }));
  await visit(page, '/');
  await page.getByRole('button', { name: 'Rencana festival', exact: true }).click();
  await page.getByRole('textbox', { name: 'Pesan untuk Roro' }).fill('Buat tiga acara sekaligus');
  await page.getByRole('button', { name: 'Kirim pesan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iya, buatkan event', exact: true })).toHaveCount(3);
  for (const n of [1, 2, 3]) await expect(page.getByText(`Agenda batch ${n}`, { exact: true })).toBeVisible();
});

test('late 401 from a previous login cannot clear the new session marker', async ({ page }) => {
  await setup(page); await visit(page, '/');
  let resolveStarted; const started = new Promise(resolve => { resolveStarted = resolve; });
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v1/admin/qa-old-session', async route => { resolveStarted(); await gate; await route.fulfill({ status: 401, json: { success: false, message: 'Sesi lama berakhir' } }); });
  await page.evaluate(async () => { const mod = await import('/src/api.js'); window.oldSessionRequest = mod.api('/admin/qa-old-session').catch(() => {}); });
  await started;
  await page.evaluate(async () => { (await import('/src/api.js')).setToken(); });
  release();
  await page.evaluate(() => window.oldSessionRequest);
  expect(await page.evaluate(() => sessionStorage.getItem('bph_cms_token'))).toBe('panel-session');
});

test('auth service outage retains panel session', async ({ page }) => {
  await setup(page); await visit(page, '/');
  await page.route('**/api/v1/admin/qa-auth-outage', route => route.fulfill({ status: 503, json: { success: false, message: 'Layanan autentikasi sementara tidak tersedia' } }));
  await page.evaluate(async () => { await (await import('/src/api.js')).api('/admin/qa-auth-outage').catch(() => {}); });
  expect(await page.evaluate(() => sessionStorage.getItem('bph_cms_token'))).toBe('panel-session');
});
