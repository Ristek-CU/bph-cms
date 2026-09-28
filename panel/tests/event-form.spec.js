import { test, expect } from '@playwright/test';
import { hasSessionDraft, joinDT, newSession, translateErrors } from '../src/utils/event-form.js';

test('untouched session defaults are optional, deliberate edits require validation', () => {
  const session = newSession({ _date: '2026-10-10', _end: '08:00' });
  expect(hasSessionDraft(session)).toBe(false);
  expect(hasSessionDraft({ ...session, name: 'Pembukaan' })).toBe(true);
  expect(hasSessionDraft({ ...session, _start: '09:00' })).toBe(true);
  expect(hasSessionDraft({ ...session, _date: '2026-10-11' })).toBe(true);
  expect(hasSessionDraft({ ...session, description: 'Perlu proyektor' })).toBe(true);
});

test('late session defaults last one hour and the next session starts tomorrow', () => {
  const late = newSession({ _date: '2026-12-31', _end: '23:30' });
  expect(late._end).toBe('00:30');
  expect(joinDT(late._date, late._end, true)).toBe('2027-01-01T00:30');
  const next = newSession(late);
  expect(next._date).toBe('2027-01-01');
  expect(next._start).toBe('00:30');
  expect(next._end).toBe('01:30');
});

test('server session errors point to the displayed card after chronological submission', () => {
  const first = { _key: 'first' }, second = { _key: 'second' };
  const errors = translateErrors({ 'sessions.0.name': ['Too long'], 'sessions.1': ['Outside event'] }, [second, first], [first, second]);
  expect(errors['sessions.1.name']).toContain('Nama sesi');
  expect(errors['sessions.0']).toContain('di luar jam event');
});
