import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hotelCalendarDay } from '../src/app/stay-date.ts';

test('today follows the property calendar across and on both sides of midnight UTC', () => {
  assert.equal(hotelCalendarDay(new Date('2026-11-17T01:00:00Z'), 'America/Monterrey'), '2026-11-16');
  assert.equal(hotelCalendarDay(new Date('2026-11-16T23:00:00Z'), 'Asia/Tokyo'), '2026-11-17');
});
