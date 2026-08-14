// THE BACKWARD-COMPATIBILITY PROOF.
//
// Every real filename in test-vault/ is parsed and regenerated here with its
// values written out inline, so any change to the grammar shows up as a visible
// diff in this file rather than as a silent rename in someone's vault.
//
// If a change makes this fail, the change breaks existing filenames. Fix the
// change, not the expectations — unless the new value is deliberate AND the
// filename it affects would only ever be rewritten by an explicit user action.
//
// This reads the LIVE test-vault, so playing with the plugin in there (dragging a
// block, converting a note) will redden it. That is the point: update the snapshot
// deliberately, having checked the rename was one you asked for.

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseTaskProperties, generateTaskName } from '../src/core/task-name';
import { extractTaskEmoji, extractTaskName, getNormalizedEmoji, normalizeEmoji } from '../src/core/emoji';
import { formatKeyFor } from '../src/constants';
import { DEFAULT_SETTINGS } from '../src/settings/settings';
import type { TaskProperties } from '../src/types';

const VAULT = fileURLToPath(new URL('../test-vault', import.meta.url));

/** The format the plugin really uses for an emoji, on a fresh install. */
const formatFor = (emoji: string | null): string => DEFAULT_SETTINGS[formatKeyFor(emoji ?? '')];

interface CorpusRow {
	basename: string;
	emoji: string | null;
	name: string;
	props: TaskProperties;
	/** What generateTaskName produces from those props (without the emoji). */
	regenerated: string;
	/**
	 * True when this name is expected to parse DIFFERENTLY under its format than
	 * under the frozen legacy grammar. Only the fixtures that demonstrate the new
	 * fields may set this — every pre-existing filename must parse identically.
	 */
	usesNewFields?: boolean;
}

