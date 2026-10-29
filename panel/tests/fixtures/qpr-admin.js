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

// Rubrik 360° (v4): kategori pertanyaan + routing dihitung server dari roster.
export const snapshotV4 = {
  version: 4,
  categories: [
    { id: 'cat-1', title: 'Kepemimpinan', scope: 'all', questions: [
      { id: 'cat-1-q1', label: 'Memberi arahan jelas?', type: 'scale', required: true },
    ] },
    { id: 'cat-2', title: 'Komunikasi', scope: 'all', questions: [
      { id: 'cat-2-q1', label: 'Mudah diajak diskusi?', type: 'scale', required: true },
    ] },
    { id: 'cat-3', title: 'Kedisiplinan', scope: 'positions', questions: [
      { id: 'cat-3-q1', label: 'Satu hal yang perlu diperbaiki', type: 'text', required: true },
    ] },
  ],
};

// Rubrik 360° (v5): matriks penilai → target. Satu pasangan boleh memakai
// beberapa instrumen; pertanyaan digabung saat preview/rekap.
export const snapshotV5 = {
  version: 5,
  instruments: [
    { id: 'inst-1', title: 'Penilaian umum', applies: [
      { assessor: 'anggota', target: 'kadiv' },
      { assessor: 'kadiv', target: 'anggota' },
    ], questions: [
      { id: 'inst-1-q1', label: 'Menjalankan peran dengan baik?', type: 'scale', required: true },
    ] },
    { id: 'inst-2', title: 'Umpan balik anggota', applies: [
      { assessor: 'anggota', target: 'kadiv' },
    ], questions: [
      { id: 'inst-2-q1', label: 'Saran untuk kepala divisi', type: 'text', required: true },
    ] },
  ],
};

/** Satu orang yang dinilai beserta pertanyaan kategorinya (dipakai preview/rekap v4). */
function targetSection(target, { includePositions = true } = {}) {
  return {
    id: target.id, title: target.sectionTitle, targetId: target.id, targetLabel: target.name,
    questions: snapshotV4.categories.filter(c => includePositions || c.scope === 'all').flatMap(category =>
      category.questions.map(q => ({
        ...q, id: `${target.id}~${q.id}`, category: category.title, category_id: category.id,
        ...(q.type === 'scale' ? { responses: 0, mean: null, distribution: [] } : { responses: 0, texts: [] }),
      }))),
  };
}

const instrumentsNow = (period) => period.questions?.instruments ?? [];

/** Instrumen yang berlaku untuk pasangan penilai → target tertentu. */
const instrumentsFor = (period, assessorRole, targetRole) => instrumentsNow(period)
  .filter(instrument => instrument.applies.some(pair => pair.assessor === assessorRole && pair.target === targetRole));

/** Target yang muncul untuk seorang penilai: pasangan yang punya instrumen. */
const v5Targets = (period, entry, roster) => roster
  .filter(target => target.id !== entry.id && instrumentsFor(period, entry.memberRole, target.memberRole).length > 0);

function v5Section(period, entry, target) {
  return {
    id: target.id, title: target.sectionTitle, targetId: target.id, targetLabel: target.name,
    questions: instrumentsFor(period, entry.memberRole, target.memberRole).flatMap(instrument =>
      instrument.questions.map(question => ({
        ...question, id: `${target.id}~${question.id}`, category: instrument.title, category_id: instrument.id,
        ...(question.type === 'scale' ? { responses: 0, mean: null, distribution: [] } : { responses: 0, texts: [] }),
      }))),
  };
}

function v5RecapSection(period, target) {
  return {
    id: target.id, title: target.sectionTitle, target_label: target.name,
    questions: instrumentsNow(period)
      .filter(instrument => instrument.applies.some(pair => pair.target === target.memberRole))
      .flatMap(instrument => instrument.questions.map(question => ({
        ...question, id: `${target.id}~${question.id}`, category: instrument.title, category_id: instrument.id,
        ...(question.type === 'scale' ? { responses: 0, mean: null, distribution: [] } : { responses: 0, texts: [] }),
      }))),
  };
}

