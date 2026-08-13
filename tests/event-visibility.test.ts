import { describe, it, expect } from 'vitest';
import { isEventDone, isEventVisible } from '../src/core/event-visibility';
import type { LocalEvent, RemoteEvent } from '../src/types';

const local = (checked: boolean): LocalEvent => ({
	kind: 'local',
	id: 'l1',
	title: 'Write the report',
	date: '2026-08-12',
	startMinutes: 540,
	endMinutes: 600,
	checked,
	linked: true,
});

const remote: RemoteEvent = {
	kind: 'remote',
	id: 'cal-a::uid::123',
	calendarId: 'cal-a',
	calendarName: 'Work',
	title: 'Standup',
	startTs: 123,
	endTs: 456,
	allDay: false,
	color: '#4c78a8',
};

const NONE: ReadonlySet<string> = new Set();
const HIDDEN: ReadonlySet<string> = new Set([remote.id]);

describe('what "done" means for each kind of event', () => {
	it('a local event carries it in the note', () => {
		expect(isEventDone(local(true), NONE)).toBe(true);
		expect(isEventDone(local(false), NONE)).toBe(false);
	});

	it('a remote event carries it only in the local hidden set', () => {
		// The source calendar is read-only, so nothing on the event itself can say
		// it is done — only this side knows.
		expect(isEventDone(remote, HIDDEN)).toBe(true);
		expect(isEventDone(remote, NONE)).toBe(false);
	});

	it('ignores anything checked-looking that strays onto a remote event', () => {
		const junk = { ...remote, checked: true } as unknown as RemoteEvent;
		expect(isEventDone(junk, NONE)).toBe(false);
	});
});

describe('one setting governs both kinds', () => {
	it('hides done things when completed items are off', () => {
		expect(isEventVisible(local(true), false, NONE)).toBe(false);
		expect(isEventVisible(remote, false, HIDDEN)).toBe(false);
	});

	it('shows them when completed items are on', () => {
		expect(isEventVisible(local(true), true, NONE)).toBe(true);
		expect(isEventVisible(remote, true, HIDDEN)).toBe(true);
	});

	it('leaves everything else alone either way', () => {
		for (const show of [true, false]) {
			expect(isEventVisible(local(false), show, HIDDEN)).toBe(true);
			expect(isEventVisible(remote, show, NONE)).toBe(true);
		}
	});
});
