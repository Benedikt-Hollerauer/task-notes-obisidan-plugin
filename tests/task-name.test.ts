import { describe, it, expect } from 'vitest';
import {
	parseTaskProperties,
	generateTaskName,
	getTaskFormatByEmoji,
	validateFormatTemplate,
} from '../src/core/task-name';
import {
	extractTaskEmoji,
	extractTaskName,
	hasTaskEmoji,
	getNormalizedEmoji,
	normalizeEmoji,
} from '../src/core/emoji';
import type { TaskFormatSettings } from '../src/types';

const FORMATS: TaskFormatSettings = {
	uncheckedTaskFormat: '{action} - {amount} - {outcome}',
	scheduledTaskFormat: 'By {date} (at {time} - {range}), {action} - {amount} - {outcome}',
	completedTaskFormat: '{action} - {amount} - {outcome}',
	cancelledTaskFormat: '{action} - {amount} - {outcome}',
	projectFolderFormat: '{action} - {amount} - {outcome}',
	targetFolderFormat: '{action} - {amount} - {outcome}',
	routineTaskFormat: '{action} - {amount} - {outcome} - {cycle}',
};

// Real filenames from the test vault — the frozen-format regression corpus.
const CORPUS = [
	'❌ By 2026-01-28, d - j - 1dcdddfdsffdsfasd',
	'📅 By 2026-01-23 at 12.34h, fdfgdsdfsdgffgdfgd - dfa - dfsa',
	'📅 By 2026-01-23 at 16.48h - 2026-01-24, $2 - dfs - asdf',
	'✅ Finish project report - fd - sfadsdf',
	'✅ By 2026-01-15, fsdgfdgsfdgs - fsdgfdgsfdg - fsdgfdgsfsdg',
	'◻ undefinedsadfdfsadfs - safddfsa - sdaffd',
];

describe('emoji detection', () => {
	it('detects every recognised prefix', () => {
		expect(extractTaskEmoji('◻️ Buy - 3 - things')).toBe('◻️');
		expect(extractTaskEmoji('📅 By 2026-01-01, a - b - c')).toBe('📅');
		expect(extractTaskEmoji('✅ done - 1 - x')).toBe('✅');
		expect(extractTaskEmoji('❌ no - 1 - x')).toBe('❌');
		expect(extractTaskEmoji('🚀 Proj - 1 - x')).toBe('🚀');
		expect(extractTaskEmoji('🎯 Goal - 1 - x')).toBe('🎯');
	});

	it('handles the bare ◻ without variation selector', () => {
		expect(hasTaskEmoji('◻ undefinedsadfdfsadfs - safddfsa - sdaffd')).toBe(true);
		expect(getNormalizedEmoji('◻ x - y - z')).toBe(normalizeEmoji('◻️'));
	});

	it('returns null when there is no prefix', () => {
		expect(extractTaskEmoji('just a note')).toBeNull();
		expect(hasTaskEmoji('just a note')).toBe(false);
	});

	it('extracts the name without the emoji', () => {
		expect(extractTaskName('📅 By 2026-01-23 at 12.34h, a - b - c')).toBe(
			'By 2026-01-23 at 12.34h, a - b - c',
		);
		expect(extractTaskName('✅ Finish project report - fd - sfadsdf')).toBe(
			'Finish project report - fd - sfadsdf',
		);
	});
});

describe('parseTaskProperties — event grammar', () => {
	it('parses date + time', () => {
		const p = parseTaskProperties('By 2026-01-23 at 12.34h, send - 1 - invoice', true);
		expect(p.startDate).toBe('2026-01-23');
		expect(p.time).toBe('12.34h');
		expect(p.endDate).toBeUndefined();
		expect(p).toMatchObject({ actionWords: 'send', amount: '1', amountOutcome: 'invoice' });
	});

	it('parses date + time + range', () => {
		const p = parseTaskProperties('By 2026-01-23 at 16.48h - 2026-01-24, $2 - dfs - asdf', true);
		expect(p.startDate).toBe('2026-01-23');
		expect(p.time).toBe('16.48h');
		expect(p.endDate).toBe('2026-01-24');
		expect(p).toMatchObject({ actionWords: '$2', amount: 'dfs', amountOutcome: 'asdf' });
	});

	it('parses legacy parens format', () => {
		const p = parseTaskProperties('By 2026-01-17 (at 14.30h - 2026-01-18), prepare - 1 - deck', true);
		expect(p.startDate).toBe('2026-01-17');
		expect(p.time).toBe('14.30h');
		expect(p.endDate).toBe('2026-01-18');
		expect(p.actionWords).toBe('prepare');
	});

	it('parses date-only', () => {
		const p = parseTaskProperties('By 2026-01-28, d - j - 1dcdddfdsffdsfasd', true);
		expect(p.startDate).toBe('2026-01-28');
		expect(p.time).toBeUndefined();
		expect(p).toMatchObject({ actionWords: 'd', amount: 'j', amountOutcome: '1dcdddfdsffdsfasd' });
	});

	it('parses a plain (non-event) task', () => {
		const p = parseTaskProperties('Finish project report - fd - sfadsdf', false);
		expect(p).toMatchObject({
			actionWords: 'Finish project report',
			amount: 'fd',
			amountOutcome: 'sfadsdf',
		});
	});
});