export async function setup(page, {
  slug = 'bph', permission = true, frozen = false, path = '/qpr', blockers = [], version = 3,
} = {}) {
  const calls = [];
  const rubric = version === 4 || version === 5;
  const v4Roster = [
    { id: 'e1', name: 'Anggota Contoh', divisionSlug: 'ristek', division: 'Ristek', memberRole: 'anggota', memberKey: 'member-1', managedDivisions: [], done: false, sectionTitle: 'Anggota — Ristek' },
    { id: 'e2', name: 'Pengisi Kedua', divisionSlug: 'media', division: 'Media', memberRole: 'kadiv', memberKey: 'member-2', managedDivisions: [], done: frozen, sectionTitle: 'Kepala Divisi — Media' },
  ];
  const v5Roster = [
    { id: 'e1', name: 'Anggota Contoh', divisionSlug: 'ristek', division: 'Ristek', memberRole: 'anggota', memberKey: 'member-1', managedDivisions: [], done: false, sectionTitle: 'Anggota — Ristek' },
    { id: 'e2', name: 'Kepala Contoh', divisionSlug: 'ristek', division: 'Ristek', memberRole: 'kadiv', memberKey: 'member-2', managedDivisions: [], done: frozen, sectionTitle: 'Kepala Divisi — Ristek' },
  ];
  const roster = version === 5 ? v5Roster : rubric ? v4Roster : [
    { id: 'e1', name: 'Anggota Contoh', divisionSlug: 'ristek', memberRole: 'anggota', memberKey: 'member-1', done: false },
    { id: 'e2', name: 'Pengisi Kedua', divisionSlug: 'media', memberRole: 'anggota', memberKey: 'member-2', done: frozen },
  ];
  const period = {
    id: 'period-admin', title: 'Periode Contoh', description: 'Evaluasi Oktober', status: frozen ? 'closed' : 'draft',
    total_entries: 2, done_entries: frozen ? 1 : 0, pending_entries: frozen ? 1 : 2,
    firstOpenedAt: frozen ? '2026-10-01T00:00:00Z' : null, updatedAt: '2026-10-01T00:00:00Z',
    opensAt: '2026-10-01T08:00:00Z', closesAt: '2026-10-31T08:00:00Z',
    questions: structuredClone(version === 5 ? snapshotV5 : rubric ? snapshotV4 : snapshot),
    entries: roster,
  };
  const sectionsFor = (entry) => {
    if (version === 5) return v5Targets(period, entry, roster).map(target => v5Section(period, entry, target));
    if (rubric) return [targetSection({ id: 'e2', name: 'Pengisi Kedua', sectionTitle: 'Kepala Divisi — Media' }, { includePositions: entry.memberRole !== 'anggota' })];
    return period.questions.sections;
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
      entries: [{ name: 'Draft Ristek', role: 'anggota' }],
    });
    if (path === '/admin/qpr/periods' && method === 'GET') return reply([period]);
    if (path === '/admin/qpr/periods' && method === 'POST') {
      // 360° boleh dibuat kosong lewat `instruments: []`; jalur lama tetap
      // memakai `categories`, dan form sederhana tidak mengirim keduanya.
      if (body.form_kind === 'division' && !body.categories?.length && !Array.isArray(body.instruments)) {
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Instrumen penilaian wajib diisi minimal satu' } }) });
      }
      if (body.categories) period.questions = { version: 4, categories: body.categories.map((c, i) => ({ id: `cat-${i + 1}`, ...c })) };
      if (Array.isArray(body.instruments)) period.questions = { version: 5, instruments: body.instruments.map((instrument, i) => ({
        id: instrument.id ?? `inst-${i + 1}`, title: instrument.title, applies: instrument.applies ?? [],
        questions: (instrument.questions ?? []).map((question, j) => ({ ...question, id: question.id ?? `inst-${i + 1}-q${j + 1}` })),
      })) };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...period, id: period.id, title: body.title, divisionSlug: body.division_slug ?? null } }) });
    }
    if (path === periodPath && method === 'PUT') {
      for (const key of ['sections', 'categories', 'instruments']) {
        if (body[key] && JSON.stringify(body.expected_snapshot) !== JSON.stringify(period.questions)) {
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: 'Snapshot changed; reload before saving' } }) });
        }
      }
      Object.assign(period, { title: body.title, description: body.description, opensAt: body.opens_at, closesAt: body.closes_at, updatedAt: `2026-10-07T01:00:0${calls.filter(c => c.method === 'PUT').length}Z` });
      if (body.sections) period.questions = { ...period.questions, sections: body.sections, target_config: body.target_config };
      if (body.categories) period.questions = { ...period.questions, categories: body.categories };
      if (body.instruments) period.questions = { ...period.questions, instruments: body.instruments };
      return reply(period);
    }
    if (path === periodPath && method === 'GET') return reply(period);
    if (path === `${periodPath}/preview` && method === 'GET') return reply({ blockers,
      scale_legend: { 1: 'Sangat Kurang', 2: 'Kurang', 3: 'Cukup', 4: 'Baik', 5: 'Sangat Baik' },
      entries: roster.map(e => ({
        id: e.id, name: e.name, display_name: e.name, role: e.memberRole, division_slug: e.divisionSlug,
        required: sectionsFor(e).reduce((n, s) => n + s.questions.filter(q => q.required).length, 0),
        targets: version === 5 ? v5Targets(period, e, roster).map(target => target.id) : rubric ? ['e2'] : ['ketum'],
        sections: sectionsFor(e),
      })),
    });
    if (path === `${periodPath}/recap-v2` && method === 'GET') {
      if (version === 5) return reply({ total_entries: 2, done_entries: 0, pending: period.entries,
        score_total: { responses: 0, mean: null, max: null, min: null },
        sections: roster.map(target => v5RecapSection(period, target)) });
      if (!rubric) return reply({ total_entries: 2, done_entries: 0, pending: period.entries,
        sections: [{ id: 'ketum', target_label: 'Ketua Contoh', questions: [{ id: 'ketum-s01', label: 'Arahan Ketua jelas?', type: 'scale', responses: 0, mean: null, distribution: [] }] }],
      });
      return reply({ total_entries: 2, done_entries: 0, pending: period.entries,
        score_total: { responses: 0, mean: null, max: null, min: null },
        sections: [
          targetSection({ id: 'e1', name: 'Anggota Contoh', sectionTitle: 'Anggota — Ristek' }, { includePositions: false }),
          targetSection({ id: 'e2', name: 'Pengisi Kedua', sectionTitle: 'Kepala Divisi — Media' }),
        ] });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: { message: `Unexpected ${method} ${path}` } }) });
  });
  await page.goto(`${process.env.QPR_TEST_BASE_URL || ''}/#${path}`, { waitUntil: 'domcontentloaded' });
  return calls;
}
