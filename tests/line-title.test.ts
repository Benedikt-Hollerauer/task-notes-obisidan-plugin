import { describe, it, expect } from 'vitest';
import { lineTitle } from '../src/core/line-title';
import { parsePlannerLine } from '../src/core/planner-line';

describe('lineTitle — literally what the note says after the time', () => {
	it('THE RULE: a link keeps its brackets', () => {
		// The timeline shows the note, not a tidied interpretation of it. This
		// deliberately reverses the earlier behaviour of rendering a link as its
		// basename.
		expect(lineTitle('[[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]')).toBe(
			'[[📅 By 2026-07-24 at 14.00h, prepare - 1 - deck]]',
		);
	});

	it('keeps an alias pipe, a folder path and a heading anchor', () => {
		expect(lineTitle('[[📅 meet - 1 - Bob|Bob]]')).toBe('[[📅 meet - 1 - Bob|Bob]]');
		expect(lineTitle('[[Areas/Work/📅 review - 1 - budget]]')).toBe('[[Areas/Work/📅 review - 1 - budget]]');
		expect(lineTitle('[[🎯 Top engineer#Milestones]]')).toBe('[[🎯 Top engineer#Milestones]]');
	});

	it('keeps every emoji and marker exactly as written', () => {
		expect(lineTitle('[[🅰️ 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork]]')).toBe(
			'[[🅰️ 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork]]',
		);
		expect(lineTitle('[[🔁 Consume - 0mg - of caffeine after 14.00h - per day ☕]]')).toBe(
			'[[🔁 Consume - 0mg - of caffeine after 14.00h - per day ☕]]',
		);
	});

	it('passes prose, mixed text and several links straight through', () => {
		expect(lineTitle('Water the plants')).toBe('Water the plants');
		expect(lineTitle('Prep for [[📅 call - 1 - Acme]] with Sam')).toBe(
			'Prep for [[📅 call - 1 - Acme]] with Sam',
		);
		expect(lineTitle('[[A]] then [[B|bee]]')).toBe('[[A]] then [[B|bee]]');
	});

	it('trims the surrounding whitespace and nothing else', () => {
		expect(lineTitle('  spaced out  ')).toBe('spaced out');
		expect(lineTitle('')).toBe('');
		expect(lineTitle('[[not closed')).toBe('[[not closed');
		expect(lineTitle('see [[]]')).toBe('see [[]]');
	});
});

describe('over real planner lines', () => {
	const titleOf = (raw: string) => lineTitle(parsePlannerLine(raw, 0)!.text);

	it('never includes the time — parsePlannerLine already removed it', () => {
		expect(titleOf('- [ ] 10:00 - 11:00 [[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]')).toBe(
			'[[📅 By 2026-07-27 at 10.00h, plan - 1 - sprint]]',
		);
		expect(titleOf('- [x] 13:00 Lunch')).toBe('Lunch');
	});

	it('keeps an invalid time visible instead of silently dropping it', () => {
		expect(titleOf('- [ ] 99:99 Standup')).toBe('99:99 Standup');
	});

	it('leaves a row with no text of its own empty', () => {
		expect(titleOf('- [ ] 07:00 - 08:00 ')).toBe('');
	});
});
