import { describe, it, expect } from 'vitest';
import { calendarColor, autoCalendarColor, DEFAULT_COLORS } from '../src/core/ics-colors';
import { DEFAULT_EVENT_COLOR } from '../src/constants';

describe('calendarColor — the swatch must show what the grid draws', () => {
	it('uses the colour the user picked', () => {
		expect(calendarColor('#ff0000', 3)).toBe('#ff0000');
	});

	it('falls back to the calendar’s automatic slot', () => {
		expect(calendarColor('', 0)).toBe(DEFAULT_EVENT_COLOR);
		expect(calendarColor(undefined, 1)).toBe(DEFAULT_COLORS[1]);
		expect(calendarColor('   ', 2)).toBe(DEFAULT_COLORS[2]);
	});

	it('cycles the palette rather than running out', () => {
		expect(autoCalendarColor(DEFAULT_COLORS.length)).toBe(DEFAULT_COLORS[0]);
		expect(autoCalendarColor(DEFAULT_COLORS.length + 1)).toBe(DEFAULT_COLORS[1]);
	});

	it('survives a nonsense index instead of returning undefined', () => {
		for (const i of [-1, 1.5, Number.NaN]) {
			expect(DEFAULT_COLORS).toContain(autoCalendarColor(i));
		}
	});

	it('THE RULE: the auto colour is derived, never stored', () => {
		// Writing it back into settings would be the plugin recording a decision
		// the user never made — and "automatic" would stop being restorable.
		const cal = { color: '' };
		expect(calendarColor(cal.color, 4)).toBe(DEFAULT_COLORS[4]);
		expect(cal.color).toBe('');
	});
});
