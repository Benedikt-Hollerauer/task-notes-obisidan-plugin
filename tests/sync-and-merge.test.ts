import { describe, it, expect } from 'vitest';
import { decideReconcile } from '../src/core/sync-decisions';
import { expectedEventBasename, parseEventBasename, filenameStartMinutes } from '../src/core/event-filename';
import { isBareDailyNote, buildBareDailyNote } from '../src/core/bare-note';
import { mergeTemplateIntoBareNote, interpolateTemplate } from '../src/core/template-merge';
import { overlapLayout } from '../src/core/overlap';
import { DEFAULT_SETTINGS } from '../src/settings/settings';

const SCHEDULED_FORMAT = 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}';

describe('event-filename', () => {
	it('computes the expected basename from daily date + line start', () => {
		const props = parseEventBasename('📅 By 2026-07-24 at 09.00h, prepare - 1 - deck');
		const expected = expectedEventBasename(props, '2026-08-10', 14 * 60, SCHEDULED_FORMAT);
		expect(expected).toBe('📅 By 2026-08-10 at 14.00h, prepare - 1 - deck');
	});
	it('reads the start minutes from a filename', () => {
		expect(filenameStartMinutes('📅 By 2026-07-24 at 09.30h, a - 1 - b')).toBe(570);
		expect(filenameStartMinutes('📅 By 2026-07-24, a - 1 - b')).toBeNull();
	});
});

