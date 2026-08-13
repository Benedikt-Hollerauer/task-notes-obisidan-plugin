import { App, Plugin, TFile, Notice, normalizePath } from 'obsidian';
import type { LineTarget, LocalEvent } from '../types';
import type { TaskNotesSettings } from '../settings/settings';
import type { DailyNoteService } from './daily-note-service';
import type { EventIndex } from './event-index';
import { decideReconcile, laneDropVerdict, renameableLines , type ResolvedPlannerLine } from '../core/sync-decisions';
import {
	isScheduledBasename,
	parseEventBasename,
	expectedEventBasename,
	hasScheduledDatePart,
	renameTimeIntent,
} from '../core/event-filename';
import { activePrefixOf } from '../core/emoji';
import {
	parsePlannerLine,
	parseListLine,
	serializePlannerLine,
	setCheckboxStatus,
	buildLinkLine,
} from '../core/planner-line';
import {
	insertTimedLine,
	insertTimedBlockResult,
	type InsertResult,
	removeLines,
	replaceLine,
	getPlannerSection,
} from '../core/planner-section';
import { buildLineTree } from '../core/line-tree';
import { findPlacementLine, findBodyLine } from '../core/placement';
import { allowRename, createRenameLog, type RenameLog } from '../core/rename-guard';
import { resolveSlot } from '../core/event-slot';
import { addDays, diffDays } from '../core/date-key';
import { createSerialQueue } from '../core/serial-queue';
import { notifyError , structuredNotice } from '../lib/obsidian-utils';
import { confirm } from '../ui/modals/simple-modals';

const SUPPRESS_MS = 3000;

/**
 * Keeps the daily-note planner line and the 📅 filename in sync. The daily note is
 * authoritative: reconcile() renames files to match their lines (idempotent
 * fixpoint), applyBlockEdit() writes line changes from the timeline, and a manual
 * 📅 rename updates the line's time to match the filename (the one inverse case).
 * All writes are serialized on a single promise chain to avoid interleaving.
 */
export class SyncEngine {
	private suppressed = new Set<string>();
	/** Serialize an async unit of work on the write chain. */
	private enqueue = createSerialQueue();
	private renameLog: RenameLog = createRenameLog();
	private loopWarned = new Set<string>();
	/** Files we have already explained the duplicate-claim skip for. */
	private duplicateWarned = new Set<string>();
	/** Multi-file rename prompts the user said no to, so we stop re-asking. */
	private declinedReconciles = new Set<string>();
	private disposed = false;
	/** TFile → stable id, so the breaker can count one FILE across its names. */
	private fileKeys = new WeakMap<TFile, string>();
	private nextFileKey = 0;

	constructor(
		private app: App,
		private index: EventIndex,
		private dailyNotes: DailyNoteService,
		private getSettings: () => TaskNotesSettings,
	) {}

