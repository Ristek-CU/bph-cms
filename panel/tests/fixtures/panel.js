import { expect } from '@playwright/test';

export const admin = ['events.read.all', 'events.create.all', 'events.update.all', 'events.publish.all', 'events.delete.all', 'forms.read.all', 'forms.create.all', 'forms.update.all', 'forms.publish.all', 'forms.delete.all', 'forms.submissions.all', 'qpr.manage', 'accounts.manage', 'audit.read'];
export const event = { id: 'event-1', title: 'Cakrawala Festival', slug: 'cakrawala-festival', status: 'draft', starts_at: '2026-10-10T08:00:00+07:00', ends_at: '2026-10-10T17:00:00+07:00', location: 'Auditorium', organizer: 'SGA', sessions: [] };
export const form = { id: 'form-1', title: 'Aspirasi Mahasiswa', slug: 'aspirasi', status: 'draft', description: 'Suaramu untuk kampus', opens_at: '2026-10-10T01:00:00.000Z', closes_at: '2026-10-11T10:00:00.000Z', fields: [{ id: 'field-1', label: 'Aspirasi kamu', type: 'paragraph', options: null, required: false, active: true }] };
export const workspaces = [{ id: 'hub', label: 'CMS Hub', kind: 'cms_hub' }, { id: 'external', label: 'Dashboard divisi', kind: 'external_dashboard', url: 'https://example.com' }];

export async function setup(page, { signedIn = true, permissions = admin, workspace = false, eventStatus = 'draft', formStatus = 'draft', oversight = false } = {}) {
  const state = { events: [{ ...event, status: eventStatus }], form: structuredClone({ ...form, status: formStatus }), calls: [], failEvents: false, failMe: false, failSave: false, expire: false };
  await page.addInitScript(({ signedIn }) => { if (signedIn) { sessionStorage.setItem('bph_cms_token', 'panel-session'); localStorage.setItem('bph_cms_workspace', 'panel-session'); } }, { signedIn });
  await page.route('**/api/v1/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/api/v1', ''); const method = req.method();
    state.calls.push({ path, method, body: req.postDataJSON() });
    const reply = (data, status = 200, message = 'OK') => route.fulfill({ status, json: { success: status < 400, data, message } });
    if (path === '/auth/panel-sign-in') return reply({ token: 'panel-session', user: { email: 'test@example.com' } });
    if (state.expire) return reply(null, 401, 'Sesi berakhir');
    if (path === '/me') return state.failMe ? reply(null, 503, 'Layanan belum tersedia') : reply({ can_access_oversight: oversight, user: { id: 'u-1', name: 'Nadia Putri', email: 'nadia@example.com' }, active_division_id: 'bph', memberships: [{ division: { id: 'bph', slug: 'bph', name: 'BPH' }, role: 'platform_admin', permissions }], workspace_options: workspace ? workspaces : [workspaces[0]] });
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

export async function visit(page, route) { await page.goto(`/#${route}`); await expect(page.locator('main')).toBeVisible(); }
export async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(await page.locator('main').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBeTruthy();
}
