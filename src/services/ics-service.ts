import { App, Plugin, requestUrl, normalizePath } from 'obsidian';
import type { IcsStatus, RemoteEvent } from '../types';
import type { TaskNotesSettings, IcsCalendarSettings } from '../settings/settings';
import { remoteEventsStore, icsStatusStore } from '../state/stores';
import { expandIcs, icsBodyProblem } from '../core/ics-expand';
import { calendarColor } from '../core/ics-colors';
import { describeFetchFailure, stripBom } from '../core/ics-diagnosis';
import { errorMessage, structuredNotice } from '../lib/obsidian-utils';

/**
 * Fetches and expands remote ICS calendars. Uses requestUrl (CORS-free, works on
 * mobile), caches the last successful response per calendar as a fallback, and
 * refreshes on a timer, on reconnect, and on demand. Remote events are read-only.
 *
 * Expansion itself lives in core/ics-expand.ts; this class owns only the parts
 * that talk to the outside world.
 */
/** A feed that has not answered in this long is not going to. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * `requestUrl` has no timeout and Obsidian exposes no way to add one, so a hung
 * connection would pin a calendar at "Not fetched yet." for the rest of the session.
 */
function withTimeout<T>(promise: Promise<T>, ms = FETCH_TIMEOUT_MS): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

export class IcsService {
	private cache: Record<string, string>;
	private refreshHandle: number | null = null;
	private runToken = 0;
	/** One Notice per calendar per session — a broken feed should say so once. */
	private warned = new Set<string>();
	private disposed = false;

	constructor(
		private app: App,
		private getSettings: () => TaskNotesSettings,
		initialCache: Record<string, string>,
		private persistCache: (cache: Record<string, string>) => void,
	) {
		this.cache = { ...initialCache };
	}

	register(plugin: Plugin): void {
		plugin.registerDomEvent(window, 'online', () => void this.refreshAll());
		this.scheduleRefresh(plugin);
	}

	dispose(): void {
		// Separate from clearTimer: reconfigure() clears the timer constantly, and
		// must not put the service into the "unloaded, do nothing" state.
		this.disposed = true;
		this.clearTimer();
	}

	private clearTimer(): void {
		if (this.refreshHandle !== null) window.clearInterval(this.refreshHandle);
		this.refreshHandle = null;
	}

	private scheduleRefresh(plugin: Plugin): void {
		// clearInterval alone leaves the id registered with the plugin; clear it here
		// and re-register, so reconfiguring repeatedly can't pile up stale handles.
		this.clearTimer();
		const minutes = Math.max(1, this.getSettings().icsRefreshIntervalMinutes);
		this.refreshHandle = window.setInterval(() => void this.refreshAll(), minutes * 60_000);
		plugin.registerInterval(this.refreshHandle);
	}

	/** Re-read settings-driven timers and refetch (call when calendar settings change). */
	reconfigure(plugin: Plugin): void {
		// A URL the user just fixed deserves a fresh complaint if it is still broken.
		this.warned.clear();
		this.scheduleRefresh(plugin);
		void this.refreshAll();
	}

	/**
	 * Re-draw the calendars in their current colours, WITHOUT fetching.
	 *
	 * A colour is baked onto each RemoteEvent when the feed is expanded, so
	 * changing one does need a re-expand — but not a network round trip. The
	 * colour field used to call the same handler as the URL field, so dragging a
	 * colour picker would have hammered the user's calendar server.
	 */
	recolor(): void {
		if (this.disposed) return;
		const events: RemoteEvent[] = [];
		this.getSettings().icsCalendars.forEach((cal, index) => {
			const body = this.cache[cal.id];
			if (!cal.enabled || !body) return;
			try {
				events.push(...expandIcs(body, cal, calendarColor(cal.color, index), Date.now()));
			} catch {
				// A cached body that no longer parses is the fetch path's problem,
				// not this one's; leaving it out simply keeps the old drawing.
			}
		});
		remoteEventsStore.update((prev) => ({ version: prev.version + 1, events }));
	}

