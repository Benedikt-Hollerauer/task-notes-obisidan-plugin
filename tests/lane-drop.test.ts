// Dropping a block into the all-day lane strips its time. That is a WRITE, and
// twice now it wrote something nobody asked for — so the rule that decides it is
// pure, and this is where it is pinned.

import { describe, it, expect } from 'vitest';
import { laneDropVerdict } from '../src/core/sync-decisions';

describe('laneDropVerdict — stripping a time is a refusal, never a guess', () => {
	it('allows the ordinary case: a linked line the day plan owns', () => {
		expect(laneDropVerdict({ linked: true, hasPlacement: true })).toBe('ok');
		expect(laneDropVerdict({ linked: true, hasPlacement: true, inDayPlan: true })).toBe('ok');
	});

	it('THE FOUR SILENT WRITES: an unlinked ghost is refused, not given 08:00', () => {
		// It has no planner line, so "remove the time" used to fall through to the
		// CREATE path, which resolved a slot from dayStartHour, wrote a line at
		// 08:00, and then renamed the note to match — rewriting every wikilink to
		// it across the vault. From a drag that meant "this has no time".
		expect(laneDropVerdict({ linked: false, hasPlacement: false })).toBe('not-in-plan');
	});

	it('refuses a half-state too — linked with no placement, or a placement with no link', () => {
		// The index can produce either while a write is in flight. Neither has a
		// line this can safely edit, and "probably fine" is how the first bug got
		// in.
		expect(laneDropVerdict({ linked: true, hasPlacement: false })).toBe('not-in-plan');
		expect(laneDropVerdict({ linked: false, hasPlacement: true })).toBe('not-in-plan');
	});

	it('THE SILENT VANISH: a line outside the planner section is refused', () => {
		// Such a line is indexed only BECAUSE it carries a time — under `## Log`,
		// say. Strip that and the block disappears from the timeline with no way
		// back except editing the note by hand.
		expect(laneDropVerdict({ linked: true, hasPlacement: true, inDayPlan: false })).toBe(
			'outside-section',
		);
	});

	it('treats an UNKNOWN section as inside — absence of evidence is not evidence', () => {
		// `inDayPlan` is optional; only an explicit `false` means "outside". An
		// undefined must not read as outside, or every event the index has not
		// fully resolved yet would refuse a legitimate drop.
		expect(laneDropVerdict({ linked: true, hasPlacement: true, inDayPlan: undefined })).toBe('ok');
	});

	it('refuses before it asks about the section — an unlinked note has no section', () => {
		expect(laneDropVerdict({ linked: false, hasPlacement: false, inDayPlan: false })).toBe(
			'not-in-plan',
		);
	});
});
