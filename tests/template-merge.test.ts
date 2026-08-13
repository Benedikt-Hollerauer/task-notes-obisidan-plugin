import { describe, it, expect } from 'vitest';
import { interpolateTemplate, mergeTemplateIntoBareNote } from '../src/core/template-merge';
import { isBareDailyNote, buildBareDailyNote } from '../src/core/bare-note';
import { USER_NOTE } from './fixtures/user-note';

const HEADING = '## Day planner';
const DATE = '2026-08-08'; // a Saturday

describe('template variables a daily template actually uses', () => {
	it('resolves yesterday and tomorrow against the NOTE date, not today', () => {
		expect(interpolateTemplate('[[{{yesterday}}]] · [[{{tomorrow}}]]', DATE, 'x')).toBe(
			'[[2026-08-07]] · [[2026-08-09]]',
		);
	});

	it('resolves date arithmetic, with and without a unit or format', () => {
		expect(interpolateTemplate('{{date+3d}}', DATE, 'x')).toBe('2026-08-11');
		expect(interpolateTemplate('{{date-1d}}', DATE, 'x')).toBe('2026-08-07');
		expect(interpolateTemplate('{{date+1w:YYYY-MM-DD}}', DATE, 'x')).toBe('2026-08-15');
		// A date offset counts calendar units: `m` is months, not moment's minutes.
		expect(interpolateTemplate('{{date-1m}}', DATE, 'x')).toBe('2026-07-08');
		expect(interpolateTemplate('{{date+2M}}', DATE, 'x')).toBe('2026-10-08');
		expect(interpolateTemplate('{{date+1y}}', DATE, 'x')).toBe('2027-08-08');
		expect(interpolateTemplate('{{tomorrow:dddd}}', DATE, 'x')).toBe('Sunday');
	});

	it('leaves the plain forms exactly as they were', () => {
		expect(interpolateTemplate('{{date}}', DATE, 'x')).toBe(DATE);
		expect(interpolateTemplate('# {{date:dddd, MMMM D, YYYY}} — {{title}}', DATE, 'My Note')).toBe(
			'# Saturday, August 8, 2026 — My Note',
		);
	});

	it('never treats user text as a replacement pattern', () => {
		expect(interpolateTemplate('{{title}}', DATE, 'a $& b')).toBe('a $& b');
	});
});

