import { App, Plugin, TFile, normalizePath } from 'obsidian';
import type { DayPlan, EventPlacement, LocalEvent, PlannerLine, TaskProperties } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import type { DailyNoteService } from './daily-note-service';
import { EMOJI_REGISTRY , templateKeyOf} from '../constants';
import { suppressGhost } from '../core/ghost-suppression';
import { hasTaskEmoji } from '../core/emoji';
import { isScheduledBasename, parseEventBasename, filenameStartMinutes } from '../core/event-filename';
import { scanDayLines } from '../core/planner-section';
import { bodyOf, isBodyRow, bodyProgress } from '../core/line-tree';
import { createSerialQueue } from '../core/serial-queue';
import { isChecked } from '../core/planner-line';
import { lineTitle } from '../core/line-title';
import { localEventsStore } from '../state/stores';
import { isMarkdownFile } from '../lib/obsidian-utils';

interface FileEntry {
	path: string;
	basename: string;
	props: TaskProperties;
	date: string | null;
	startMinutes: number | null;
	endDate?: string;
}

const FLUSH_DELAY_MS = 150;

/**
 * Single in-memory source of truth for local events. Joins two maps —
 * 📅 files (from filenames, zero I/O) and daily-note planner sections — into the
 * LocalEvent[] the views render. Updates are path-classified, debounced and
 * coalesced so typing or bulk edits don't trigger re-index storms.
 */
export class EventIndex {
	/**
	 * Obsidian replays a `create` event for EVERY existing file when the vault
	 * loads, and the metadata cache resolves in waves after that. Until the
	 * initial scan has finished we index quietly: no "changed" reports, so a
	 * launch can never trigger reconcile — and therefore never rename — across
	 * the whole vault.
	 */
	private started = false;
	private disposed = false;

	private byFile = new Map<string, FileEntry>();
	private byDaily = new Map<string, DayPlan>();
	/** filePath → number of planner lines claiming it, across all daily notes. */
	private claimCounts = new Map<string, number>();
	private dirty = new Set<string>();
	private flushHandle: number | null = null;
	private version = 0;

	constructor(
		private app: App,
		private dailyNotes: DailyNoteService,
		private getSettings: () => TaskNotesSettings,
		private onDailyNotesChanged?: (paths: string[]) => void,
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(this.app.vault.on('create', (f) => this.mark(f.path)));
		plugin.registerEvent(this.app.vault.on('delete', (f) => this.mark(f.path)));
		plugin.registerEvent(
			this.app.vault.on('rename', (f, oldPath) => {
				this.mark(oldPath);
				this.mark(f.path);
			}),
		);
		plugin.registerEvent(this.app.metadataCache.on('changed', (f) => this.mark(f.path)));
	}

	dispose(): void {
		// Work already queued re-checks this before it publishes or calls out, so an
		// in-flight flush can never rename a file after the plugin is unloaded.
		this.disposed = true;
		this.dirty.clear();
		if (this.flushHandle !== null) {
			window.clearTimeout(this.flushHandle);
			this.flushHandle = null;
		}
	}

	/**
	 * Full scan (call on layout ready). Reads only daily notes; 📅 files are name-only.
	 * Deliberately does NOT report the notes as "changed" — startup must not trigger
	 * a reconcile (and potential renames) across every historical daily note.
	 */
	async initialScan(): Promise<void> {
		return this.queue(() => this.initialScanInner());
	}

	private async initialScanInner(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const excluded = this.excludedPaths(); // loop invariant — computed once
		await Promise.all(
			files.map((file) =>
				this.classifyInto(file, excluded).catch((e) =>
					console.error(`Task Notes: failed to index ${file.path}`, e),
				),
			),
		);
		this.rebuild();
		// Everything the launch produced is already reflected; from here on,
		// changes are real user edits.
		this.dirty.clear();
		this.started = true;
	}

