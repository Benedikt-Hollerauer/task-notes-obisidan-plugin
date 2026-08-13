// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MonthGrid from '../../src/ui/views/svelte/calendar/MonthGrid.svelte';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import type { LocalEvent } from '../../src/types';

const duplicate = (title: string): LocalEvent => ({
	kind: 'local',
	id: 'same-domain-id',
	title,
	date: '2026-08-20',
	startMinutes: 9 * 60,
	endMinutes: 10 * 60,
	checked: false,
	linked: true,
});

describe('MonthGrid duplicate event ids', () => {
	let host: HTMLElement;

	beforeEach(() => {
		host = document.createElement('div');
		document.body.appendChild(host);
		if (typeof ResizeObserver === 'undefined') {
			Object.assign(globalThis, {
				ResizeObserver: class {
					observe(): void {}
					disconnect(): void {}
				},
			});
		}
	});

	afterEach(() => host.remove());

	it('renders both chips and resolves the exact chip for its menu', () => {
		const events = [duplicate('First copy'), duplicate('Second copy')];
		const onContext = vi.fn();
		const app = mount(MonthGrid, {
			target: host,
			props: {
				anchor: '2026-08-20',
				events,
				settings: DEFAULT_SETTINGS,
				today: '2026-08-12',
				onDayClick: () => undefined,
				onEventContextMenu: onContext,
			},
		});
		flushSync();

		const chips = [...host.querySelectorAll<HTMLElement>('.tn-cal-chip')];
		expect(chips).toHaveLength(2);
		expect(new Set(chips.map((chip) => chip.dataset.chipKey)).size).toBe(2);
		expect(chips.map((chip) => chip.dataset.chipId)).toEqual(['same-domain-id', 'same-domain-id']);

		chips[1]?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		expect(onContext).toHaveBeenCalledOnce();
		expect(onContext.mock.calls[0]?.[0]).toBe(events[1]);
		unmount(app);
	});
});