describe('generateTaskName — round trips', () => {
	it('date + time renders without parens/orphans', () => {
		const name = generateTaskName(
			{ actionWords: 'Send', amount: '1', amountOutcome: 'invoice', startDate: '2026-01-23', time: '12.34h' },
			FORMATS.scheduledTaskFormat,
		);
		expect(name).toBe('By 2026-01-23 at 12.34h, send - 1 - invoice');
	});

	it('date + time + range', () => {
		const name = generateTaskName(
			{
				actionWords: 'Prepare',
				amount: '1',
				amountOutcome: 'deck',
				startDate: '2026-01-17',
				time: '14.30h',
				endDate: '2026-01-18',
			},
			FORMATS.scheduledTaskFormat,
		);
		expect(name).toBe('By 2026-01-17 at 14.30h - 2026-01-18, prepare - 1 - deck');
	});

	it('date only (no time, no range)', () => {
		const name = generateTaskName(
			{ actionWords: 'Meet', amount: '1', amountOutcome: 'team', startDate: '2026-01-17' },
			FORMATS.scheduledTaskFormat,
		);
		expect(name).toBe('By 2026-01-17, meet - 1 - team');
	});

	it('regular task capitalizes the action', () => {
		const name = generateTaskName(
			{ actionWords: 'buy', amount: '3', amountOutcome: 'groceries' },
			FORMATS.uncheckedTaskFormat,
		);
		expect(name).toBe('Buy - 3 - groceries');
	});

	it('parse ∘ generate is stable for the scheduled format', () => {
		for (const start of ['By 2026-01-23 at 12.34h, send - 1 - invoice', 'By 2026-01-17, meet - 1 - team']) {
			const props = parseTaskProperties(start, true);
			const regen = generateTaskName(props, FORMATS.scheduledTaskFormat);
			// Re-capitalize expectation: the action is lowercased for events, so compare to a
			// normalized form of the input.
			const reparsed = parseTaskProperties(regen, true);
			expect(reparsed.startDate).toBe(props.startDate);
			expect(reparsed.time).toBe(props.time);
			expect(reparsed.actionWords.toLowerCase()).toBe(props.actionWords.toLowerCase());
		}
	});
});

describe('helpers', () => {
	it('maps emoji to format', () => {
		expect(getTaskFormatByEmoji('📅', FORMATS)).toBe(FORMATS.scheduledTaskFormat);
		expect(getTaskFormatByEmoji('🚀', FORMATS)).toBe(FORMATS.projectFolderFormat);
		expect(getTaskFormatByEmoji('◻️', FORMATS)).toBe(FORMATS.uncheckedTaskFormat);
	});

	it('flags duplicate placeholders', () => {
		expect(validateFormatTemplate('{action} - {action}')).toContain('Duplicate');
		expect(validateFormatTemplate('{action} - {amount} - {outcome}')).toBe('');
	});
});

describe('corpus stays parseable', () => {
	it.each(CORPUS)('parses %s', (basename) => {
		const emoji = extractTaskEmoji(basename);
		expect(emoji).not.toBeNull();
		const name = extractTaskName(basename);
		const isEvent = getNormalizedEmoji(basename) === normalizeEmoji('📅');
		const props = parseTaskProperties(name, isEvent || /^By\s+\d{4}-\d{2}-\d{2}/.test(name));
		expect(props.actionWords.length).toBeGreaterThan(0);
	});
});