	/**
	 * Re-read every file already in the index and rebuild.
	 *
	 * Some settings — the timeline heading above all — are read while indexing,
	 * so changing one leaves every view showing results computed under the old
	 * value until some unrelated file happens to change. This re-reads; it never
	 * writes, never scans the vault for new files, and never reports a note as
	 * changed (which would put it in front of the renamer).
	 */
	async reindexAll(): Promise<void> {
		if (this.disposed) return;
		// Real pending edits report normally first; then a quiet, serialized re-read.
		await this.flush();
		return this.queue(() => this.reindexInner());
	}

	private async reindexInner(): Promise<void> {
		const paths = [...this.byDaily.keys(), ...this.byFile.keys()];
		const excluded = this.excludedPaths();
		await Promise.all(
			paths.map((path) => {
				const file = this.app.vault.getFileByPath(path);
				if (!file) return Promise.resolve();
				return this.classifyInto(file, excluded).catch((e) =>
					console.error(`Task Notes: failed to re-index ${path}`, e),
				);
			}),
		);
		if (this.disposed) return;
		this.rebuild();
	}

	getPlan(dailyPath: string): DayPlan | undefined {
		return this.byDaily.get(dailyPath);
	}

	/**
	 * How many planner lines across the whole vault link this 📅 file.
	 * Always fresh where it matters: reconcile awaits flushNow(), and flush ends
	 * in rebuild(), which recomputes these counts.
	 */
	claimCountFor(filePath: string): number {
		return this.claimCounts.get(filePath) ?? 0;
	}

	allPlans(): DayPlan[] {
		return [...this.byDaily.values()];
	}

	/** Force an immediate flush of pending changes (used before some writes). */
	async flushNow(): Promise<void> {
		if (this.flushHandle !== null) {
			window.clearTimeout(this.flushHandle);
			this.flushHandle = null;
		}
		await this.flush();
	}

	private mark(path: string): void {
		if (this.disposed) return;
		if (!path.endsWith('.md')) return;
		this.dirty.add(path);
		this.scheduleFlush();
	}

	/**
	 * A COALESCER, not a debounce: the first dirty path starts the clock and
	 * later ones join the same pass. Deliberately not `debounce(…, true)` —
	 * resetting the timer on every change would let a burst of edits (a paste, a
	 * sync) starve the flush indefinitely, and the index would never catch up.
	 */
	private scheduleFlush(): void {
		if (this.flushHandle !== null) return;
		this.flushHandle = window.setTimeout(() => {
			this.flushHandle = null;
			void this.flush();
		}, FLUSH_DELAY_MS);
	}

	/**
	 * Every pass over the index runs here, one at a time, in call order.
	 *
	 * A re-index landing between flushInner's two `reconcileKey` reads would make
	 * a real edit look unchanged — and silently stop the filename ever tracking
	 * the line again. One queue makes that impossible.
	 */
	private queue = createSerialQueue();

	private async flush(): Promise<void> {
		// Never reject: callers (reconcile / applyBlockEdit) only await ordering.
		await this.queue(async () => {
			if (this.disposed || this.dirty.size === 0) return;
			await this.flushInner().catch((e) => console.error('Task Notes: index flush failed', e));
		});
	}

	private async flushInner(): Promise<void> {
		const paths = [...this.dirty];
		this.dirty.clear();
		const excluded = this.excludedPaths();

		const changedDaily: string[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!isMarkdownFile(file)) {
				this.byFile.delete(path);
				this.byDaily.delete(path);
				continue;
			}
			try {
				const before = this.byDaily.get(path);
				const kind = await this.classifyInto(file, excluded);
				const after = this.byDaily.get(path);
				// Report a daily note as changed only when something reconcile CARES
				// about changed. Ticking a checkbox rewrites one character; without this
				// it would run the renamer over the whole day, for nothing.
				if (kind === 'daily' && reconcileKey(before) !== reconcileKey(after)) {
					changedDaily.push(path);
				}
			} catch (e) {
				// One unreadable file must not drop the rest of the batch — retry it
				// on the next flush instead of losing it from the index.
				console.error(`Task Notes: failed to index ${path}`, e);
				this.dirty.add(path);
			}
		}