describe('reconcile decisions (line wins)', () => {
	it('is a no-op fixpoint when filename already matches', () => {
		const decisions = decideReconcile(
			'2026-07-24',
			[{ lineNo: 6, startMinutes: 540, targetBasename: '📅 By 2026-07-24 at 09.00h, a - 1 - b' }],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(0);
	});
	it('renames when the line time differs (line wins)', () => {
		const decisions = decideReconcile(
			'2026-07-24',
			[{ lineNo: 6, startMinutes: 15 * 60, targetBasename: '📅 By 2026-07-24 at 09.00h, a - 1 - b' }],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toBe('📅 By 2026-07-24 at 15.00h, a - 1 - b');
	});
	it('renames when the daily date differs from the filename date', () => {
		const decisions = decideReconcile(
			'2026-08-01',
			[{ lineNo: 6, startMinutes: 9 * 60, targetBasename: '📅 By 2026-07-24 at 09.00h, a - 1 - b' }],
			SCHEDULED_FORMAT,
		);
		expect(decisions[0].toBasename).toBe('📅 By 2026-08-01 at 09.00h, a - 1 - b');
	});
	it('ignores non-scheduled or dangling links', () => {
		const decisions = decideReconcile(
			'2026-07-24',
			[
				{ lineNo: 1, startMinutes: 540, targetBasename: null },
				{ lineNo: 2, startMinutes: 540, targetBasename: '✅ Finish - 1 - report' },
			],
			SCHEDULED_FORMAT,
		);
		expect(decisions).toHaveLength(0);
	});
});

describe('bare note detection', () => {
	const heading = '## Day planner';
	it('recognises a plugin-built bare note', () => {
		const bare = buildBareDailyNote(heading, ['- [ ] 09:00 [[A]]', '- [ ] 11:00 [[B]]']);
		expect(isBareDailyNote(bare, heading)).toBe(true);
	});
	it('recognises a heading-only bare note', () => {
		expect(isBareDailyNote(buildBareDailyNote(heading), heading)).toBe(true);
	});
	it('rejects a templated note', () => {
		const templated = '# 2026-07-24\n\nSome prose\n\n## Day planner\n- [ ] 09:00 [[A]]\n';
		expect(isBareDailyNote(templated, heading)).toBe(false);
	});
	it('rejects an empty note', () => {
		expect(isBareDailyNote('', heading)).toBe(false);
		expect(isBareDailyNote('\n\n', heading)).toBe(false);
	});
});

describe('template merge', () => {
	const heading = '## Day planner';
	const preserved = [
		{ startMinutes: 9 * 60, lines: ['- [ ] 09:00 - 10:00 [[A]]'] },
		{ startMinutes: 11 * 60, lines: ['- [ ] 11:00 [[B]]'] },
	];

	it('interpolates date/time/title with formats', () => {
		const out = interpolateTemplate('# {{date:dddd}} — {{title}}', '2026-07-24', 'My Note');
		expect(out).toBe('# Friday — My Note');
	});
	it('inserts preserved lines under an existing heading in the template', () => {
		const template = '# {{date}}\n\n## Day planner\n\n## Notes\n';
		const merged = mergeTemplateIntoBareNote({ templateRaw: template, heading, preservedBlocks: preserved, date: '2026-07-24', title: 'x' }).text;
		expect(merged).toContain('## Day planner');
		expect(merged).toContain('- [ ] 09:00 - 10:00 [[A]]');
		expect(merged).toContain('- [ ] 11:00 [[B]]');
		// Preserved lines land before the Notes heading.
		expect(merged.indexOf('[[A]]')).toBeLessThan(merged.indexOf('## Notes'));
	});
	it('appends heading + lines when the template has neither a heading nor a time', () => {
		const template = '# {{date}}\n\nJust prose.\n';
		const untimed = [{ startMinutes: null, lines: ['- [ ] Water the plants'] }];
		const merged = mergeTemplateIntoBareNote({ templateRaw: template, heading, preservedBlocks: untimed, date: '2026-07-24', title: 'x' }).text;
		expect(merged).toContain('Just prose.');
		expect(merged.trimEnd().endsWith('- [ ] Water the plants')).toBe(true);
		expect(merged).toContain(heading);
	});
	it('does not duplicate a line already present', () => {
		const template = '## Day planner\n- [ ] 09:00 - 10:00 [[A]]\n';
		const merged = mergeTemplateIntoBareNote({ templateRaw: template, heading, preservedBlocks: preserved, date: '2026-07-24', title: 'x' }).text;
		const count = merged.split('[[A]]').length - 1;
		expect(count).toBe(1);
	});
});

describe('overlap layout', () => {
	it('places non-overlapping blocks full width', () => {
		const { placement: map } = overlapLayout([
			{ id: 'a', start: 540, end: 600 },
			{ id: 'b', start: 660, end: 720 },
		]);
		expect(map.get('a')!.width).toBe(1);
		expect(map.get('b')!.width).toBe(1);
	});
	it('splits two overlapping blocks into two columns', () => {
		const { placement: map } = overlapLayout([
			{ id: 'a', start: 540, end: 660 },
			{ id: 'b', start: 600, end: 720 },
		]);
		expect(map.get('a')!.columns).toBe(2);
		expect(map.get('a')!.left).toBe(0);
		expect(map.get('b')!.left).toBe(0.5);
	});
	it('reuses a freed column after a gap', () => {
		const { placement: map } = overlapLayout([
			{ id: 'a', start: 540, end: 600 },
			{ id: 'b', start: 550, end: 700 },
			{ id: 'c', start: 610, end: 660 },
		]);
		// a and c don't overlap → same column; both share the cluster with b (2 cols).
		expect(map.get('a')!.column).toBe(0);
		expect(map.get('c')!.column).toBe(0);
		expect(map.get('b')!.column).toBe(1);
	});
});

describe('an all-day note dragged to a time gains `at HH.MMh`', () => {
	// Reported as "when an all-day event gets dragged to a specific time it should
	// add the start time to the `at` in the note". The whole chain is here: the
	// planner line gains a time, and reconcile turns that into the filename.
	const FMT = DEFAULT_SETTINGS.scheduledTaskFormat;
	const ALL_DAY = '📅 By 2026-08-12, practisee - 0sd - of multitasking';

	it('THE ASK: an untimed 📅 note gains the time it was dropped at', () => {
		const decisions = decideReconcile(
			'2026-08-12',
			[{ lineNo: 3, startMinutes: 540, targetBasename: ALL_DAY }],
			FMT,
		);
		expect(decisions).toHaveLength(1);
		expect(decisions[0].toBasename).toBe(
			'📅 By 2026-08-12 at 09.00h, practisee - 0sd - of multitasking',
		);
	});

	it('…and moving it to another day carries the new date AND the time', () => {
		const decisions = decideReconcile(
			'2026-08-14',
			[{ lineNo: 3, startMinutes: 615, targetBasename: ALL_DAY }],
			FMT,
		);
		expect(decisions[0].toBasename).toBe(
			'📅 By 2026-08-14 at 10.15h, practisee - 0sd - of multitasking',
		);
	});

	it('WHY IT CAN LOOK BROKEN: a note several days link is left alone', () => {
		// A note that lives in the daily TEMPLATE is linked from every day, so no
		// one filename satisfies them all and reconcile withholds the rename. The
		// line still gets its time — which is why this reads as "the time did not
		// reach the name". The engine now says so out loud; this pins the decision.
		const decisions = decideReconcile(
			'2026-08-12',
			[{ lineNo: 3, startMinutes: 540, targetBasename: ALL_DAY, duplicate: true }],
			FMT,
		);
		expect(decisions).toEqual([]);
	});
});
