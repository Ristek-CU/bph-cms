export const periodPath = '/admin/qpr/periods/period-admin';
export const workspace = '/qpr/periods/period-admin';
export const snapshot = {
  version: 3,
  sections: [{ id: 'ketum', targetId: 'ketum', targetLabel: 'Ketua Contoh', title: 'Ketua Umum', questions: [
    { id: 'ketum-s01', label: 'Arahan Ketua jelas?', type: 'scale', required: true },
    { id: 'ketum-t01', label: 'Saran untuk Ketua', type: 'text', required: true },
  ] }],
  target_config: { targets: [{ id: 'ketum', label: 'Ketua Contoh', template: 'ketum' }], controller_by_division: {} },
  routing: Object.fromEntries(['anggota', 'controller', 'sekum', 'bendum', 'kadiv', 'wakadiv', 'bendiv', 'sekdiv'].map(role => [role, ['ketum']])),
};

export async function setup(page, { slug = 'bph', permission = true, frozen = false, path = '/qpr', blockers = [] } = {}) {
  const calls = [];
  const period = {
    id: 'period-admin', title: 'Periode Contoh', description: 'Evaluasi Oktober', status: frozen ? 'closed' : 'draft',
    total_entries: 2, done_entries: frozen ? 1 : 0, pending_entries: frozen ? 1 : 2,
    firstOpenedAt: frozen ? '2026-10-01T00:00:00Z' : null, updatedAt: '2026-10-01T00:00:00Z',
    opensAt: '2026-10-01T08:00:00Z', closesAt: '2026-10-31T08:00:00Z', questions: structuredClone(snapshot),
    entries: [
      { id: 'e1', name: 'Anggota Contoh', divisionSlug: 'ristek', memberRole: 'anggota', memberKey: 'member-1', done: false },
      { id: 'e2', name: 'Pengisi Kedua', divisionSlug: 'media', memberRole: 'anggota', memberKey: 'member-2', done: frozen },
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
    const body = request.postData() ? request.postDataJSON() : null;
    calls.push({ path, method, body });
    const reply = data => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
    if (path === '/me') return reply({ user: { id: 'u1', name: 'Admin Contoh' }, active_division_id: slug,
      memberships: [{ division: { id: slug, slug, name: slug }, role: 'platform_admin', permissions: permission ? ['qpr.manage'] : [] }],
      workspace_options: [{ id: 'hub', kind: 'cms_hub', label: 'CMS Hub' }] });
    if (path === '/admin/events') return reply([]);
    if (path === '/qpr-participation') return reply([{ id: period.id, title: period.title, status: 'open' }]);
    if (path === '/qpr-participation/period-admin') return reply({
      period: { id: period.id, title: period.title, status: 'open' }, total_entries: 2, done_entries: 1, pending_entries: 1,
      entries: [{ name: 'Selesai Ristek', role: 'anggota', done: true }, { name: 'Draft Ristek', role: 'anggota', done: false }],
    });
    if (path === '/admin/qpr/periods' && method === 'GET') return reply([period]);
    if (path === periodPath && method === 'PUT') {
      if (body.sections && JSON.stringify(body.expected_snapshot) !== JSON.stringify(period.questions)) {
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Snapshot changed; reload before saving' } }) });
      }
      Object.assign(period, { title: body.title, description: body.description, opensAt: body.opens_at, closesAt: body.closes_at, updatedAt: `2026-10-07T01:00:0${calls.filter(c => c.method === 'PUT').length}Z` });
      if (body.sections) period.questions = { ...period.questions, sections: body.sections, target_config: body.target_config };
      return reply(period);
    }
    if (path === periodPath && method === 'GET') return reply(period);
    if (path === `${periodPath}/preview` && method === 'GET') return reply({ blockers,
      scale_legend: { 1: 'Sangat Kurang', 2: 'Kurang', 3: 'Cukup', 4: 'Baik', 5: 'Sangat Baik' },
      entries: period.entries.map(e => ({ id: e.id, name: e.name, role: e.memberRole, required: 2, targets: ['ketum'], sections: period.questions.sections })),
    });
    if (path === `${periodPath}/recap-v2` && method === 'GET') return reply({ total_entries: 2, done_entries: 0, pending: period.entries,
      sections: [{ id: 'ketum', target_label: 'Ketua Contoh', questions: [{ id: 'ketum-s01', label: 'Arahan Ketua jelas?', type: 'scale', responses: 0, mean: null, distribution: [] }] }],
    });
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: `Unexpected ${method} ${path}` } }) });
  });
  await page.goto(`${process.env.QPR_TEST_BASE_URL || ''}/#${path}`, { waitUntil: 'domcontentloaded' });
  return calls;
}
