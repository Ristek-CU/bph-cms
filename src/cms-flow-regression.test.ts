// @ts-nocheck -- integration runner uses Node + Miniflare bindings.
import assert from 'node:assert/strict';
import { startHarness, DIVISIONS } from './test/harness';
import { getDb } from './db/connection';
import { formService } from './modules/forms/form.service';

const h = await startHarness();
let failures = 0;
const check = async (name, run) => {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
};
const create = async (title, token = 'tok-a-admin') => {
  const r = await h.req('/api/v1/admin/forms', { token, method: 'POST', json: {
    title, fields: [{ label: 'Pendapat', type: 'short_text' }, { label: 'Lampiran', type: 'file' }],
  } });
  assert.equal(r.status, 201);
  return r.body.data;
};
try {
  await check('mixed existing and new questions retain input order without explicit positions', async () => {
    const db = getDb(h.d1);
    const field = { label: 'First', type: 'short_text', required: false, active: true };
    const draft = await formService.create(db, { title: 'Direct service ordering', fields: [field] }, { divisionId: DIVISIONS.a.id });
    const saved = await formService.update(db, draft.id, { fields: [{ ...field, id: draft.fields[0].id }, { ...field, label: 'Second' }] });
    assert.deepEqual(saved.fields.map(f => f.sort_order), [0, 1]);
  });
  const form = await create('Form regression');
  await h.req(`/api/v1/admin/forms/${form.id}/publish`, { token: 'tok-a-admin', method: 'POST' });
  const body = new FormData();
  body.set(`field_${form.fields[0].id}`, 'Jawaban historis');
  body.set(`field_${form.fields[1].id}`, new Blob(['%PDF-1.4 fixture'], { type: 'application/pdf' }), 'bukti.pdf');
  const multipart = new Request('http://localhost', { method: 'POST', body });
  const submitted = await h.req(`/api/v1/forms/${form.slug}`, { method: 'POST',
    body: await multipart.arrayBuffer(), headers: { 'Content-Type': multipart.headers.get('Content-Type') },
  });
  assert.equal(submitted.status, 201);
  const submissionId = submitted.body.data.submission_id;
  await check('saving and reordering questions preserves historical analytics', async () => {
    const saved = await h.req(`/api/v1/admin/forms/${form.id}`, { token: 'tok-a-admin', method: 'PUT', json: {
      title: 'Judul diperbarui', fields: [...form.fields].reverse().map((f, i) => ({ ...f, sort_order: i })),
    } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.data.fields.map(f => f.id), [...form.fields].reverse().map(f => f.id));
    const analytics = await h.req(`/api/v1/admin/forms/${form.id}/analytics`, { token: 'tok-a-admin' });
    const text = analytics.body.data.fields.find(f => f.id === form.fields[0].id);
    assert.equal(text.response_rate, 100);
    assert.deepEqual(text.recent, ['Jawaban historis']);
  });
  await check('foreign question IDs reject the whole save without changing title', async () => {
    const other = await create('Other division', 'tok-b-admin');
    const res = await h.req(`/api/v1/admin/forms/${form.id}`, { token: 'tok-a-admin', method: 'PUT', json: {
      title: 'Must not persist', fields: other.fields,
    } });
    assert.equal(res.status, 422);
    const current = await h.req(`/api/v1/admin/forms/${form.id}`, { token: 'tok-a-admin' });
    assert.equal(current.body.data.title, 'Judul diperbarui');
  });
  await check('question insert failure rolls back form metadata', async () => {
    await h.sql("CREATE TRIGGER fail_flow_field BEFORE INSERT ON form_fields WHEN NEW.label='FAIL_FLOW' BEGIN SELECT RAISE(ABORT,'fixture'); END");
    const res = await h.req(`/api/v1/admin/forms/${form.id}`, { token: 'tok-a-admin', method: 'PUT', json: {
      title: 'Must roll back', fields: [{ label: 'FAIL_FLOW', type: 'short_text' }],
    } });
    assert.equal(res.status, 500);
    const current = await h.req(`/api/v1/admin/forms/${form.id}`, { token: 'tok-a-admin' });
    assert.equal(current.body.data.title, 'Judul diperbarui');
  });
  await check('attachments have private metadata and permission-checked downloads', async () => {
    const list = await h.req(`/api/v1/admin/forms/${form.id}/submissions`, { token: 'tok-a-admin' });
    const file = list.body.data.items[0].files?.[0];
    assert.equal(file?.original_filename, 'bukti.pdf');
    assert.equal(file.storage_path, undefined);
    const path = `/api/v1/admin/forms/submissions/${submissionId}/files/${file.id}`;
    for (const token of [undefined, 'tok-b-admin', 'tok-a-contrib', 'tok-a-viewer']) {
      assert.equal((await h.req(path, { token })).status, token ? 403 : 401);
    }
    const downloaded = await h.req(path, { token: 'tok-a-admin' });
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.body, '%PDF-1.4 fixture');
    assert.match(downloaded.headers.get('content-disposition'), /^attachment;/);
    assert.match(downloaded.headers.get('cache-control'), /no-store/);
    assert.equal((await h.req(path.replace(file.id, 'missing'), { token: 'tok-a-admin' })).status, 404);
  });
  await check('suspension cannot reactivate bootstrap admin permissions', async () => {
    const now = new Date().toISOString();
    await h.sql("INSERT INTO cms_memberships (id,user_id,user_email,division_id,role,status,created_at,updated_at) VALUES (?,?,?,?,?,'suspended',?,?)",
      'm-suspended-bph', 'u-bph', 'bph@cakrawala.com', DIVISIONS.bph.id, 'platform_admin', now, now);
    assert.equal((await h.req('/api/v1/admin/accounts', { token: 'tok-bph' })).status, 403);
  });
} finally { await h.dispose(); }
assert.equal(failures, 0, `${failures} flow regressions`);