/** Snapshot of the CURRENT behaviour for every file in the test vault. */
const CORPUS: CorpusRow[] = [
	{
		// Created by hand in the vault while testing the convert action.
		basename: '◻️ Test - test - test',
		emoji: '◻️',
		name: 'Test - test - test',
		props: { actionWords: 'Test', amount: 'test', amountOutcome: 'test' },
		regenerated: 'Test - test - test',
	},
	{
		basename: '◻ undefinedsadfdfsadfs - safddfsa - sdaffd',
		emoji: '◻️',
		name: 'undefinedsadfdfsadfs - safddfsa - sdaffd',
		props: { actionWords: 'undefinedsadfdfsadfs', amount: 'safddfsa', amountOutcome: 'sdaffd' },
		// Capitalised: generate uppercases the action for non-event formats.
		regenerated: 'Undefinedsadfdfsadfs - safddfsa - sdaffd',
	},
	{
		basename: '✅ By 2026 - 01 - 13, moin - 2026 - 01-14, buy - 2 - thing',
		emoji: '✅',
		name: 'By 2026 - 01 - 13, moin - 2026 - 01-14, buy - 2 - thing',
		// Malformed legacy name: the leading "By 2026" is NOT a date, so it parses
		// as an ordinary 3-part task with a greedy tail.
		props: {
			actionWords: 'By 2026',
			amount: '01',
			amountOutcome: '13, moin - 2026 - 01-14, buy - 2 - thing',
		},
		regenerated: 'By 2026 - 01 - 13, moin - 2026 - 01-14, buy - 2 - thing',
	},
	{
		basename: '✅ By 2026-01-15, fsdgfdgsfdgs - fsdgfdgsfdg - fsdgfdgsfsdg',
		emoji: '✅',
		name: 'By 2026-01-15, fsdgfdgsfdgs - fsdgfdgsfdg - fsdgfdgsfsdg',
		props: {
			actionWords: 'By 2026',
			amount: '01',
			amountOutcome: '15, fsdgfdgsfdgs - fsdgfdgsfdg - fsdgfdgsfsdg',
		},
		regenerated: 'By 2026 - 01 - 15, fsdgfdgsfdgs - fsdgfdgsfdg - fsdgfdgsfsdg',
	},
	{
		basename: '✅ By 2026dssafdsfdsa - 02 - 05, By 2026dsafdsadfs - 01 - 22, dfaffds - 01 - ddd',
		emoji: '✅',
		name: 'By 2026dssafdsfdsa - 02 - 05, By 2026dsafdsadfs - 01 - 22, dfaffds - 01 - ddd',
		props: {
			actionWords: 'By 2026dssafdsfdsa',
			amount: '02',
			amountOutcome: '05, By 2026dsafdsadfs - 01 - 22, dfaffds - 01 - ddd',
		},
		regenerated: 'By 2026dssafdsfdsa - 02 - 05, By 2026dsafdsadfs - 01 - 22, dfaffds - 01 - ddd',
	},
	{
		basename: '✅ Finish project report - fd - sfadsdf',
		emoji: '✅',
		name: 'Finish project report - fd - sfadsdf',
		props: { actionWords: 'Finish project report', amount: 'fd', amountOutcome: 'sfadsdf' },
		regenerated: 'Finish project report - fd - sfadsdf',
	},
	{
		basename: '❌ By 2026-01-28, d - j - 1dcdddfdsffdsfasd',
		emoji: '❌',
		name: 'By 2026-01-28, d - j - 1dcdddfdsffdsfasd',
		props: { actionWords: 'By 2026', amount: '01', amountOutcome: '28, d - j - 1dcdddfdsffdsfasd' },
		regenerated: 'By 2026 - 01 - 28, d - j - 1dcdddfdsffdsfasd',
	},
	{
		basename: '🅰️ 📅 By 2026-07-27 at 15.00h, focus - 1 - deepwork',
		emoji: '📅',
		name: 'By 2026-07-27 at 15.00h, focus - 1 - deepwork',
		props: {
			actionWords: 'focus',
			amount: '1',
			amountOutcome: 'deepwork',
			startDate: '2026-07-27',
			time: '15.00h',
		},
		regenerated: 'By 2026-07-27 at 15.00h, focus - 1 - deepwork',
	},
	{
		// Converted 📅 → 🔁 by hand, then edited through the properties panel (Amount
		// 01 → 02, and " - fda" appended to Outcome) and renamed by Apply. The NAME
		// still has its event shape, so this pins how the routine format reads a
		// name that was written for a different one — and, now, that a name the
		// panel itself wrote is a fixpoint: `regenerated` equals `name`, which the
		// pre-Apply version was not.
		basename: '🔁 By 2026 - 02 - 23 at 12.34h, fdfgdsdfsdgffgdfgd - dfa - dfsa - fda',
		emoji: '🔁',
		name: 'By 2026 - 02 - 23 at 12.34h, fdfgdsdfsdgffgdfgd - dfa - dfsa - fda',
		// Under the routine format the leading "By 2026" is no longer a date — it is
		// just the first dash-separated part of an ordinary name, and everything
		// after the second dash is the outcome. The format's fourth field ({cycle})
		// stays empty because the name has no fourth part to fill it.
		props: {
			actionWords: 'By 2026',
			amount: '02',
			amountOutcome: '23 at 12.34h, fdfgdsdfsdgffgdfgd - dfa - dfsa - fda',
		},
		regenerated: 'By 2026 - 02 - 23 at 12.34h, fdfgdsdfsdgffgdfgd - dfa - dfsa - fda',
	},
	{
		basename: '📅 By 2026-01-23 at 16.48h - 2026-01-24, $2 - dfs - asdf',
		emoji: '📅',
		name: 'By 2026-01-23 at 16.48h - 2026-01-24, $2 - dfs - asdf',
		// `$2` is a regex substitution pattern — it must survive verbatim.
		props: {
			actionWords: '$2',
			amount: 'dfs',
			amountOutcome: 'asdf',
			startDate: '2026-01-23',
			time: '16.48h',
			endDate: '2026-01-24',
		},
		regenerated: 'By 2026-01-23 at 16.48h - 2026-01-24, $2 - dfs - asdf',
	},
	{
		// Given an end date through the footer property bar, which is what the
		// range half of the grammar is for. Snapshot updated deliberately.
		basename: '📅 By 2026-08-21 at 16.00h - 2026-08-22, review - 1 - budget',
		emoji: '📅',
		name: 'By 2026-08-21 at 16.00h - 2026-08-22, review - 1 - budget',
		props: {
			actionWords: 'review',
			amount: '1',
			amountOutcome: 'budget',
			startDate: '2026-08-21',
			time: '16.00h',
			endDate: '2026-08-22',
		},
		regenerated: 'By 2026-08-21 at 16.00h - 2026-08-22, review - 1 - budget',
	},
	{
		basename: '◻️ Practise - 0s - of multitasking for cognitive activities 🤹',
		emoji: '◻️',
		name: 'Practise - 0s - of multitasking for cognitive activities 🤹',
		props: {
			actionWords: 'Practise',
			amount: '0s',
			amountOutcome: 'of multitasking for cognitive activities 🤹',
		},
		regenerated: 'Practise - 0s - of multitasking for cognitive activities 🤹',
	},
	{
		// The bescheid pair, re-dated by hand. Note the space around the hyphen in
		// "bescheid - Ausleser": earlier copies had none, which made the parser read
		// the action as just "bescheid" and the name a non-fixpoint. Spaced, they
		// round-trip exactly — the same grammar edge, on the right side of it.
		basename: '📅 By 2026-08-11 at 01.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfs',
		emoji: '📅',
		name: 'By 2026-08-11 at 01.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfs',
		props: {
			actionWords: 'bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: 'fds - dfs',
			startDate: '2026-08-11',
			time: '01.30h',
		},
		regenerated: 'By 2026-08-11 at 01.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfs',
	},
	{
		basename: '📅 By 2026-08-12 at 10.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - 1 - 1',
		emoji: '📅',
		name: 'By 2026-08-12 at 10.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - 1 - 1',
		props: {
			actionWords: 'bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: '1 - 1',
			startDate: '2026-08-12',
			time: '10.30h',
		},
		regenerated: 'By 2026-08-12 at 10.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - 1 - 1',
	},
	{
		// The note from the v4.2 report — created through the drag dialog, which
		// creates the note AND links it into that day's plan in one step. Deleting
		// `at 08.00h` from this name used to be undone within a second; it now
		// clears the planner line's time instead.
		basename: '📅 By 2026-09-03 at 08.00h, test - test - tset',
		emoji: '📅',
		name: 'By 2026-09-03 at 08.00h, test - test - tset',
		props: {
			actionWords: 'test',
			amount: 'test',
			amountOutcome: 'tset',
			startDate: '2026-09-03',
			time: '08.00h',
		},
		regenerated: 'By 2026-09-03 at 08.00h, test - test - tset',
	},
	{
		// Real notes, made through the drag dialog and the properties panel. The two
		// 📅 ones both carry `at HH.MMh` — which is what an all-day note gains when
		// it is dragged onto the grid, provided only one day links it.
		basename: '📅 By 2026-08-20 at 06.30h, anreise - Start MUC Pasing mit Auto - zrdz - zrdz',
		emoji: '📅',
		name: 'By 2026-08-20 at 06.30h, anreise - Start MUC Pasing mit Auto - zrdz - zrdz',
		props: {
			actionWords: 'anreise',
			amount: 'Start MUC Pasing mit Auto',
			amountOutcome: 'zrdz - zrdz',
			startDate: '2026-08-20',
			time: '06.30h',
		},
		regenerated: 'By 2026-08-20 at 06.30h, anreise - Start MUC Pasing mit Auto - zrdz - zrdz',
	},
	{
		basename: '📅 By 2026-08-20 at 10.30h, vemags Landesbeauftrage Hospitation - test - test',
		emoji: '📅',
		name: 'By 2026-08-20 at 10.30h, vemags Landesbeauftrage Hospitation - test - test',
		props: {
			actionWords: 'vemags Landesbeauftrage Hospitation',
			amount: 'test',
			amountOutcome: 'test',
			startDate: '2026-08-20',
			time: '10.30h',
		},
		regenerated: 'By 2026-08-20 at 10.30h, vemags Landesbeauftrage Hospitation - test - test',
	},
	{
		// The 🔁 Bescheid note above, switched to ◻️ and shortened — so the two rows
		// together show a type change preserving the name's field structure.
		basename: '◻️ Bescheid - Ausleser Anwendung + Tipps & Tricks - fds',
		emoji: '◻️',
		name: 'Bescheid - Ausleser Anwendung + Tipps & Tricks - fds',
		props: {
			actionWords: 'Bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: 'fds',
		},
		regenerated: 'Bescheid - Ausleser Anwendung + Tipps & Tricks - fds',
	},
	{
		// PROOF THE v3.14 FIX LANDED: both of these are 32 bytes on disk — exactly
		// this vault's template — because their type was changed in the properties
		// panel while they were empty, and adopting a type now adopts its template.
		basename: '📅 By 2026-08-12, practiseee - 0sd - of multitasking for cognitive activities 🤹',
		emoji: '📅',
		name: 'By 2026-08-12, practiseee - 0sd - of multitasking for cognitive activities 🤹',
		props: {
			actionWords: 'practiseee',
			amount: '0sd',
			amountOutcome: 'of multitasking for cognitive activities 🤹',
			startDate: '2026-08-12',
		},
		regenerated: 'By 2026-08-12, practiseee - 0sd - of multitasking for cognitive activities 🤹',
	},
	{
		// A routine with SIX hyphen-separated segments. Note there is no `cycle`
		// here even though the routine format declares {cycle}: the grammar fills
		// action and amount and gives everything else to the outcome, so a name
		// long enough to overflow the format degrades into three fields rather
		// than mis-assigning the tail. `🔁 Test - test - test - test` above, with
		// exactly four segments, DOES get a cycle — the two rows together pin
		// where that boundary sits.
		basename: '🔁 Bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfslkjhjkhkljlkjk - dfskljkljkl - kjkl',
		emoji: '🔁',
		name: 'Bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfslkjhjkhkljlkjk - dfskljkljkl - kjkl',
		props: {
			actionWords: 'Bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: 'fds - dfslkjhjkhkljlkjk - dfskljkljkl - kjkl',
		},
		regenerated:
			'Bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfslkjhjkhkljlkjk - dfskljkljkl - kjkl',
	},
	{
		// The note from the v3.14 report: created ◻️, switched to 📅 in the
		// properties panel with a date, and it stayed EMPTY because no in-place
		// type change had ever applied a template. It does now (into an empty note
		// only), so a note adopted this way arrives with its type's checklist.
		basename: '📅 By 2026-08-12, practisee - 0s - of multitasking for cognitive activities 🤹',
		emoji: '📅',
		name: 'By 2026-08-12, practisee - 0s - of multitasking for cognitive activities 🤹',
		props: {
			actionWords: 'practisee',
			amount: '0s',
			amountOutcome: 'of multitasking for cognitive activities 🤹',
			startDate: '2026-08-12',
		},
		regenerated: 'By 2026-08-12, practisee - 0s - of multitasking for cognitive activities 🤹',
	},
	{
		// A SECOND undated 📅, and a different route to it. This one was made by the
		// properties panel's Type row: `changeStatus` swaps the emoji and keeps the
		// rest of the name, so ◻️ → 📅 left a scheduled note with nothing
		// scheduled. Both routes are closed now — the panel stages for Apply
		// (v3.12), and changeStatus itself refuses a dated type without a date
		// (v3.13) — so this row is pure archaeology: evidence the guard is guarding
		// something real. Rename or delete the file whenever you like.
		//
		// Not a fixpoint either: regenerating lowercases the action, because a
		// dateless name falls to the non-event branch.
		basename: '📅 Practise - 0s - of multitasking for cognitive activities 🤹',
		emoji: '📅',
		name: 'Practise - 0s - of multitasking for cognitive activities 🤹',
		props: {
			actionWords: 'Practise',
			amount: '0s',
			amountOutcome: 'of multitasking for cognitive activities 🤹',
		},
		regenerated: 'practise - 0s - of multitasking for cognitive activities 🤹',
	},
	{
		// EVIDENCE OF A BUG, kept deliberately. A 📅 note with NO DATE in its name:
		// the scheduled format drops its whole "By …," clause when startDate is
		// empty, and `createTypedNoteBlock` used to generate the name from the raw
		// properties while falling back to the dragged day only for the planner
		// line — so the note was named undated and linked dated. Such a file is
		// invisible to `isScheduledBasename`, so the sync engine cannot repair it
		// either. The date is resolved once, before naming, as of v3.9.
		//
		// It is also not a fixpoint: regenerating lowercases the action, because a
		// dateless name takes the non-event branch. Renaming it is yours to do.
		basename: '📅 Rrwar - rwar - arw',
		emoji: '📅',
		name: 'Rrwar - rwar - arw',
		props: { actionWords: 'Rrwar', amount: 'rwar', amountOutcome: 'arw' },
		regenerated: 'rrwar - rwar - arw',
	},
	{
		// The two PLAIN notes the drag dialog's "Note" option creates: no emoji, no
		// grammar, just the title typed into the field. They are here to pin that
		// the parser still reads them as an action with empty amount/outcome, and
		// that regenerating capitalises — so if one were ever renamed by the
		// plugin, the diff would show it.
		basename: 'handle donnerstag meeting vemags david',
		emoji: null,
		name: 'handle donnerstag meeting vemags david',
		props: { actionWords: 'handle donnerstag meeting vemags david', amount: '', amountOutcome: '' },
		regenerated: 'Handle donnerstag meeting vemags david',
	},
	{
		basename: 'test',
		emoji: null,
		name: 'test',
		props: { actionWords: 'test', amount: '', amountOutcome: '' },
		regenerated: 'Test',
	},
	{
		basename: '📅 By 2026-08-10 at 12.30h, moinsen - moinsen - moinsen',
		emoji: '📅',
		name: 'By 2026-08-10 at 12.30h, moinsen - moinsen - moinsen',
		props: {
			actionWords: 'moinsen',
			amount: 'moinsen',
			amountOutcome: 'moinsen',
			startDate: '2026-08-10',
			time: '12.30h',
		},
		regenerated: 'By 2026-08-10 at 12.30h, moinsen - moinsen - moinsen',
	},
	{
		// Made by hand while testing the "conversion must not invent a time" fix —
		// 05.00h is a time that was actually typed, so it is kept, unlike the
		// 08.00h ones the old auto-link stamped on.
		basename: '📅 By 2026-08-15 at 05.00h, test - test - test',
		emoji: '📅',
		name: 'By 2026-08-15 at 05.00h, test - test - test',
		props: {
			actionWords: 'test',
			amount: 'test',
			amountOutcome: 'test',
			startDate: '2026-08-15',
			time: '05.00h',
		},
		regenerated: 'By 2026-08-15 at 05.00h, test - test - test',
	},
	{
		// Two notes hand-made in the vault on 2026-08-11, same shape as the row
		// above. The `tset` transposition is the author's own typing and stays —
		// this file records what the vault HAS, and "fixing" a name here would be
		// the plugin editing a filename nobody asked it to touch.
		basename: '📅 By 2026-09-03 at 01.00h, test - test - test',
		emoji: '📅',
		name: 'By 2026-09-03 at 01.00h, test - test - test',
		props: {
			actionWords: 'test',
			amount: 'test',
			amountOutcome: 'test',
			startDate: '2026-09-03',
			time: '01.00h',
		},
		regenerated: 'By 2026-09-03 at 01.00h, test - test - test',
	},
	{
		basename: '📅 By 2026-09-03 at 07.15h, test - test - tset',
		emoji: '📅',
		name: 'By 2026-09-03 at 07.15h, test - test - tset',
		props: {
			actionWords: 'test',
			amount: 'test',
			amountOutcome: 'tset',
			startDate: '2026-09-03',
			time: '07.15h',
		},
		regenerated: 'By 2026-09-03 at 07.15h, test - test - tset',
	},
	{
		// A 🔁 routine, whose format carries a FOURTH field, {cycle}. This is one of
		// the few names that parses differently under its own format than under the
		// frozen legacy grammar — the legacy parser has nowhere to put "test" #4 —
		// which is exactly what `usesNewFields` marks.
		basename: '🔁 Test - test - test - test',
		emoji: '🔁',
		name: 'Test - test - test - test',
		props: { actionWords: 'Test', amount: 'test', amountOutcome: 'test', cycle: 'test' },
		regenerated: 'Test - test - test - test',
		usesNewFields: true,
	},
	{
		// Clean fixpoints, both created through the new drag → "New time block"
		// dialog. Here so the everyday shape of a scheduled note stays pinned
		// alongside the awkward ones below it.
		basename: '📅 By 2026-08-10 at 16.00h, notes David - te - test',
		emoji: '📅',
		name: 'By 2026-08-10 at 16.00h, notes David - te - test',
		props: {
			actionWords: 'notes David',
			amount: 'te',
			amountOutcome: 'test',
			startDate: '2026-08-10',
			time: '16.00h',
		},
		regenerated: 'By 2026-08-10 at 16.00h, notes David - te - test',
	},
	{
		basename: '📅 By 2026-08-14 at 06.45h, test - t - tew',
		emoji: '📅',
		name: 'By 2026-08-14 at 06.45h, test - t - tew',
		props: {
			actionWords: 'test',
			amount: 't',
			amountOutcome: 'tew',
			startDate: '2026-08-14',
			time: '06.45h',
		},
		regenerated: 'By 2026-08-14 at 06.45h, test - t - tew',
	},
	{
		// Created twice from the same remote calendar event (different Amount and
		// Outcome each time). ALSO pins a sharp edge of the frozen grammar: a bare
		// hyphen inside a word ("bescheid-Ausleser") is a field separator, so the
		// action is just "bescheid" — and the regenerated form gains spaces around
		// that hyphen, meaning these names are NOT fixpoints of their own parse.
		basename: '📅 By 2026-08-11 at 10.30h, bescheid-Ausleser Anwendung + Tipps & Tricks - 1 - 1',
		emoji: '📅',
		name: 'By 2026-08-11 at 10.30h, bescheid-Ausleser Anwendung + Tipps & Tricks - 1 - 1',
		props: {
			actionWords: 'bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: '1 - 1',
			startDate: '2026-08-11',
			time: '10.30h',
		},
		regenerated: 'By 2026-08-11 at 10.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - 1 - 1',
	},
	{
		basename: '📅 By 2026-08-11 at 10.30h, bescheid-Ausleser Anwendung + Tipps & Tricks - fds - dfs',
		emoji: '📅',
		name: 'By 2026-08-11 at 10.30h, bescheid-Ausleser Anwendung + Tipps & Tricks - fds - dfs',
		props: {
			actionWords: 'bescheid',
			amount: 'Ausleser Anwendung + Tipps & Tricks',
			amountOutcome: 'fds - dfs',
			startDate: '2026-08-11',
			time: '10.30h',
		},
		regenerated: 'By 2026-08-11 at 10.30h, bescheid - Ausleser Anwendung + Tipps & Tricks - fds - dfs',
	},
	{
		// Re-dated 2026-07-24 → 2026-08-25 through the properties panel. It is still
		// linked from Daily/2026-07-24.md, which is the mismatch that exposed the
		// date-blind ghost suppression (see core/ghost-suppression.ts): the note
		// vanished from the day it names while its block sat on the day it was
		// planned into.
		basename: '📅 By 2026-08-25 at 10.00h, prepare - 1 - deck',
		emoji: '📅',
		name: 'By 2026-08-25 at 10.00h, prepare - 1 - deck',
		props: {
			actionWords: 'prepare',
			amount: '1',
			amountOutcome: 'deck',
			startDate: '2026-08-25',
			time: '10.00h',
		},
		regenerated: 'By 2026-08-25 at 10.00h, prepare - 1 - deck',
	},
	{
		basename: '📅 By 2026-07-24 at 14.00h, call - 1 - Acme',
		emoji: '📅',
		name: 'By 2026-07-24 at 14.00h, call - 1 - Acme',
		props: {
			actionWords: 'call',
			amount: '1',
			amountOutcome: 'Acme',
			startDate: '2026-07-24',
			time: '14.00h',
		},
		regenerated: 'By 2026-07-24 at 14.00h, call - 1 - Acme',
	},
	{
		basename: '📅 By 2026-07-24 at 18.00h, gym - 1 - session',
		emoji: '📅',
		name: 'By 2026-07-24 at 18.00h, gym - 1 - session',
		props: {
			actionWords: 'gym',
			amount: '1',
			amountOutcome: 'session',
			startDate: '2026-07-24',
			time: '18.00h',
		},
		regenerated: 'By 2026-07-24 at 18.00h, gym - 1 - session',
	},
	{
		// endDate EQUAL to startDate — eventSpan collapses it to a single day.
		basename: '📅 By 2026-07-26 at 11.15h - 2026-07-26, attend - 1 - conference',
		emoji: '📅',
		name: 'By 2026-07-26 at 11.15h - 2026-07-26, attend - 1 - conference',
		props: {
			actionWords: 'attend',
			amount: '1',
			amountOutcome: 'conference',
			startDate: '2026-07-26',
			time: '11.15h',
			endDate: '2026-07-26',
		},
		regenerated: 'By 2026-07-26 at 11.15h - 2026-07-26, attend - 1 - conference',
	},
	{
		// A real two-day span, and the file that exposed the all-day bug: it was
		// drawn as a chip with no time at all, however precisely it was scheduled.
		// Renamed 07.15h → 20.00h by dropping its chip onto the grid at 20:00,
		// which is the gesture that gives an untimed item a time — the planner line
		// reads `20:00 - 21:00`, so the filename following it is reconcile doing
		// exactly its job. Snapshot updated deliberately, per this file's header.
		basename: '📅 By 2026-07-28 at 20.00h - 2026-07-29, attend - 1 - conference',
		emoji: '📅',
		name: 'By 2026-07-28 at 20.00h - 2026-07-29, attend - 1 - conference',
		props: {
			actionWords: 'attend',
			amount: '1',
			amountOutcome: 'conference',
			startDate: '2026-07-28',
			time: '20.00h',
			endDate: '2026-07-29',
		},
		regenerated: 'By 2026-07-28 at 20.00h - 2026-07-29, attend - 1 - conference',
	},
	{
		// 🔁 routine: the trailing field is the cycle (a NEW field, so it parses
		// differently from the legacy grammar — by design).
		basename: '🔁 Consume - 0mg - of caffeine after 14.00h - per day ☕',
		emoji: '🔁',
		name: 'Consume - 0mg - of caffeine after 14.00h - per day ☕',
		props: {
			actionWords: 'Consume',
			amount: '0mg',
			amountOutcome: 'of caffeine after 14.00h',
			cycle: 'per day ☕',
		},
		regenerated: 'Consume - 0mg - of caffeine after 14.00h - per day ☕',
		usesNewFields: true,
	},
	{
		// Created by following one of the routine links in the daily template.
		// Only three dash-separated parts under a four-field routine format —
		// the shape a real routine name takes when it has no explicit cycle.
		basename: '🔁 Consume - 0ml - sodas (Monster, Coke, Fanta, ...) at home 🥤',
		emoji: '🔁',
		name: 'Consume - 0ml - sodas (Monster, Coke, Fanta, ...) at home 🥤',
		props: {
			actionWords: 'Consume',
			amount: '0ml',
			amountOutcome: 'sodas (Monster, Coke, Fanta, ...) at home 🥤',
		},
		regenerated: 'Consume - 0ml - sodas (Monster, Coke, Fanta, ...) at home 🥤',
	},
	{
		// 🎯 goal in the identity-first shape. On a FRESH install this parses with
		// {identity}; an existing vault keeps the legacy format (see the migration
		// test), which is why nothing renames on upgrade.
		basename:
			'🎯 Top engineer - Get hired at - 1 company - which is leading, prestigious (FAANG, ...) or well paid',
		emoji: '🎯',
		name: 'Top engineer - Get hired at - 1 company - which is leading, prestigious (FAANG, ...) or well paid',
		props: {
			actionWords: 'Get hired at',
			amount: '1 company',
			amountOutcome: 'which is leading, prestigious (FAANG, ...) or well paid',
			identity: 'Top engineer',
		},
		regenerated:
			'Top engineer - Get hired at - 1 company - which is leading, prestigious (FAANG, ...) or well paid',
		usesNewFields: true,
	},
	{
		// The text-mangling regression: "at" before a dash, and real parentheses.
		basename: '📅 By 2026-07-24 at 16.00h, meet at - 1 - Bob (at home)',
		emoji: '📅',
		name: 'By 2026-07-24 at 16.00h, meet at - 1 - Bob (at home)',
		props: {
			actionWords: 'meet at',
			amount: '1',
			amountOutcome: 'Bob (at home)',
			startDate: '2026-07-24',
			time: '16.00h',
		},
		regenerated: 'By 2026-07-24 at 16.00h, meet at - 1 - Bob (at home)',
	},
	{
		basename: '📅 By 2026-07-27 at 10.00h, plan - 1 - sprint',
		emoji: '📅',
		name: 'By 2026-07-27 at 10.00h, plan - 1 - sprint',
		props: {
			actionWords: 'plan',
			amount: '1',
			amountOutcome: 'sprint',
			startDate: '2026-07-27',
			time: '10.00h',
		},
		regenerated: 'By 2026-07-27 at 10.00h, plan - 1 - sprint',
	},
	{
		// A routine that DOES fill the fourth field: four dash-separated parts, so
		// {cycle} takes "First mon at 08.00h ✍️". This is one of the few fixtures
		// that parses differently under its format than under the frozen legacy
		// grammar — hence usesNewFields.
		basename: '🔁 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️',
		emoji: '🔁',
		name: 'Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️',
		props: {
			actionWords: 'Attend',
			amount: '1h',
			amountOutcome: 'monthly planning at Logisitsy',
			cycle: 'First mon at 08.00h ✍️',
		},
		regenerated: 'Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️',
		usesNewFields: true,
	},
	{
		// Three parts, so {cycle} stays empty and the trailing emoji rides along in
		// the outcome untouched.
		basename: '🔁 Reply to - 10 platforms - for all work related messages I received ⌨️',
		emoji: '🔁',
		name: 'Reply to - 10 platforms - for all work related messages I received ⌨️',
		props: {
			actionWords: 'Reply to',
			amount: '10 platforms',
			amountOutcome: 'for all work related messages I received ⌨️',
		},
		regenerated: 'Reply to - 10 platforms - for all work related messages I received ⌨️',
	},
	{
		// The same routine written without a cycle: three dash-separated parts under
		// the four-field routine format, so {cycle} stays empty and the trailing
		// emoji rides along in the outcome untouched.
		basename: '🔁 Consume - 0mg - of caffeine after 14.00h ☕',
		emoji: '🔁',
		name: 'Consume - 0mg - of caffeine after 14.00h ☕',
		props: {
			actionWords: 'Consume',
			amount: '0mg',
			amountOutcome: 'of caffeine after 14.00h ☕',
		},
		regenerated: 'Consume - 0mg - of caffeine after 14.00h ☕',
	},
	{
		// Created by following a routine link in the daily template. Three
		// dash-separated parts under the four-field routine format, so {cycle} stays
		// empty — and the trailing emoji survives parsing untouched.
		basename: '🔁 Congratulate min. - 1 person - that has a birthday 🎂',
		emoji: '🔁',
		name: 'Congratulate min. - 1 person - that has a birthday 🎂',
		props: {
			actionWords: 'Congratulate min.',
			amount: '1 person',
			amountOutcome: 'that has a birthday 🎂',
		},
		regenerated: 'Congratulate min. - 1 person - that has a birthday 🎂',
	},
];

