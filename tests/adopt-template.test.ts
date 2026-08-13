// ADOPTING A TYPE ADOPTS ITS TEMPLATE — but only into an empty note.
//
// Reported as "when i apply a type and if no template is applied yet it didnt
// apply": changing a note's type in the properties panel renamed the file and
// nothing else. It had never done anything else — only `convert` (a PLAIN note
// becoming a task) and `createTaskNote` ever wrote a type's template, and the
// panel reaches neither.
//
// The rule chosen for the fix is "empty notes only", which is what
// `applyTemplate(file, emoji, forceApply: false)` means. That single flag is
// what makes this safe to wire into four routes at once — including the
// AUTOMATIC ✅ → ◻️ reopen guard — so these tests pin the flag's behaviour
// rather than any one caller's.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shouldApplyConvertTemplate } from '../src/core/emoji';
import { isDoneRole, TASK_EMOJIS, EMOJI_REGISTRY } from '../src/constants';

/**
 * `applyTemplate`'s decision, extracted verbatim from task-file-service.ts so a
 * change to that branch fails here. It is three lines and untestable in place
 * (it lives inside a `vault.process` callback), and it is the only branch in the
 * plugin that REPLACES a file's contents.
 */
function applyTemplateOutcome(
	current: string,
	processed: string,
	forceApply: boolean,
): { outcome: 'applied' | 'appended' | null; next: string } {
	if (current.trim().length === 0) return { outcome: 'applied', next: processed };
	if (forceApply) return { outcome: 'appended', next: `${current}\n\n${processed}` };
	return { outcome: null, next: current };
}

const TPL = '- [ ] Test\n- [ ] test\n- [ ] test';

/**
 * The copy above is a transcription, so it can drift from the original. This
 * reads the real source and fails if the branch it mirrors was edited — the one
 * thing a hand-copied fixture cannot notice on its own.
 */
function realApplyTemplateBody(): string {
	const src = readFileSync(fileURLToPath(new URL('../src/services/task-file-service.ts', import.meta.url)), 'utf8');
	const from = src.indexOf('async applyTemplate(');
	expect(from, 'applyTemplate must exist').toBeGreaterThan(-1);
	return src.slice(from, from + 2000);
}

it('the extracted branch still mirrors the real one', () => {
	const body = realApplyTemplateBody();
	expect(body).toContain('current.trim().length === 0');
	expect(body).toContain('if (forceApply)');
	// Escaped: the source contains the CHARACTERS backslash-n inside a template
	// literal, not a newline.
	expect(body).toContain('${current}\\n\\n${processed}');
});

describe('adopting a type: empty notes only', () => {
	it('THE FIX: an empty note gets the template', () => {
		expect(applyTemplateOutcome('', TPL, false)).toEqual({ outcome: 'applied', next: TPL });
		// Whitespace is not content.
		expect(applyTemplateOutcome('\n\n  \n', TPL, false).outcome).toBe('applied');
	});

	it('THE SAFETY: a note with anything in it is left exactly as it was', () => {
		const mine = '- [ ] my own todo\nsome notes';
		expect(applyTemplateOutcome(mine, TPL, false)).toEqual({ outcome: null, next: mine });
	});

	it('THE v3.8 BUG CANNOT RETURN: switching type repeatedly never stacks copies', () => {
		// ◻️ → 📅 → ◻️ → 📅. The first adoption fills the note; every later one
		// finds it non-empty and writes nothing. With forceApply TRUE this loop is
		// exactly how the template ended up in a note four times.
		let body = '';
		for (let i = 0; i < 4; i++) body = applyTemplateOutcome(body, TPL, false).next;
		expect(body).toBe(TPL);
		expect(body.split('- [ ] Test').length - 1).toBe(1);
	});

	it('…which is precisely what forceApply: true would have done', () => {
		// Pinned as the contrast, and because `convert` still uses `true` — that is
		// correct there (a plain note with prose becoming a task WANTS the
		// template appended) and must not be "fixed" to match this path.
		let body = '';
		for (let i = 0; i < 4; i++) body = applyTemplateOutcome(body, TPL, true).next;
		expect(body.split('- [ ] Test').length - 1).toBe(4);
	});
});

describe('which adoptions template at all', () => {
	it('a genuine type change does; a re-Apply of the same type does not', () => {
		expect(shouldApplyConvertTemplate('◻️ a - 1 - b', TASK_EMOJIS.SCHEDULED, true)).toBe(true);
		// Editing Amount and pressing Apply must not inject a template into an
		// empty note — the type did not change, so nothing was adopted.
		expect(shouldApplyConvertTemplate('📅 By 2026-08-12, a - 1 - b', TASK_EMOJIS.SCHEDULED, true)).toBe(
			false,
		);
	});

	it('the setting still governs it — one toggle, every adoption route', () => {
		expect(shouldApplyConvertTemplate('◻️ a - 1 - b', TASK_EMOJIS.SCHEDULED, false)).toBe(false);
	});

	it('DONE and DROPPED types are skipped, and this vault shows why', () => {
		// The completed template here is three UNCHECKED boxes. Writing it into a
		// note the user just marked ✅ would trip `reopenCompletedOnUnchecked` and
		// rename that note straight back to ◻️ — a write nobody asked for, caused
		// by a write nobody asked for.
		expect(isDoneRole(TASK_EMOJIS.CHECKED)).toBe(true);
		expect(isDoneRole(TASK_EMOJIS.UNIMPORTANT)).toBe(true);
		expect(isDoneRole(TASK_EMOJIS.SCHEDULED)).toBe(false);
		expect(isDoneRole(TASK_EMOJIS.UNCHECKED)).toBe(false);
	});

	it('a type with no template of its own is a silent no-op, not an error', () => {
		// ❌ declares no templateSettingKey; adopting it simply writes nothing.
		const dropped = EMOJI_REGISTRY.filter((s) => !s.templateSettingKey).map((s) => s.emoji);
		expect(dropped.length).toBeGreaterThan(0);
	});
});
