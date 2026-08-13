import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { IcsService } from '../src/services/ics-service';
import { DEFAULT_SETTINGS, type IcsCalendarSettings } from '../src/settings/settings';
import { remoteEventsStore } from '../src/state/stores';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function ics(uid: string, summary: string): string {
	const start = new Date(Date.now() + 86_400_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	return [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'BEGIN:VEVENT',
		`UID:${uid}`,
		`DTSTART:${start}`,
		`SUMMARY:${summary}`,
		'END:VEVENT',
		'END:VCALENDAR',
	].join('\r\n');
}

describe('IcsService ordering', () => {
	it('publishes calendars in settings order, not network completion order', async () => {
		const calendars: IcsCalendarSettings[] = [
			{ id: 'first', name: 'First', url: 'https://first.test/feed.ics', color: '', email: '', enabled: true },
			{ id: 'second', name: 'Second', url: 'https://second.test/feed.ics', color: '', email: '', enabled: true },
		];
		const first = deferred<{ text: string | null; error?: string }>();
		const second = deferred<{ text: string | null; error?: string }>();
		const service = new IcsService(
			{} as never,
			() => ({ ...DEFAULT_SETTINGS, icsCalendars: calendars }),
			{},
			() => undefined,
		);
		(service as unknown as { fetch: (cal: IcsCalendarSettings) => Promise<{ text: string | null }> }).fetch =
			(cal) => (cal.id === 'first' ? first.promise : second.promise);

		const refresh = service.refreshAll();
		second.resolve({ text: ics('second-event', 'Second event') });
		await Promise.resolve();
		first.resolve({ text: ics('first-event', 'First event') });
		await refresh;

		expect(get(remoteEventsStore).events.map((event) => event.calendarId)).toEqual(['first', 'second']);
	});
});
