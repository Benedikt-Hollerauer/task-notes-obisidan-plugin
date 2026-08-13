import { describe, it, expect } from 'vitest';
import { eventTitle } from '../src/core/event-title';
import type { LocalEvent, RemoteEvent } from '../src/types';

const NONE: ReadonlySet<string> = new Set();

const local: LocalEvent = {
	kind: 'local',
	id: 'deck',
	title: 'Prepare the deck',
	date: '2026-08-11',
	startMinutes: 600,
	endMinutes: 660,
	checked: false,
	linked: true,
};

const remote: RemoteEvent = {
	kind: 'remote',
	id: 'r1',
	calendarId: 'c1',
	calendarName: 'Work',
	title: 'Design review',
	startTs: 0,
	endTs: 1,
	allDay: false,
	color: '#123456',
};

describe('eventTitle — one vocabulary for every view', () => {
	it('is just the title when nothing else is true', () => {
		expect(eventTitle(local, { hiddenRemote: NONE })).toBe('Prepare the deck');
	});

	it('THE RULE: every view now says the SAME thing', () => {
		// The month grid said "not in the day plan"; the time grid said "Not in the
		// day plan — click the badge to add it". Two copies, already drifted.
		const unlinked = { ...local, linked: false };
		const fromGrid = eventTitle(unlinked, { hiddenRemote: NONE });
		const fromChip = eventTitle(unlinked, { hiddenRemote: NONE, draggableToGrid: true });
		expect(fromGrid).toContain('Not in the day plan — click the badge to add it');
		expect(fromChip).toContain('Not in the day plan — click the badge to add it');
	});

	it('names every local state it can', () => {
		const title = eventTitle(
			{ ...local, linked: false, duplicate: true, checked: true },
			{ hiddenRemote: NONE },
		);
		expect(title).toContain('This note is linked from more than one day');
		expect(title).toContain('Completed');
	});

	it('names the calendar a remote event came from', () => {
		expect(eventTitle(remote, { hiddenRemote: NONE })).toBe('Design review · Calendar: Work');
		expect(eventTitle(remote, { hiddenRemote: new Set(['r1']) })).toContain('Hidden here');
	});

	it('never attributes local states to a remote event', () => {
		// A subscribed event cannot be "not in the day plan" or "completed".
		const title = eventTitle(remote, { hiddenRemote: NONE, draggableToGrid: true });
		expect(title).not.toContain('day plan');
		expect(title).not.toContain('Drag onto the grid');
	});

	it('lets a view add what only it knows, first', () => {
		const title = eventTitle(local, {
			hiddenRemote: NONE,
			extra: ['Overlaps another block', 'Happening now'],
		});
		expect(title).toBe('Prepare the deck · Overlaps another block · Happening now');
	});

	it('drops empty and false extras instead of printing separators for them', () => {
		expect(eventTitle(local, { hiddenRemote: NONE, extra: [false, null, undefined, ''] })).toBe(
			'Prepare the deck',
		);
	});
});