	register(plugin: Plugin): void {
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) this.onFileRename(file, oldPath);
			}),
		);
	}

	/**
	 * Stop the automatic half. A gesture the user already made is allowed to
	 * finish; work the plugin invented for itself is not.
	 */
	dispose(): void {
		this.disposed = true;
	}

	/** Reconcile filenames to their planner lines for one daily note. */
	reconcile(dailyPath: string): Promise<void> {
		if (this.disposed) return Promise.resolve();
		return this.enqueue(() => this.reconcileNow(dailyPath));
	}

	/**
	 * What reconciling this day WOULD do, read fresh from the index.
	 *
	 * Separated out because the multi-file confirmation below has to ask this
	 * twice — once to populate the dialog, and again after the answer, since the
	 * note is fully editable while the dialog sits open.
	 */
	private async planReconcile(dailyPath: string): Promise<{
		decisions: ReturnType<typeof decideReconcile>;
		fileByLine: Map<number, TFile>;
		resolvedLines: ResolvedPlannerLine[];
		date: string;
	} | null> {
		await this.index.flushNow();
		const plan = this.index.getPlan(dailyPath);
		if (!plan) return null;

		const resolvedLines: ResolvedPlannerLine[] = [];
		const fileByLine = new Map<number, TFile>();
		// Only lines the timeline draws as their own block may rename a file.
		for (const line of renameableLines(plan)) {
			const file = line.linkTarget
				? this.app.metadataCache.getFirstLinkpathDest(line.linkTarget, dailyPath)
				: null;
			resolvedLines.push({
				lineNo: line.lineNo,
				startMinutes: line.startMinutes,
				targetBasename: file ? file.basename : null,
				// Counted across ALL daily notes, not just this one: two notes linking
				// the same file would otherwise each rename it to their own fixpoint,
				// forever.
				duplicate: file ? this.index.claimCountFor(file.path) > 1 : false,
			});
			if (file) fileByLine.set(line.lineNo, file);
		}

		return {
			decisions: decideReconcile(plan.date, resolvedLines, this.getSettings().scheduledTaskFormat),
			fileByLine,
			resolvedLines,
			date: plan.date,
		};
	}

	/** A decision set's identity, so a declined prompt is not re-asked verbatim. */
	private reconcileSignature(
		decisions: ReturnType<typeof decideReconcile>,
		fileByLine: Map<number, TFile>,
	): string {
		return decisions
			.map((d) => `${fileByLine.get(d.lineNo)?.path ?? '?'}→${d.toBasename}`)
			.sort()
			.join('\n');
	}

	private async reconcileNow(dailyPath: string): Promise<void> {
		if (this.disposed || !this.getSettings().syncFilenameOnReschedule) return;

		const planned = await this.planReconcile(dailyPath);
		if (!planned) return;
		let { decisions, fileByLine } = planned;

		// SAY WHY NOTHING HAPPENED. A file claimed by several daily notes is skipped
		// on purpose — no one filename can satisfy five days at once — but the skip
		// was silent, so dragging such a note to a time wrote the time onto the
		// LINE and left the filename alone with no explanation. That is exactly
		// what a note living in your daily TEMPLATE looks like: every day links it.
		// Once per file per session, like the rename breaker.
		this.warnAboutBlockedDuplicates(planned.resolvedLines, fileByLine, planned.date);

		// ONE rename stays automatic and silent: you dragged a block, its note
		// follows. SEVERAL from a single edit is a different event — it means this
		// note links files whose names drifted long ago, and renaming a file
		// rewrites every wikilink to it across the vault. In a years-old vault the
		// first edit to an old daily note could rename dozens of files at once,
		// with nothing shown. That now asks first.
		if (decisions.length > 1) {
			const signature = `${dailyPath}\0${this.reconcileSignature(decisions, fileByLine)}`;
			// A "no" means no. Without this, every further edit to the day re-raised
			// the identical dialog, so declining a 12-file rename cost twelve more
			// dialogs. A genuinely different set still asks.
			if (this.declinedReconciles.has(signature)) return;

			const names = decisions
				.map((d) => fileByLine.get(d.lineNo)?.basename)
				.filter((n): n is string => !!n);
			const ok = await confirm(this.app, {
				title: `Rename ${names.length} notes to match this day plan?`,
				body:
					`Editing "${dailyPath}" made ${names.length} linked notes disagree with their ` +
					`planner lines. Renaming them also rewrites every link to them across your vault.\n\n` +
					names.map((n) => `• ${n}`).join('\n'),
				cta: `Rename ${names.length} notes`,
			});
			if (!ok) {
				this.declinedReconciles.add(signature);
				return;
			}

			// THE NOTE WAS EDITABLE THE WHOLE TIME THAT DIALOG WAS OPEN. `decisions`
			// was computed before it; applying it now would rename files to the names
			// a plan that no longer exists asked for. Re-derive, and keep only the
			// renames the user actually saw — a decision that appeared while they
			// were reading was never consented to.
			if (this.disposed) return;
			const fresh = await this.planReconcile(dailyPath);
			if (!fresh) return;
			const consented = new Set(
				decisions.map((d) => `${fileByLine.get(d.lineNo)?.path ?? '?'}→${d.toBasename}`),
			);
			fileByLine = fresh.fileByLine;
			decisions = fresh.decisions.filter((d) =>
				consented.has(`${fresh.fileByLine.get(d.lineNo)?.path ?? '?'}→${d.toBasename}`),
			);
		}

		for (const d of decisions) {
			// Re-checked every iteration, not just before the loop: a rename awaits,
			// and the plugin can be disabled or updated mid-sequence. `EventIndex`
			// guards this same case.
			if (this.disposed) return;
			const file = fileByLine.get(d.lineNo);
			if (file) await this.renameSuppressed(file, d.toBasename);
		}
	}

	/**
	 * Tell the user when a rename was withheld because several days claim the file.
	 *
	 * `decideReconcile` drops these before deciding anything, so the only evidence
	 * was the block's orange "duplicate" bar — which says THAT something is wrong,
	 * not that it is why the name did not follow the line you just moved.
	 */
	private warnAboutBlockedDuplicates(
		lines: ResolvedPlannerLine[],
		fileByLine: Map<number, TFile>,
		dailyDate: string,
	): void {
		const format = this.getSettings().scheduledTaskFormat;
		for (const line of lines) {
			if (!line.duplicate || !line.targetBasename) continue;
			if (!isScheduledBasename(line.targetBasename)) continue;
			if (!hasScheduledDatePart(line.targetBasename, format)) continue;
			// Only when the name WOULD have changed — a file already matching its
			// line is not being withheld from anything.
			const expected = expectedEventBasename(
				parseEventBasename(line.targetBasename, format),
				dailyDate,
				line.startMinutes,
				format,
				activePrefixOf(line.targetBasename),
			);
			if (expected === line.targetBasename) continue;

			const file = fileByLine.get(line.lineNo);
			const key = file ? this.renameKeyFor(file) : line.targetBasename;
			if (this.duplicateWarned.has(key)) continue;
			this.duplicateWarned.add(key);
			structuredNotice(
				'Time saved to the day plan, but the note was not renamed',
				`${line.targetBasename} — several days link this note, so no one filename fits them all.`,
				{ warn: true },
			);
		}
	}

	private async renameSuppressed(file: TFile, newBasename: string): Promise<void> {
		const parent = file.parent && file.parent.path ? `${file.parent.path}/` : '';
		const newPath = normalizePath(`${parent}${newBasename}.md`);
		if (file.path === newPath) return;

		// Renames are the only automatic write this plugin makes. If one FILE keeps
		// renaming, stop rather than churn the user's vault. Keyed on the file's
		// identity (stable across renames), not its path (which changes each time).
		const identity = this.renameKeyFor(file);
		if (!allowRename(this.renameLog, identity, Date.now())) {
			if (!this.loopWarned.has(identity)) {
				this.loopWarned.add(identity);
				new Notice(
					`Stopped repeatedly renaming "${file.basename}". ` +
						'It is probably linked from more than one daily note.',
				);
			}
			return;
		}

		this.suppressed.add(newPath);
		window.setTimeout(() => this.suppressed.delete(newPath), SUPPRESS_MS);
		try {
			await this.app.fileManager.renameFile(file, newPath);
		} catch (e) {
			this.suppressed.delete(newPath);
			notifyError('Failed to sync event filename', e);
		}
	}

	/** Apply a drag/resize/move from the timeline. Null times = an all-day item. */
	applyBlockEdit(
		event: LocalEvent,
		newDate: string,
		newStart: number | null,
		newEnd: number | null,
	): Promise<void> {
		return this.enqueue(() => this.applyBlockEditNow(event, newDate, newStart, newEnd));
	}

	private async applyBlockEditNow(
		event: LocalEvent,
		newDate: string,
		newStart: number | null,
		newEnd: number | null,
	): Promise<void> {
		// Make sure the placement we're about to edit reflects the file on disk,
		// shrinking the window where a stale index could target the wrong line.
		await this.index.flushNow();

		// "Make this all-day" — legitimate only for a line the day plan owns. The
		// reasoning, and the two silent-write bugs it closes, live with the rule in
		// core/sync-decisions.ts.
		if (newStart == null) {
			const verdict = laneDropVerdict({
				linked: event.linked,
				hasPlacement: !!event.placement,
				inDayPlan: event.inDayPlan,
			});
			if (verdict === 'not-in-plan') {
				new Notice(
					'That note is not in a day plan yet — use its ➕ to add it with a time you choose.',
				);
				return;
			}
			if (verdict === 'outside-section') {
				new Notice(
					'That line lives outside the planner section, where a time is what makes it a block — it was left unchanged.',
				);
				return;
			}
		}

		// Did the PLAN actually change? Both write paths can refuse — the line moved
		// under us, or the target day already has that exact line — and both say so
		// with a Notice. Their answer used to be discarded, so a refused move went
		// straight on to rename the file anyway: the user was told "nothing was
		// moved" and the note was renamed (and every wikilink to it rewritten) in
		// the same breath. The rename now follows the write, or does not happen.
		let planWritten = false;
		if (event.linked && event.placement) {
			const oldPath = event.placement.dailyNotePath;
			planWritten =
				newDate === event.placement.date
					? await this.editLineInPlace(oldPath, event, newStart, newEnd)
					: await this.moveLineAcrossDays(event, newDate, newStart, newEnd);
		} else if (event.filePath) {
			const slot = resolveSlot({ startMinutes: newStart, endMinutes: newEnd }, this.getSettings());
			await this.linkFileIntoDay(event.filePath, newDate, slot.start, slot.end);
			planWritten = true;
		}

		// A line outside the planner section never renames a file, however it moves:
		// only the day plan is authoritative for a 📅 note's name.
		if (planWritten && event.filePath && event.inDayPlan !== false && this.getSettings().syncFilenameOnReschedule) {
			await this.shiftMultiDaySpan(event, newDate, newStart);
			const targetDaily = this.dailyNotes.pathFor(newDate);
			await this.reconcileNow(targetDaily);
		}
	}

	/**
	 * Moving a multi-day event to another date must move its END date by the same
	 * delta — reconcile only fixes the start, which would otherwise leave the span
	 * pointing backwards (and make the event invisible in every view).
	 */
	private async shiftMultiDaySpan(
		event: LocalEvent,
		newDate: string,
		newStart: number | null,
	): Promise<void> {
		if (!event.filePath || !event.endDate || event.endDate === event.date) return;
		const delta = diffDays(newDate, event.date);
		if (delta === 0) return;

		const file = this.app.vault.getFileByPath(event.filePath);
		if (!file || !isScheduledBasename(file.basename)) return;
		// Same rule as reconcile: never impose the grammar on a freely-named note.
		if (!hasScheduledDatePart(file.basename, this.getSettings().scheduledTaskFormat)) return;

		const props = parseEventBasename(file.basename, this.getSettings().scheduledTaskFormat);
		if (!props.endDate) return;
		const shifted = { ...props, endDate: addDays(props.endDate, delta) };
		// Use the NEW start so this single rename is already the fixpoint the
		// following reconcile would compute (no second rename).
		const expected = expectedEventBasename(
			shifted,
			newDate,
			newStart ?? event.startMinutes,
			this.getSettings().scheduledTaskFormat,
			activePrefixOf(file.basename),
		);
		await this.renameSuppressed(file, expected);
	}

	/** True when the line was found and rewritten. */
	private async editLineInPlace(
		dailyPath: string,
		event: LocalEvent,
		newStart: number | null,
		newEnd: number | null,
	): Promise<boolean> {
		const file = this.app.vault.getFileByPath(dailyPath);
		if (!file) return false;
		let located = true;
		await this.app.vault.process(file, (content) => {
			const idx = this.findLine(content, event);
			if (idx < 0) {
				located = false;
				return content;
			}
			// parseListLine, not parsePlannerLine: a timed bullet outside the planner
			// section is draggable too, and must not grow a checkbox from being moved.
			const parsed = parseListLine(content.split('\n')[idx], idx);
			if (!parsed) {
				located = false;
				return content;
			}
			const newLine = serializePlannerLine({ ...parsed, startMinutes: newStart, endMinutes: newEnd });
			return replaceLine(content, idx, newLine);
		});
		if (!located) new Notice('The planner line changed — edit not applied.');
		return located;
	}

	/** True when the block actually moved. */
	private async moveLineAcrossDays(
		event: LocalEvent,
		newDate: string,
		newStart: number | null,
		newEnd: number | null,
	): Promise<boolean> {
		const oldPath = event.placement!.dailyNotePath;
		const oldFile = this.app.vault.getFileByPath(oldPath);
		if (!oldFile) {
			new Notice('The source daily note is gone — move not applied.');
			return false;
		}

		// Create the destination BEFORE removing the source line: if this throws
		// (missing folder, bad format, disk error) nothing has been destroyed yet.
		const target = await this.dailyNotes.getOrCreateBare(newDate);

		// Read the source line WITHOUT modifying anything yet.
		const sourceContent = await this.app.vault.read(oldFile);
		const idx = this.findLine(sourceContent, event);
		const parsed = idx >= 0 ? parseListLine(sourceContent.split('\n')[idx], idx) : null;
		if (!parsed) {
			// The line changed under us. Abort rather than synthesise a replacement:
			// the old fallback wrapped plain text in [[…]] (a dangling link) and could
			// leave the original line in place, creating a second claim on the file.
			new Notice('The planner line changed — move not applied.');
			return false;
		}

		// Everything but the time is carried over verbatim — including the indent
		// (a nested bullet used to be flattened) and whether it had a checkbox.
		const movedLine = serializePlannerLine({ ...parsed, startMinutes: newStart, endMinutes: newEnd });

		// A block owns the lines indented under it. Moving the row without them
		// would strip a morning routine off its hour and leave it behind.
		const sourceLines = sourceContent.split('\n');
		const sourceTree = buildLineTree(sourceContent);
		const node = sourceTree.nodes[sourceTree.byLineNo.get(idx) ?? -1];
		const bodyEnd = node ? node.subtreeEndLine : idx + 1;
		const movedBlock = [movedLine, ...sourceLines.slice(idx + 1, bodyEnd)];

		const heading = this.getSettings().plannerHeading;
		// A line living under some other heading lands in the destination's planner
		// section — a structural change, so say so rather than move it silently.
		const source = getPlannerSection(sourceContent, heading);
		const wasInSection = source.found && idx >= source.start && idx < source.end;
		if (!wasInSection) {
			new Notice(`Moved that line into "${heading}" of ${newDate}.`);
		}
		if (movedBlock.length > 1) {
			const n = movedBlock.length - 1;
			new Notice(`Moved that block and its ${n} sub-item${n === 1 ? '' : 's'} to ${newDate}.`);
		}

		// INSERT FIRST, remove second. insertTimedBlockResult refuses to duplicate an identical
		// line, so the worst case if the second write fails is the line existing in
		// both notes — visible and fixable. The other order loses it entirely.
		const sorted = this.getSettings().sortPlannerLinesOnInsert;
		// A destination that already holds this exact line refuses the insert. The
		// removal below MUST NOT run in that case: the line there is a different
		// item whose body is not the one being moved, so removing the source would
		// destroy this block and every sub-item under it.
		let outcome: InsertResult = { text: '', inserted: false };
		await this.app.vault.process(target, (content) => {
			outcome = insertTimedBlockResult(content, heading, movedBlock, newStart, {
				sorted,
				startMinutes: newStart,
			});
			return outcome.text;
		});
		if (!outcome.inserted) {
			new Notice(`${newDate} already has that exact line — nothing was moved.`);
			return false;
		}

		await this.app.vault.process(oldFile, (content) => {
			// Re-locate inside process(): the file may have changed since the read.
			// The subtree is recomputed from the CURRENT content, so an edit between
			// the read and here can never make this delete somebody else's lines.
			const i = this.findLine(content, event);
			if (i < 0) return content;
			const tree = buildLineTree(content);
			const current = tree.nodes[tree.byLineNo.get(i) ?? -1];
			return removeLines(content, i, current ? current.subtreeEndLine : i + 1);
		});
		return true;
	}

	/**
	 * Tick or untick exactly one line of a daily note.
	 *
	 * `next` is the state to WRITE, passed explicitly so a stale view can never
	 * turn a tick into an untick. `parent` scopes a body row to its own block,
	 * because identical child lines under different hours are entirely normal.
	 */
	setLineChecked(target: LineTarget, next: boolean, parent?: LineTarget): Promise<void> {
		return this.enqueue(() => this.setLineCheckedNow(target, next, parent));
	}

	private async setLineCheckedNow(target: LineTarget, next: boolean, parent?: LineTarget): Promise<void> {
		await this.index.flushNow();
		const file = this.app.vault.getFileByPath(target.dailyNotePath);
		if (!file) {
			new Notice('That daily note is gone — nothing was changed.');
			return;
		}

		// Two flags rather than a union, matching editLineInPlace: a `let` assigned
		// only inside the process() callback stays narrowed to its initial value.
		let located = true;
		let hadCheckbox = true;
		await this.app.vault.process(file, (content) => {
			const idx = parent ? findBodyLine(content, parent, target) : findPlacementLine(content, target);
			const raw = idx >= 0 ? content.split('\n')[idx] : null;
			const parsed = raw != null ? parseListLine(raw, idx) : null;
			if (!parsed || raw == null) {
				located = false;
				return content;
			}
			if (!parsed.hasCheckbox) {
				hadCheckbox = false;
				return content;
			}
			const status = next ? 'x' : ' ';
			if (parsed.status === status) return content;
			return replaceLine(content, idx, setCheckboxStatus(raw, status));
		});

		if (!located) new Notice('That line changed — the checkbox was not toggled.');
		else if (!hadCheckbox) new Notice('That line has no checkbox.');
		// Deliberately no reconcile: a checkbox carries no date and no time, so it
		// can never make a filename untrue.
	}

	/** Link an unlinked 📅 file into a day plan (creating a bare note if needed). */
	async linkFileIntoDay(filePath: string, dateKey: string, start: number, end: number): Promise<void> {
		const basename = this.basenameOf(filePath);
		const line = buildLinkLine(basename, start, end);
		const target = await this.dailyNotes.getOrCreateBare(dateKey);
		const heading = this.getSettings().plannerHeading;
		const sorted = this.getSettings().sortPlannerLinesOnInsert;
		await this.app.vault.process(target, (content) =>
			insertTimedLine(content, heading, line, start, { sorted, startMinutes: start }),
		);
	}

	/** Public entry for the "link into day plan" action. */
	/**
	 * Put an unlinked 📅 note into a day's plan at an explicit time.
	 *
	 * `start`/`end` are passed in rather than resolved here: the caller has just
	 * shown them to the user and had them confirmed. This used to call
	 * `resolveSlot` itself, which invented `dayStartHour` for a note whose name
	 * carried no time — and the reconcile below then wrote that invented time into
	 * the filename, renaming the note and every wikilink to it, with no prompt.
	 */
	linkUnlinkedEvent(event: LocalEvent, start: number, end: number): Promise<void> {
		return this.enqueue(async () => {
			if (!event.filePath || event.date == null) return;
			await this.linkFileIntoDay(event.filePath, event.date, start, end);
			await this.reconcileNow(this.dailyNotes.pathFor(event.date));
		});
	}

	private onFileRename(file: TFile, oldPath: string): void {
		if (this.suppressed.has(file.path)) {
			this.suppressed.delete(file.path);
			return;
		}
		if (!isScheduledBasename(file.basename)) return;
		// The OLD name matters: it is the only way to tell "this note never had a
		// time" from "the user just deleted its time", and those want opposite
		// answers. See updateLineFromFilename.
		const oldBasename = oldPath.split('/').pop()?.replace(/\.md$/, '') ?? '';
		void this.enqueue(() => this.updateLineFromFilename(file, oldBasename));
	}

	private async updateLineFromFilename(file: TFile, oldBasename = ''): Promise<void> {
		// The FOURTH automatic write, and until now the only one with no switch —
		// while the settings pane stated in so many words that every automatic
		// behaviour is switchable. It is the mirror of `reconcileNow` (line → name),
		// so it belongs to the same setting.
		if (!this.getSettings().syncFilenameOnReschedule) return;
		await this.index.flushNow();
		const format = this.getSettings().scheduledTaskFormat;
		// What the rename MEANS for the line — set a time, clear it, or nothing.
		// The rule is pure and tested; see core/event-filename.ts.
		const intent = renameTimeIntent(oldBasename, file.basename, format);
		if (intent.action === 'none') return;
		const timeRemoved = intent.action === 'clear';
		const fileStart = intent.action === 'set' ? intent.minutes : null;
		// Use the one grammar parser, not a second hardcoded date regex.
		const fileDate = parseEventBasename(file.basename, format).startDate;
		if (!fileDate) return;

		// Only the same-day placement is authoritative for the time; scan all plans so a
		// file linked from several days still mirrors onto the correct-day line.
		for (const plan of this.index.allPlans()) {
			if (plan.date !== fileDate) continue;
			for (const line of plan.lines) {
				const target = line.linkTarget
					? this.app.metadataCache.getFirstLinkpathDest(line.linkTarget, plan.path)
					: null;
				if (target?.path !== file.path) continue;
				if (line.startMinutes === fileStart) return;
				// An UNTIMED line is deliberate — usually a block dragged into the
				// all-day lane — and the line is the authority for the plan, exactly
				// as the index now treats it. Pushing the filename's time back onto
				// it here was the one path that still undid a lane drop: the next
				// rename of that note (a properties Apply, a status change) snapped
				// the block straight back into the grid.
				// (`timeRemoved` is the other direction and already handled above:
				// there the line HAS a time and the filename just lost one.)
				if (line.startMinutes == null) return;

				const dailyFile = this.app.vault.getFileByPath(plan.path);
				if (!dailyFile) return;
				const delta = line.startMinutes != null && line.endMinutes != null ? line.endMinutes - line.startMinutes : null;
				await this.app.vault.process(dailyFile, (content) => {
							// Re-locate by text like every other write: a stale lineNo can point
					// at a different line that links the same file.
					const idx = findPlacementLine(content, { lineNo: line.lineNo, raw: line.raw });
					if (idx < 0) return content;
					const parsed = parsePlannerLine(content.split('\n')[idx], idx);
					if (!parsed || parsed.linkTarget !== line.linkTarget) return content;
					// `timeRemoved` clears the line instead of retiming it, which is
					// what makes the block all-day — the same end state as dragging it
					// into the lane, reached by editing the name.
					const newStart = timeRemoved ? null : fileStart;
					const newEnd =
						newStart == null ? null : delta != null ? newStart + delta : parsed.endMinutes;
					const newLine = serializePlannerLine({
						indent: parsed.indent,
						marker: parsed.marker,
						status: parsed.status,
						startMinutes: newStart,
						endMinutes: newEnd,
						text: parsed.text,
					});
					return replaceLine(content, idx, newLine);
				});
				return;
			}
		}
	}

	/**
	 * Locate the exact line index for an event by its captured raw text. Returns -1 when
	 * the raw line can't be found — callers must NOT fall back to a stale line index,
	 * which could edit or delete unrelated content.
	 */

	private findLine(content: string, event: LocalEvent): number {
		if (!event.placement) return -1;
		return findPlacementLine(content, event.placement);
	}

	/** Identity that survives a rename: Obsidian keeps the TFile instance. */
	private renameKeyFor(file: TFile): string {
		let key = this.fileKeys.get(file);
		if (!key) {
			key = `f${this.nextFileKey++}`;
			this.fileKeys.set(file, key);
		}
		return key;
	}

	private basenameOf(path: string): string {
		const file = this.app.vault.getFileByPath(path);
		if (file) return file.basename;
		const name = path.split('/').pop() ?? path;
		return name.replace(/\.md$/, '');
	}
}