function vaultBasenames(): string[] {
	return readdirSync(VAULT)
		.filter((f) => f.endsWith('.md'))
		.map((f) => f.slice(0, -3))
		.sort();
}

/**
 * `test-vault/` is NOT published — it is a scratch vault that accumulated real
 * personal notes while the plugin was being built, so it is gitignored.
 *
 * That costs only the coverage check below, which is the one test here that
 * needs the live folder. Every row's parse/regenerate proof is pure and runs
 * from the CORPUS table alone, so a fresh clone still verifies the whole frozen
 * grammar — it just cannot notice a note added to a vault it does not have.
 */
const HAS_VAULT = existsSync(VAULT);

describe('test-vault corpus', () => {
	it.skipIf(!HAS_VAULT)('covers every markdown file in the vault root', () => {
		// One direction, not equality. Every note IN the vault must have a row here,
		// so adding one still forces this snapshot to be updated deliberately rather
		// than drifting silently — that is the whole point of the file.
		//
		// But a row may outlive its note. The awkward names below were found by hand
		// and pin the frozen grammar: a bare `◻` with no variation selector, "at"
		// before a dash, real parentheses, a `$`, a date range, the 🅰️ marker. They
		// are the proof, and the vault is just a scratch pad — tidying it must not
		// quietly delete the regressions with the files.
		const covered = new Set(CORPUS.map((r) => r.basename));
		const uncovered = vaultBasenames().filter((name) => !covered.has(name));
		expect(uncovered, 'add a row for each of these').toEqual([]);
	});

	for (const row of CORPUS) {
		describe(row.basename, () => {
			const isEvent = getNormalizedEmoji(row.basename) === normalizeEmoji('📅');
			const format = formatFor(row.emoji);

			it('extracts the same emoji and name', () => {
				expect(extractTaskEmoji(row.basename)).toBe(row.emoji);
				expect(extractTaskName(row.basename)).toBe(row.name);
			});

			it('parses to the same properties', () => {
				expect(parseTaskProperties(row.name, isEvent, format)).toEqual(row.props);
			});

			it(
				row.usesNewFields
					? 'uses the new named fields (its format declares them)'
					: 'parses identically with and without a format — THE backward-compat guarantee',
				() => {
					const withFormat = parseTaskProperties(row.name, isEvent, format);
					const frozen = parseTaskProperties(row.name, isEvent);
					if (row.usesNewFields) expect(withFormat).not.toEqual(frozen);
					else expect(withFormat).toEqual(frozen);
				},
			);

			it('regenerates the same string', () => {
				expect(generateTaskName(row.props, format)).toBe(row.regenerated);
			});

			it('is a parse/generate fixpoint (renaming it twice changes nothing)', () => {
				// This is the property that keeps reconcile from looping: once a name has
				// been regenerated, regenerating it again must be a no-op.
				const once = generateTaskName(parseTaskProperties(row.name, isEvent, format), format);
				const twice = generateTaskName(parseTaskProperties(once, isEvent, format), format);
				expect(twice).toBe(once);
			});
		});
	}
});
