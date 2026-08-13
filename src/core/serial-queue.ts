// One unit of async work at a time, in call order. Pure (no Obsidian imports).
//
// Two services need this and both had grown their own: writes must not
// interleave (two edits to one note racing each other), and index passes must
// not interleave (a re-read landing in the middle of a flush makes a real edit
// look unchanged, which silently stops filename sync).

/** Runs work one unit at a time. A rejection settles only its own caller. */
export function createSerialQueue(): <T>(work: () => Promise<T>) => Promise<T> {
	let chain: Promise<unknown> = Promise.resolve();
	return <T>(work: () => Promise<T>): Promise<T> => {
		// Both arms run `work`, so one caller's rejection never skips the next.
		const next = chain.then(work, work);
		chain = next.catch(() => undefined);
		return next;
	};
}
