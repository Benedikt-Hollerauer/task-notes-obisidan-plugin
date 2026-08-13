// Turning an HTTP failure into something you can act on. Pure (no Obsidian imports).
//
// The plugin used to report Obsidian's own wording — `Request failed, status 404` —
// which is accurate and useless. The case that prompted this: a Google Workspace
// calendar's `/public/basic.ics` URL 404s, because `/public/` exists only for a
// calendar shared "make available to public", and Workspace policy normally forbids
// that. The URL looks completely correct; nothing on screen said what was wrong.

/** True for a Google Calendar URL asking for the PUBLIC (not secret) feed. */
function isGooglePublicFeed(url: string): boolean {
	return /(^|\/\/)calendar\.google\.com\/calendar\/ical\/.*\/public\//i.test(url);
}

/**
 * What to tell the user when a calendar could not be fetched.
 *
 * `status` is the HTTP status, or null when the request never produced one (DNS
 * failure, offline, timeout). The result is a complete sentence; the settings row
 * and the failure Notice both print it verbatim.
 */
export function describeFetchFailure(url: string, status: number | null): string {
	if (status == null) {
		return 'Could not reach this URL — check the address and your connection';
	}
	if (status === 404) {
		// The specific advice first: this is the case that costs people an evening.
		if (isGooglePublicFeed(url)) {
			return (
				'Not found (404). This Google calendar is not shared publicly, so its ' +
				'/public/ address does not exist. Use the "Secret address in iCal format" ' +
				'from Google Calendar → Settings → your calendar → Integrate calendar'
			);
		}
		return 'Not found (404) — the calendar address does not exist';
	}
	if (status === 401 || status === 403) {
		return (
			`The feed refused the request (${status}) — it needs authentication. ` +
			'Use the calendar’s private or secret address rather than a shared link'
		);
	}
	if (status === 429) {
		return 'The calendar server is rate-limiting us (429) — try a longer refresh interval';
	}
	if (status >= 500) {
		return `The calendar server had an error (${status}) — this is usually temporary`;
	}
	return `Could not fetch: the server answered ${status}`;
}

/**
 * Strip a UTF-8 byte-order mark.
 *
 * `ICAL.parse` throws an unhelpful `Cannot read properties of undefined` on a body
 * that begins with one, and `icsBodyProblem`'s `BEGIN:VCALENDAR` test is unanchored
 * so a BOM'd body passes the guard and dies inside the parser instead. Some Outlook,
 * Exchange and SharePoint exports emit one.
 */
export function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Keep only usable cached response bodies from the user-editable data file.
 * Arrays and primitive values are not cache maps; individual corrupt entries
 * must not make the remaining offline calendars unavailable.
 */
export function normalizeIcsCache(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	return Object.fromEntries(
		Object.entries(raw).filter(
			(entry): entry is [string, string] => entry[0].length > 0 && typeof entry[1] === 'string',
		),
	);
}
