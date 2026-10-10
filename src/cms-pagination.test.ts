// @ts-nocheck -- Node integration runner.
import assert from 'node:assert/strict';
import { drizzle } from 'drizzle-orm/d1';
import { startHarness, seedEvent, seedInternalEvent, DIVISIONS } from './test/harness';
import { eventService } from './modules/events/event.service';
import { internalEventService } from './modules/internal-events/internal-event.service';
import { formService } from './modules/forms/form.service';

const h = await startHarness();
// workerd's SQLite permits more bindings than deployed D1. Enforce its 100-bound-value contract.
const guarded = { prepare(query) {
  const statement = h.d1.prepare(query);
  return new Proxy(statement, { get(target, key) {
    if (key === 'bind') return (...values) => {
      assert.ok(values.length <= 100, `D1 limit exceeded: ${values.length} bindings`);
      return target.bind(...values);
    };
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
} };
const db = drizzle(guarded);
let failures = 0;
try {
  for (let i = 0; i < 105; i++) {
    const fixture = { id: `page-${i}`, slug: `page-${i}`, title: `Page ${i}`, divisionId: DIVISIONS.a.id };
    await seedEvent(h, fixture); await seedInternalEvent(h, fixture);
    await h.sql("INSERT INTO forms (id,division_id,slug,title,status,created_at,updated_at) VALUES (?,?,?,?,'draft',?,?)",
      fixture.id, fixture.divisionId, fixture.slug, fixture.title, '2026-10-09T00:00:00Z', '2026-10-09T00:00:00Z');
  }
  for (const [name, list] of [
    ['events', () => eventService.listAdmin(db, { divisionId: DIVISIONS.a.id })],
    ['internal events', () => internalEventService.listAdmin(db, { isAll: true })],
    ['forms', () => formService.listAdmin(db, { divisionId: DIVISIONS.a.id })],
  ]) {
    try { const result = await list(); assert.equal(result.items.length, 105); console.log(`PASS ${name}: 105 records within D1 binding limit`); }
    catch (error) { failures++; console.error(`FAIL ${name}: ${error.cause?.message || error.message}`); }
  }
} finally { await h.dispose(); }
assert.equal(failures, 0);
