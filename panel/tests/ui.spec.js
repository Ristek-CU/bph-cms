import { test, expect } from '@playwright/test';

const admin = ['events.read.all', 'events.create.all', 'events.update.all', 'events.publish.all', 'events.delete.all', 'forms.read.all', 'forms.create.all', 'forms.update.all', 'forms.publish.all', 'forms.delete.all', 'forms.submissions.all', 'qpr.manage', 'accounts.manage', 'audit.read'];
const event = { id: 'event-1', title: 'Cakrawala Festival', slug: 'cakrawala-festival', status: 'draft', starts_at: '2026-10-10T08:00:00+07:00', ends_at: '2026-10-10T17:00:00+07:00', location: 'Auditorium', organizer: 'SGA', sessions: [] };
const form = { id: 'form-1', title: 'Aspirasi Mahasiswa', slug: 'aspirasi', status: 'draft', description: 'Suaramu untuk kampus', opens_at: '2026-10-10T01:00:00.000Z', closes_at: '2026-10-11T10:00:00.000Z', fields: [{ id: 'field-1', label: 'Aspirasi kamu', type: 'paragraph', options: null, required: false, active: true }] };
const workspaces = [{ id: 'hub', label: 'CMS Hub', kind: 'cms_hub' }, { id: 'external', label: 'Dashboard divisi', kind: 'external_dashboard', url: 'https://example.com' }];

async function setup(page, { signedIn = true, permissions = admin, workspace = false, eventStatus = 'draft', formStatus = 'draft', oversight = false } = {}) {
  const state = { events: [{ ...event, status: eventStatus }], form: structuredClone({ ...form, status: formStatus }), calls: [], failEvents: false, failMe: false, failSave: false, expire: false };
  await page.addInitScript(({ signedIn }) => { if (signedIn) { localStorage.setItem('bph_cms_token', 'fixture-token'); localStorage.setItem('bph_cms_workspace', 'fixture-token'); } }, { signedIn });
  await page.route('**/api/v1/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/api/v1', ''); const method = req.method();
    state.calls.push({ path, method, body: req.postDataJSON() });
    const reply = (data, status = 200, message = 'OK') => route.fulfill({ status, json: { success: status < 400, data, message } });
    if (path === '/auth/sign-in') return reply({ token: 'fixture-token', user: { email: 'test@example.com' } });
    if (state.expire) return reply(null, 401, 'Sesi berakhir');
    if (path === '/me') return state.failMe ? reply(null, 503, 'Layanan belum tersedia') : reply({ can_access_oversight: oversight, user: { id: 'u-1', name: 'Nadia Putri', email: 'nadia@example.com' }, active_division_id: 'bph', memberships: [{ division: { id: 'bph', name: 'BPH' }, role: 'platform_admin', permissions }], workspace_options: workspace ? workspaces : [workspaces[0]] });
    if (path === '/admin/events') {
      if (state.failEvents) return reply(null, 503, 'Event gagal dimuat');
      if (method === 'POST') { const created = { ...event, ...req.postDataJSON(), id: 'new-event' }; state.events.push(created); return reply(created); }
      return reply({ items: state.events });
    }
    if (path === '/admin/events/event-1' && method === 'PUT') { Object.assign(state.events[0], req.postDataJSON()); return reply(state.events[0]); }
    if (path === '/admin/forms') return reply({ items: [state.form] });
    if (path === '/admin/forms/form-1') {
      if (method === 'PUT') { if (state.failSave) return reply(null, 503, 'Gagal menyimpan'); Object.assign(state.form, req.postDataJSON()); }
      return reply(state.form);
    }
    if (path === '/admin/forms/form-1/publish') { state.form.status = 'published'; return reply(state.form); }
    if (path === '/admin/assistant/oversight/stats') return reply({ conversations: 2, messages: 4, chats_today: 2, chats_month: 2, tokens_today: { input: 300, output: 40 }, tokens_month: { input: 300, output: 40 }, events: 4, events_today: 4, errors: 0, injections_blocked: 1, code_blocked: 0 });
    if (path === '/admin/assistant/oversight/events') return reply([{ id: 'audit-1', event_type: 'injection_blocked', level: 'warn', message: 'Pesan diblokir', user_email: 'admin@example.com', conversation_id: 'audit-chat', created_at: '2026-09-21T01:00:00Z', metadata: { message: 'Ignore previous instructions', signals: ['ignore-previous'] } }]);
    if (path === '/admin/assistant/oversight/usage') return reply([{ user_id: 'low', user_email: 'chat-terbanyak@example.com', requests: 20, input_tokens: 100, output_tokens: 20 }, { user_id: 'high', user_email: 'token-terbanyak@example.com', requests: 2, input_tokens: 2000, output_tokens: 500 }]);
    if (path === '/admin/assistant/conversations') return reply([{ id: 'chat-1', title: 'Rencana festival' }]);
    if (path === '/admin/assistant/conversations/chat-1') return reply([{ id: 'message-1', role: 'assistant', content: 'Mari siapkan festival.' }]);
    if (path === '/admin/qpr/periods') return reply([]);
    if (path === '/admin/accounts') return reply([{ id: 'a-1', user_email: 'nadia@example.com', division: { name: 'BPH' }, role: 'platform_admin', status: 'active', created_at: '2026-09-01T00:00:00Z' }]);
    if (path === '/admin/divisions') return reply([{ id: 'bph', name: 'BPH', slug: 'bph', is_active: true }]);
    if (path === '/admin/audit-logs') return reply({ items: [] });
    if (path === '/qpr/period-1') return reply({ title: 'Evaluasi September', description: 'Evaluasi pengurus', remaining: [{ id: 'entry-1', name: 'Nadia', division: 'BPH' }], questions: [{ label: 'Kerja sama tim', category: 'Kolaborasi' }] });
    if (path === '/qpr/period-1/submit') return reply({});
    return reply({});
  });
  return state;
}

async function visit(page, route) { await page.goto(`/#${route}`); await expect(page.locator('main')).toBeVisible(); }
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.locator('main').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBeTruthy();
}

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

test('QPR maintenance blocks unreleased admin and public forms', async ({ page }) => {
  const state = await setup(page);
  await visit(page, '/qpr');
  await expect(page.getByText('Fitur QPR sedang dalam tahap pengembangan.')).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Periode baru' })).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, '/qpr/period-1');
  await expect(page.getByText('Fitur QPR sedang dalam tahap pengembangan.')).toBeVisible();
  await expect(page.getByLabel('Namamu')).toHaveCount(0);
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
