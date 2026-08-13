import { describe, it, expect } from 'vitest';
import { parsePlannerLine, serializePlannerLine } from '../src/core/planner-line';
import { insertBlockResult, getPlannerSection, scanDayLines } from '../src/core/planner-section';
import { interpolateTemplate } from '../src/core/template-merge';
import { migrateSettings, DEFAULT_SETTINGS } from '../src/settings/settings';

function roundTrip(raw: string): string {
	const parsed = parsePlannerLine(raw, 0);
	if (!parsed) return raw;
	return serializePlannerLine(parsed);
}

describe('planner-line edge cases', () => {
	it('keeps the times of a line that has no text', () => {
		const parsed = parsePlannerLine('- [ ] 14:00 - 15:00', 0);
		expect(parsed?.startMinutes).toBe(840);
		expect(parsed?.endMinutes).toBe(900);
		expect(parsed?.text).toBe('');
		expect(roundTrip('- [ ] 14:00 - 15:00')).toBe('- [ ] 14:00 - 15:00');
	});

	it('does not delete an invalid time token on reserialize', () => {
		const parsed = parsePlannerLine('- [ ] 99:99 Lunch', 0);
		expect(parsed?.startMinutes).toBeNull();
		expect(parsed?.text).toContain('99:99');
		expect(roundTrip('- [ ] 99:99 Lunch')).toContain('99:99');
	});

	it('round-trips ordinary timed and untimed lines', () => {
		expect(roundTrip('- [ ] 09:00 - 10:30 [[📅 By 2026-07-24 at 09.00h, a - 1 - b]]')).toBe(
			'- [ ] 09:00 - 10:30 [[📅 By 2026-07-24 at 09.00h, a - 1 - b]]',
		);
		expect(roundTrip('- [x] 13:00 Lunch')).toBe('- [x] 13:00 Lunch');
		expect(roundTrip('- [ ] Side task')).toBe('- [ ] Side task');
	});

});

describe('planner-section', () => {
	it('terminates a headingless planner section at the next heading of any level', () => {
		const text = ['Day planner', '- [ ] 09:00 A', '## Other', '- [ ] 10:00 B'].join('\n');
		const section = getPlannerSection(text, 'Day planner');
		expect(section.found).toBe(true);
		expect(section.end).toBe(2); // the `## Other` heading closes it
		expect(scanDayLines(text, 'Day planner').plannerLines).toHaveLength(1);
	});

	it('inserts sorted lines before trailing blank lines', () => {
		const text = ['## Day planner', '- [ ] 09:00 A', '', ''].join('\n');
		const out = insertBlockResult(text, '## Day planner', ['- [ ] 08:00 Early'], {
			sorted: true,
			startMinutes: 480,
		});
		const lines = out.text.split('\n');
		expect(lines[1]).toBe('- [ ] 08:00 Early');
		expect(lines[2]).toBe('- [ ] 09:00 A');
	});

	it('places a later line after existing earlier ones, still before the blanks', () => {
		const text = ['## Day planner', '- [ ] 09:00 A', '', ''].join('\n');
		const out = insertBlockResult(text, '## Day planner', ['- [ ] 11:00 Later'], {
			sorted: true,
			startMinutes: 660,
		});
		const lines = out.text.split('\n');
		expect(lines[1]).toBe('- [ ] 09:00 A');
		expect(lines[2]).toBe('- [ ] 11:00 Later');
	});
});

describe('template interpolation', () => {
	it('supports the full variable set', () => {
		const out = interpolateTemplate(
			'# {{title}}\n{{date}} / {{date:YYYY}} / {{time:HH}}',
			'2026-07-27',
			'My note',
		);
		expect(out).toContain('# My note');
		expect(out).toContain('2026-07-27');
		expect(out).toContain('2026');
		expect(out).toMatch(/\d{2}$/);
	});

	it('treats $-sequences in user text literally', () => {
		// `$&` would duplicate the match if a raw string replacement were used.
		const out = interpolateTemplate('{{title}}', '2026-07-27', 'Pay $& $$500');
		expect(out).toBe('Pay $& $$500');
	});

	it('falls back to today when no date is given', () => {
		const out = interpolateTemplate('{{date}}', null, 't');
		expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe('settings migration', () => {
	it('fills defaults and keeps stored values', () => {
		const merged = migrateSettings({ plannerHeading: '# Plan' }, false);
		expect(merged.plannerHeading).toBe('# Plan');
		expect(merged.defaultEventDurationMinutes).toBe(60);
		expect(merged.dayStartHour).toBe(8);
	});

	it('deep-copies icsCalendars so the defaults are never mutated', () => {
		const merged = migrateSettings({}, false);
		merged.icsCalendars.push({ id: 'x', name: 'n', url: 'u', color: '', enabled: true });
		expect(DEFAULT_SETTINGS.icsCalendars).toHaveLength(0);

		const stored = [{ id: 'a', name: 'A', url: 'u', color: '', enabled: true }];
		const merged2 = migrateSettings({ icsCalendars: stored }, false);
		merged2.icsCalendars[0].name = 'changed';
		expect(stored[0].name).toBe('A');
	});
});
