import { describe, it, expect } from 'vitest';
import { describeFetchFailure, normalizeIcsCache, stripBom } from '../src/core/ics-diagnosis';

const GOOGLE_PUBLIC =
	'https://calendar.google.com/calendar/ical/someone%40example.com/public/basic.ics';
const GOOGLE_SECRET =
	'https://calendar.google.com/calendar/ical/someone%40example.com/private-abc123/basic.ics';

describe('describeFetchFailure — the message has to be actionable', () => {
	it('THE CASE THAT PROMPTED THIS: a 404 on a Google /public/ feed names the fix', () => {
		// A Workspace calendar cannot be shared publicly, so /public/basic.ics 404s
		// even though the URL looks perfectly correct. The old message was Obsidian's
		// own "Request failed, status 404" — true, and no help whatsoever.
		const msg = describeFetchFailure(GOOGLE_PUBLIC, 404);
		expect(msg).toContain('404');
		expect(msg).toContain('not shared publicly');
		expect(msg).toContain('Secret address in iCal format');
	});

	it('does not give Google-specific advice for a 404 that is not that case', () => {
		for (const url of [GOOGLE_SECRET, 'https://example.com/feed.ics']) {
			const msg = describeFetchFailure(url, 404);
			expect(msg).toContain('404');
			expect(msg).not.toContain('Secret address');
		}
	});

	it('recognises a public feed regardless of case and of the calendar id', () => {
		expect(describeFetchFailure(GOOGLE_PUBLIC.toUpperCase(), 404)).toContain('Secret address');
		expect(
			describeFetchFailure(
				'https://calendar.google.com/calendar/ical/de.german%23holiday%40group.v.calendar.google.com/public/basic.ics',
				404,
			),
		).toContain('Secret address');
	});

	it('tells an auth failure apart from a missing feed', () => {
		for (const status of [401, 403]) {
			const msg = describeFetchFailure('https://example.com/feed.ics', status);
			expect(msg).toContain(String(status));
			expect(msg).toMatch(/authentication/i);
		}
	});

	it('says a server error is probably temporary, and rate-limiting is our fault', () => {
		expect(describeFetchFailure('https://example.com/f.ics', 503)).toMatch(/temporary/i);
		expect(describeFetchFailure('https://example.com/f.ics', 429)).toMatch(/refresh interval/i);
	});

	it('handles no status at all — offline, DNS, or our own timeout', () => {
		const msg = describeFetchFailure('https://example.com/f.ics', null);
		expect(msg).toMatch(/could not reach/i);
		// No invented status code in the text.
		expect(msg).not.toMatch(/\d{3}/);
	});

	it('always returns a non-empty sentence, whatever the status', () => {
		for (const status of [400, 402, 418, 451, 500, 502, null]) {
			expect(describeFetchFailure('https://example.com/f.ics', status).length).toBeGreaterThan(10);
		}
	});
});

describe('stripBom', () => {
	it('removes a leading UTF-8 BOM', () => {
		// ICAL.parse throws "Cannot read properties of undefined" on a BOM'd body, and
		// icsBodyProblem's unanchored BEGIN:VCALENDAR test lets it through — so the
		// failure surfaced as an unactionable parser error instead of being handled.
		expect(stripBom('﻿BEGIN:VCALENDAR')).toBe('BEGIN:VCALENDAR');
	});

	it('leaves a body without one exactly as it was', () => {
		const body = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
		expect(stripBom(body)).toBe(body);
		expect(stripBom('')).toBe('');
	});

	it('removes only ONE, and only at the start', () => {
		// A BOM in the middle is real content (however odd) and not ours to delete.
		expect(stripBom('﻿﻿X')).toBe('﻿X');
		expect(stripBom('X﻿')).toBe('X﻿');
	});
});

describe('normalizeIcsCache', () => {
	it('keeps string bodies and discards corrupt entries independently', () => {
		expect(normalizeIcsCache({ work: 'BEGIN:VCALENDAR', bad: 42, nested: {} })).toEqual({
			work: 'BEGIN:VCALENDAR',
		});
	});

	it('rejects arrays, primitives, null and empty cache keys', () => {
		for (const raw of [null, 'body', 7, ['BEGIN:VCALENDAR']]) {
			expect(normalizeIcsCache(raw)).toEqual({});
		}
		expect(normalizeIcsCache({ '': 'body', okay: '' })).toEqual({ okay: '' });
	});
});