	async refreshAll(): Promise<void> {
		if (this.disposed) return;
		const token = ++this.runToken;
		const all = this.getSettings().icsCalendars;
		// Colour index comes from the FULL list, so disabling one calendar doesn't
		// recolour the others.
		const calendars = all
			.map((cal, index) => ({ cal, index }))
			.filter(({ cal }) => cal.enabled && cal.url.trim());
		const events: RemoteEvent[] = [];
		const status: Record<string, IcsStatus> = {};
		const pendingCache: Record<string, string> = {};

		await Promise.all(
			calendars.map(async ({ cal, index }) => {
				const color = calendarColor(cal.color, index);
				const fetched = await this.fetch(cal);
				let calEvents: RemoteEvent[] | null = null;
				let error = fetched.error;

				// Only trust (and cache) a body that actually parses as ICS — a 200-status
				// non-ICS response must never poison the offline fallback.
				const problem = fetched.text != null ? icsBodyProblem(fetched.text) : null;
				if (problem) error = problem;
				if (fetched.text != null && !problem) {
					try {
						calEvents = expandIcs(fetched.text, cal, color, Date.now());
						pendingCache[cal.id] = fetched.text;
					} catch (e) {
						error = `Not a valid calendar: ${errorMessage(e)}`;
						console.error(`Task Notes: failed to parse calendar "${cal.name}"`, e);
						calEvents = null;
					}
				}

				const cached = calEvents == null ? this.cache[cal.id] : undefined;
				if (cached) {
					try {
						calEvents = expandIcs(cached, cal, color, Date.now());
					} catch {
						calEvents = [];
					}
				}

				events.push(...(calEvents ?? []));
				status[cal.id] = {
					state: error ? (cached ? 'cached' : 'error') : 'ok',
					count: calEvents?.length ?? 0,
					at: Date.now(),
					error,
				};
			}),
		);

		// A newer refresh started while we were fetching — let it win, and leave the
		// cache exactly as that run found it. Same for an unload: no cache write, no
		// store write, no Notice from a service that has been switched off.
		if (this.disposed || token !== this.runToken) return;

		let cacheChanged = false;
		for (const [id, text] of Object.entries(pendingCache)) {
			if (this.cache[id] === text) continue;
			this.cache[id] = text;
			cacheChanged = true;
		}

		// Forget cached bodies of calendars the user removed (keyed on the FULL
		// list, so merely disabling one keeps its offline copy).
		const live = new Set(all.map((c) => c.id));
		for (const id of Object.keys(this.cache)) {
			if (!live.has(id)) {
				delete this.cache[id];
				cacheChanged = true;
			}
		}

		if (cacheChanged) this.persistCache(this.cache);
		icsStatusStore.set(status);
		this.announceFailures(calendars.map(({ cal }) => cal), status);
		remoteEventsStore.update((prev) => ({ version: prev.version + 1, events }));
	}

	/** Say something the first time a calendar fails — a silent empty grid is worse. */
	private announceFailures(calendars: IcsCalendarSettings[], status: Record<string, IcsStatus>): void {
		for (const cal of calendars) {
			const s = status[cal.id];
			if (!s || s.state === 'ok') {
				this.warned.delete(cal.id);
				continue;
			}
			if (this.warned.has(cal.id)) continue;
			this.warned.add(cal.id);
			// Warning-coloured and two lines, like every other message that needs
			// attention. A stale calendar looks exactly like an empty one, so the
			// first line says which of the two this is.
			structuredNotice(
				s.state === 'cached'
					? 'Calendar not syncing — showing the last copy that worked'
					: 'Calendar not syncing',
				`${cal.name} — ${s.error}`,
				{ warn: true, timeoutMs: 8000 },
			);
		}
	}

	private async fetch(cal: IcsCalendarSettings): Promise<{ text: string | null; error?: string }> {
		const source = cal.url.trim();
		// A value with no scheme is a file in the vault — an .ics you exported, or a
		// sample to try the feature offline. Nothing is sent anywhere for those.
		if (!/^[a-z][a-z0-9+.-]*:/i.test(source)) {
			try {
				// `getFileByPath` + `cachedRead`, not `vault.adapter`. The adapter is
				// the raw filesystem beneath the vault: it bypasses Obsidian's own
				// file table, so it reads paths the vault does not consider files and
				// misses its cache entirely. The review guidelines say to stay on the
				// vault API, and here it is also simply the more correct one.
				const path = normalizePath(source);
				const file = this.app.vault.getFileByPath(path);
				if (!file) return { text: null, error: `No such file in the vault: ${path}` };
				return { text: stripBom(await this.app.vault.cachedRead(file)) };
			} catch (e) {
				return { text: null, error: `Could not read the file: ${errorMessage(e)}` };
			}
		}
		const url = source.replace(/^webcal:/i, 'https:');
		try {
			// `throw: false` so the STATUS is readable. It defaults to true, which
			// turned every 4xx/5xx into an exception carrying only Obsidian's own
			// "Request failed, status 404" — accurate, and no help at all.
			const res = await withTimeout(requestUrl({ url, method: 'GET', throw: false }));
			if (res.status >= 400) {
				return { text: null, error: describeFetchFailure(url, res.status) };
			}
			return { text: stripBom(res.text) };
		} catch (e) {
			console.warn(`Task Notes: fetch failed for "${cal.name}", using cached copy`, e);
			// No status at all: DNS, offline, or our own timeout.
			return { text: null, error: describeFetchFailure(url, null) };
		}
	}
}