describe('merging into a template built out of hour rows', () => {
	// The real shape: no `## Day planner` anywhere, structure carried by times.
	const TEMPLATE = USER_NOTE.replace(/\d{4}-\d{2}-\d{2}/g, '{{date}}');

	it('THE POINT: a planned event lands between the right two hour rows', () => {
		const merged = mergeTemplateIntoBareNote({
			templateRaw: TEMPLATE,
			heading: HEADING,
			preservedBlocks: [
				{ startMinutes: 12 * 60, lines: ['- [ ] 12:00 - 13:00 [[📅 By 2026-08-08 at 12.00h, call - 1 - Acme]]'] },
			],
			date: DATE,
			title: DATE,
		}).text;
		const lines = merged.split('\n');
		const at = lines.findIndex((l) => l.includes('call - 1 - Acme'));
		expect(lines[at - 1]).toBe('- [ ] 10:00 - 11:00 [[🔁 Do - 1 workout - with non-visual media 🏥]]');
		expect(lines[at + 1]).toBe('- [ ] 13:00 - 14:00 ');
		// And no stray heading was bolted onto the end of the note.
		expect(merged).not.toContain(HEADING);
	});

	it('keeps the whole template, with its own structure untouched', () => {
		const merged = mergeTemplateIntoBareNote({
			templateRaw: TEMPLATE,
			heading: HEADING,
			preservedBlocks: [{ startMinutes: 12 * 60, lines: ['- [ ] 12:00 New'] }],
			date: DATE,
			title: DATE,
		}).text;
		expect(merged).toContain('### 🎯 Timeboxing');
		expect(merged).toContain(`\t- ==📅 Monthly - First Mon - ${DATE}==`);
		expect(merged.split('\n')).toHaveLength(USER_NOTE.split('\n').length + 1);
	});

	it('carries a block and its sub-items in one piece', () => {
		const merged = mergeTemplateIntoBareNote({
			templateRaw: TEMPLATE,
			heading: HEADING,
			preservedBlocks: [
				{ startMinutes: 12 * 60, lines: ['- [ ] 12:00 Parent', '\t- [ ] first', '\t- [ ] second'] },
			],
			date: DATE,
			title: DATE,
		}).text;
		const lines = merged.split('\n');
		const at = lines.indexOf('- [ ] 12:00 Parent');
		expect(lines.slice(at, at + 3)).toEqual(['- [ ] 12:00 Parent', '\t- [ ] first', '\t- [ ] second']);
	});

	it('places several preserved blocks each at its own time', () => {
		const merged = mergeTemplateIntoBareNote({
			templateRaw: TEMPLATE,
			heading: HEADING,
			preservedBlocks: [
				{ startMinutes: 21 * 60, lines: ['- [ ] 21:00 Late'] },
				{ startMinutes: 9 * 60, lines: ['- [ ] 09:00 Early'] },
			],
			date: DATE,
			title: DATE,
		}).text;
		expect(merged.indexOf('09:00 Early')).toBeLessThan(merged.indexOf('21:00 Late'));
		expect(merged.indexOf('- [ ] 08:00 - 09:00')).toBeLessThan(merged.indexOf('09:00 Early'));
	});

	it('does not duplicate a line the template already has', () => {
		const merged = mergeTemplateIntoBareNote({
			templateRaw: TEMPLATE,
			heading: HEADING,
			preservedBlocks: [{ startMinutes: 7 * 60, lines: ['- [ ] 07:00 - 08:00'] }],
			date: DATE,
			title: DATE,
		}).text;
		expect(merged.split('- [ ] 07:00 - 08:00').length - 1).toBe(1);
	});
});

describe('the round trip a planned-ahead day actually takes', () => {
	it('bare note → still bare → merged, with the planned line intact', () => {
		// 1. Planning ahead writes a bare note and nothing else.
		const bare = buildBareDailyNote(HEADING, ['- [ ] 12:00 - 13:00 [[📅 By 2026-08-08 at 12.00h, call - 1 - Acme]]']);
		expect(bare).toBe(`${HEADING}\n- [ ] 12:00 - 13:00 [[📅 By 2026-08-08 at 12.00h, call - 1 - Acme]]\n`);

		// 2. It stays eligible for the template until the day arrives.
		expect(isBareDailyNote(bare, HEADING)).toBe(true);

		// 3. On arrival the template is merged around the planned line.
		const merged = mergeTemplateIntoBareNote({
			templateRaw: '---\ncreated: {{date}}\n---\n# {{date:dddd}}\n\n## Day planner\n\n## Notes\n',
			heading: HEADING,
			preservedBlocks: [{ startMinutes: 12 * 60, lines: bare.split('\n').slice(1, 2) }],
			date: DATE,
			title: DATE,
		}).text;
		expect(merged).toContain('created: 2026-08-08');
		expect(merged).toContain('# Saturday');
		expect(merged).toContain('- [ ] 12:00 - 13:00 [[📅 By 2026-08-08 at 12.00h, call - 1 - Acme]]');
		expect(merged.indexOf('call - 1 - Acme')).toBeLessThan(merged.indexOf('## Notes'));
		// And it is no longer bare, so it can never be merged into twice.
		expect(isBareDailyNote(merged, HEADING)).toBe(false);
	});

	it('a checkbox-free line no longer blocks the merge forever', () => {
		// Dragging `- 16:00 Reviewed the deck` onto a future day used to make that
		// note permanently ineligible, so its template never arrived.
		const bare = `${HEADING}\n- 16:00 Reviewed the deck\n`;
		expect(isBareDailyNote(bare, HEADING)).toBe(true);
		const merged = mergeTemplateIntoBareNote({
			templateRaw: `# {{date}}\n\n${HEADING}\n\n## Notes\n`,
			heading: HEADING,
			preservedBlocks: [{ startMinutes: 16 * 60, lines: ['- 16:00 Reviewed the deck'] }],
			date: DATE,
			title: DATE,
		}).text;
		expect(merged).toContain('- 16:00 Reviewed the deck');
		// Still checkbox-free: the merge carries the line, it does not rewrite it.
		expect(merged).not.toContain('- [ ] 16:00 Reviewed the deck');
	});
});

