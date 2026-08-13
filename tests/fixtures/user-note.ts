// A faithful reduction of the real daily note this plugin has to work with:
// a `## ⏰ Schedule` heading, untimed routines under `### 📅 Daily`, and hour
// rows under `### 🎯 Timeboxing` whose real content is tab-indented underneath
// them — including non-checkbox group labels that have children of their own.
//
// Kept inline rather than in `test-vault/`, because `tests/corpus.test.ts`
// snapshots every markdown file in the vault and a new fixture would redden it.

export const HEADING = '## Day planner';

export const USER_NOTE =
	[
		'- ==[[If my system is broken its important to still use it & fix it while using it]]==',
		'## ⏰ Schedule',
		'### 📅 Daily',
		'- [ ] [[🔁 Consume - 0ml - sodas (Monster, Coke, Fanta, ...) at home 🥤]]',
		'### 🎯 Timeboxing',
		"- ==[[All tasks & to do's are in a particular order. Second task starts only after first completes]]==",
		'- [ ] 07:00 - 08:00',
		'\t- [ ] [[🔁 Document - 1 dream - of the night as exact as possible 📝]]',
		'\t- [x] [[🔁 Apply - 5 men or 10 women pumps - of minoxidil 👱‍♂️]]',
		'- [ ] 08:00 - 09:00',
		'\t- ==📅 Monthly - First Mon - 2026-09-07==',
		'\t\t- [ ] [[📅 Attend - 1h - monthly planning at Logisitsy - First mon at 08.00h ✍️]]',
		'\t- [ ] [[🔁 Do - 5m - of exercises for improving my posture 🧘‍♂️]]',
		'- [ ] 10:00 - 11:00 [[🔁 Do - 1 workout - with non-visual media 🏥]]',
		'- [ ] 13:00 - 14:00 ',
		'- [ ] 23:00 - 00:00',
		'- [ ] 04:00 - 05:00',
		'\t- [ ] [[🔁 Try to breath for - 1 long breath - through my closed nose 💭]]',
	].join('\n') + '\n';

/** Line numbers used by several tests, so they stay in step with the fixture. */
export const LINE = {
	preamble: 0,
	scheduleHeading: 1,
	dailyHeading: 2,
	dailyRoutine: 3,
	timeboxingHeading: 4,
	orderLabel: 5,
	row0700: 6,
	dream: 7,
	minoxidil: 8,
	row0800: 9,
	monthlyLabel: 10,
	monthlyChild: 11,
	posture: 12,
	row1000: 13,
	row1300: 14,
	row2300: 15,
	row0400: 16,
	breath: 17,
} as const;