		// Unloaded while we were reading: publish nothing and, above all, reconcile
		// nothing — that path ends in fileManager.renameFile.
		if (this.disposed) return;
		this.rebuild();
		if (changedDaily.length && this.started) this.onDailyNotesChanged?.(changedDaily);
	}

	/** Template files must never be treated as events or daily notes. */
	private excludedPaths(): Set<string> {
		const s = this.getSettings();
		const paths = new Set<string>();
		// Derived from the registry, not hand-listed: a fourth template used to
		// mean a fourth line here, and forgetting it would index that template as
		// the very kind of note it is a template FOR.
		const templates = EMOJI_REGISTRY.map((spec) => {
			const key = templateKeyOf(spec);
			return key ? s[key] : '';
		});
		for (const raw of [this.dailyNotes.templatePath(), ...templates]) {
			if (!raw || !raw.trim()) continue;
			const p = normalizePath(raw.trim());
			paths.add(p.endsWith('.md') ? p : `${p}.md`);
		}
		return paths;
	}

	/** Update the maps for one file; returns which map it landed in. */
	private async classifyInto(file: TFile, excluded = this.excludedPaths()): Promise<'file' | 'daily' | 'none'> {
		const basename = file.basename;

		if (excluded.has(file.path)) {
			this.byFile.delete(file.path);
			this.byDaily.delete(file.path);
			return 'none';
		}

		if (hasTaskEmoji(basename) && isScheduledBasename(basename)) {
			this.byDaily.delete(file.path);
			this.byFile.set(file.path, this.buildFileEntry(file));
			return 'file';
		}

		const date = this.dailyNotes.dateOf(file);
		if (date) {
			this.byFile.delete(file.path);
			const content = await this.app.vault.cachedRead(file);
			const heading = this.getSettings().plannerHeading;
			const { plannerLines, extraLines, tree } = scanDayLines(content, heading);
			this.byDaily.set(file.path, { date, path: file.path, lines: plannerLines, extraLines, tree });
			return 'daily';
		}

		this.byFile.delete(file.path);
		this.byDaily.delete(file.path);
		return 'none';
	}

	private buildFileEntry(file: TFile): FileEntry {
		const format = this.getSettings().scheduledTaskFormat;
		const props = parseEventBasename(file.basename, format);
		return {
			path: file.path,
			basename: file.basename,
			props,
			date: props.startDate ?? null,
			startMinutes: filenameStartMinutes(file.basename, format),
			endDate: props.endDate,
		};
	}

	private resolveLink(target: string | null, sourcePath: string): TFile | null {
		if (!target) return null;
		return this.app.metadataCache.getFirstLinkpathDest(target, sourcePath);
	}

	/**
	 * True when a line belongs to the block above it, and so must not also stand
	 * alone on the timeline.
	 *
	 * Anything indented under a timed line is part of that block — including a
	 * line with a time of its own. A 09:30 sub-item of a 09:00–11:00 block is a
	 * step within it, not a second event competing for the same column.
	 *
	 * Nesting under an UNTIMED line absorbs nothing: no block owns those lines, so
	 * a real event can't be swallowed by a bullet under `## Notes`.
	 */
	private attached(plan: DayPlan, line: PlannerLine): boolean {
		return isBodyRow(plan.tree, line.lineNo);
	}

	private rebuild(): void {
		const settings = this.getSettings();
		const duration = settings.defaultEventDurationMinutes;
		const events: LocalEvent[] = [];

		// filePath → claiming (plan, line) pairs.
		const claims = new Map<string, { plan: DayPlan; line: PlannerLine }[]>();
		// filePath → the DATES of every daily note that references it, from inside
		// the planner section or outside it. Dates, not a bare set of paths: a
		// reference on some other day says "I planned this note into that day" and
		// must not silence the note on its own date. See core/ghost-suppression.ts.
		const referencedOn = new Map<string, Set<string>>();
		const noteReference = (path: string, date: string): void => {
			const dates = referencedOn.get(path) ?? new Set<string>();
			dates.add(date);
			referencedOn.set(path, dates);
		};

		for (const plan of this.byDaily.values()) {
			for (const line of plan.lines) {
				const resolved = this.resolveLink(line.linkTarget, plan.path);
				if (resolved && this.byFile.has(resolved.path)) {
					const list = claims.get(resolved.path) ?? [];
					list.push({ plan, line });
					claims.set(resolved.path, list);
					noteReference(resolved.path, plan.date);
					continue;
				}
				// Claiming happens above, unconditionally: a nested line still claims
				// its file, so nesting a line can never quietly unlock a rename.
				if (this.attached(plan, line)) continue;
				const ev = this.buildLineEvent(plan, line, resolved, duration, settings, true);
				if (ev) events.push(ev);
			}
			// Lines outside the section are rendered as themselves, always — they are
			// never matched to a 📅 file, so they can't drive a rename or a duplicate.
			for (const line of plan.extraLines) {
				const resolved = this.resolveLink(line.linkTarget, plan.path);
				if (resolved) noteReference(resolved.path, plan.date);
				if (this.attached(plan, line)) continue;
				const ev = this.buildLineEvent(plan, line, resolved, duration, settings, false);
				if (ev) events.push(ev);
			}
		}

		// How many planner lines claim each file, ACROSS ALL daily notes. reconcile
		// needs this: a file claimed twice has no single satisfying filename.
		this.claimCounts = new Map([...claims].map(([path, list]) => [path, list.length]));

		for (const [filePath, claimants] of claims) {
			// Guarded here rather than asserted: `claims` is built from byFile.has()
			// thirty lines above, and an invariant that far from its use is one
			// refactor away from being a crash on the user's index rebuild.
			const entry = this.byFile.get(filePath);
			if (!entry) continue;
			const visible = claimants.filter((c) => !this.attached(c.plan, c.line));
			// Pick the canonical claim among the ones the user can actually SEE: a
			// hidden body row winning would mark every visible block as a duplicate.
			const canonical = this.pickCanonical(visible.length ? visible : claimants, entry.date);
			for (const c of visible) {
				events.push(this.buildLinkedEvent(entry, c.plan, c.line, duration, c !== canonical));
			}
		}

		for (const [path, entry] of this.byFile) {
			if (!entry.date) continue;
			// Date-scoped: only a reference ON THIS FILE'S OWN DATE hides the ghost,
			// because only that one would sit on top of the block it already draws.
			// A reference from any other day leaves the ghost standing, so a note
			// planned into the wrong day is visible on both — where it was planned,
			// and where its own name says it belongs.
			if (suppressGhost(entry.date, referencedOn.get(path) ?? [])) continue;
			events.push(this.buildUnlinkedEvent(entry, entry.date, duration));
		}

		this.version += 1;
		localEventsStore.set({ version: this.version, events });
	}

	private pickCanonical(
		claimants: { plan: DayPlan; line: PlannerLine }[],
		fileDate: string | null,
	): { plan: DayPlan; line: PlannerLine } {
		const match = claimants.find((c) => c.plan.date === fileDate);
		if (match) return match;
		return [...claimants].sort((a, b) => a.plan.date.localeCompare(b.plan.date))[0];
	}

	/** The daily-note placement of a planner line. */
	private placementOf(plan: DayPlan, line: PlannerLine): EventPlacement {
		return {
			dailyNotePath: plan.path,
			date: plan.date,
			lineNo: line.lineNo,
			raw: line.raw,
			status: line.status,
			checked: isChecked(line),
		};
	}

	/** The body of a line, plus its tick count, ready to hang on an event. */
	private bodyFor(plan: DayPlan, line: PlannerLine): Pick<LocalEvent, 'body' | 'bodyProgress'> {
		const rows = bodyOf(plan.tree, line.lineNo);
		if (rows.length === 0) return {};
		const progress = bodyProgress(rows);
		return { body: rows, bodyProgress: progress.total > 0 ? progress : undefined };
	}

	private lineId(plan: DayPlan, line: PlannerLine): string {
		return `${plan.path}::${line.lineNo}`;
	}

	private buildLinkedEvent(
		entry: FileEntry,
		plan: DayPlan,
		line: PlannerLine,
		duration: number,
		duplicate: boolean,
	): LocalEvent {
		// The LINE decides, not the filename. This used to be
		// `line.startMinutes ?? entry.startMinutes`, so an untimed line linking a
		// note whose NAME carried a time still drew as a timed block — which made
		// dragging a block into the all-day lane impossible: the line was written
		// untimed and the very next rebuild put the block back at the old hour.
		//
		// The name keeps its time; it just stops overriding the plan. Nothing is
		// written or renamed by this — `decideReconcile` passes a null start
		// through as "leave the filename alone".
		const start = line.startMinutes;
		const end = line.endMinutes ?? (start != null ? start + duration : null);
		const body = this.bodyFor(plan, line);
		return {
			kind: 'local',
			...body,
			id: this.lineId(plan, line),
			filePath: entry.path,
			// The line, verbatim: `[[📅 By … , prepare - 1 - deck]]` reads as the
			// note's full name, emoji included — not just its extracted fields.
			title: lineTitle(line.text) || entry.basename,
			date: plan.date,
			startMinutes: start,
			endMinutes: end,
			endDate: entry.endDate,
			checked: isChecked(line),
			linked: true,
			inDayPlan: true,
			placement: this.placementOf(plan, line),
			duplicate,
		};
	}

	private buildLineEvent(
		plan: DayPlan,
		line: PlannerLine,
		resolved: TFile | null,
		duration: number,
		settings: TaskNotesSettings,
		inDayPlan: boolean,
	): LocalEvent | null {
		if (!settings.showPlainTextBlocks && !line.linkTarget) return null;

		// Untimed lines are kept: an item that can't be planned at a specific time is
		// an all-day item, and the views render null-start events in the all-day lane.
		const start = line.startMinutes;
		const end = line.endMinutes ?? (start != null ? start + duration : null);
		// Verbatim, whether the line links to a note that exists, one that does not
		// yet, or nothing at all: what the user typed is what the timeline shows.
		const title = lineTitle(line.text);
		const body = this.bodyFor(plan, line);

		return {
			kind: 'local',
			...body,
			id: this.lineId(plan, line),
			filePath: resolved?.path,
			// A row like `- [ ] 07:00 - 08:00` has no text because its content is the
			// list underneath it. Calling that "(untitled)" would be noise; the block
			// shows its time and its tick count instead.
			title: title || (body.body ? '' : '(untitled)'),
			date: plan.date,
			startMinutes: start,
			endMinutes: end,
			checked: isChecked(line),
			linked: true,
			inDayPlan,
			placement: this.placementOf(plan, line),
		};
	}

	private buildUnlinkedEvent(entry: FileEntry, date: string, duration: number): LocalEvent {
		const start = entry.startMinutes;
		const end = start != null ? start + duration : null;
		return {
			kind: 'local',
			id: entry.path,
			filePath: entry.path,
			// No line to read it from: the note's own name, exactly as it is.
			title: entry.basename,
			date,
			startMinutes: start,
			endMinutes: end,
			endDate: entry.endDate,
			checked: false,
			linked: false,
			// Scheduling one writes a day-plan line, so it may then be kept in sync.
			inDayPlan: true,
		};
	}
}

/**
 * What reconcile reads out of a day plan: which file each planner line links and
 * what time it carries. Anything else about a line — its status, its text, its
 * indent — is none of the renamer's business.
 */
function reconcileKey(plan: DayPlan | undefined): string {
	if (!plan) return '';
	return plan.lines.map((l) => `${l.linkTarget}|${l.startMinutes}|${l.endMinutes}`).join('\n');
}