describe('THE DATA-LOSS GUARD: a merge that cannot place a block refuses', () => {
	// mergeTemplateIntoBareNote REPLACES the whole note. `insertTimedBlock` refuses
	// when the block's own first line already exists — and that refusal used to be
	// discarded, so the block AND everything nested under it vanished. A template
	// built out of hour rows (`- [ ] 07:00 - 08:00`) collides with a planned block
	// of the same name, which is the ordinary case, not an exotic one.
	const heading = '## Day planner';

	it('reports the block it could not place instead of dropping it', () => {
		const template = `${heading}\n- [ ] 07:00 - 08:00\n- [ ] 09:00 - 10:00\n`;
		const result = mergeTemplateIntoBareNote({
			templateRaw: template,
			heading,
			preservedBlocks: [
				{ lines: ['- [ ] 07:00 - 08:00', '\t- [ ] Document 1 dream', '\t- [ ] Apply minoxidil'], startMinutes: 420 },
			],
			date: '2026-08-20',
			title: 'x',
		});
		expect(result.dropped).toEqual(['- [ ] 07:00 - 08:00']);
		// And the sub-items are NOT in the text — which is exactly why the caller
		// must refuse to write it.
		expect(result.text).not.toContain('Document 1 dream');
	});

	it('places a block whose line the template does not already have', () => {
		const template = `${heading}\n- [ ] 09:00 - 10:00\n`;
		const result = mergeTemplateIntoBareNote({
			templateRaw: template,
			heading,
			preservedBlocks: [{ lines: ['- [ ] 07:00 - 08:00', '\t- [ ] Dream'], startMinutes: 420 }],
			date: '2026-08-20',
			title: 'x',
		});
		expect(result.dropped).toEqual([]);
		expect(result.text).toContain('Dream');
	});

	it('two blocks sharing a first line but not their children is a loss, and says so', () => {
		const result = mergeTemplateIntoBareNote({
			templateRaw: `${heading}\n`,
			heading,
			preservedBlocks: [
				{ lines: ['- [ ] 07:00 - 08:00', '\t- [ ] one'], startMinutes: 420 },
				{ lines: ['- [ ] 07:00 - 08:00', '\t- [ ] two'], startMinutes: 420 },
			],
			date: '2026-08-20',
			title: 'x',
		});
		expect(result.dropped).toEqual(['- [ ] 07:00 - 08:00']);
	});

	// REVERSED DELIBERATELY in v4.3. This used to assert that a byte-identical
	// twin "is genuinely redundant and costs nothing", and collapsed it silently.
	// That reasoning is about the TEXT, and the rule here is about the USER: this
	// merge replaces the whole note, so collapsing a twin deletes a line they
	// typed. Two identical `- [ ] 09:00 - 10:00 standup` rows in a hand-kept plan
	// is an ordinary thing to have, and getting the note back with one of them
	// missing is precisely the unrequested edit this path may not make.
	//
	// Reporting it means the caller refuses and says so — the note is left alone
	// and the user decides. Costing an occasional refusal is the cheap direction;
	// silently deleting a line is not.
	it('an EXACT duplicate is reported too — collapsing it would delete a typed line', () => {
		const block = { lines: ['- [ ] 07:00 - 08:00', '\t- [ ] one'], startMinutes: 420 };
		const result = mergeTemplateIntoBareNote({
			templateRaw: `${heading}\n`,
			heading,
			preservedBlocks: [block, { ...block, lines: [...block.lines] }],
			date: '2026-08-20',
			title: 'x',
		});
		expect(result.dropped).toEqual(['- [ ] 07:00 - 08:00']);
	});
});
