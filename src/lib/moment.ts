// Single import point for moment. Obsidian bundles and re-exports moment; using
// that instance (never an own npm dependency) keeps date formatting aligned with
// the user's locale/week settings and avoids double-bundling.
//
// Obsidian's type for `moment` is a namespace import, which our tsconfig treats as
// non-callable, so we re-type the (runtime-callable) value with an explicit
// signature + the namespace statics. In unit tests, `obsidian` is aliased to
// tests/mocks/obsidian.ts, which re-exports the npm `moment` package.
import { moment as obsidianMoment } from 'obsidian';

type MomentInput = import('moment').MomentInput;
type MomentFormatSpecification = import('moment').MomentFormatSpecification;
export type Moment = import('moment').Moment;

interface MomentFn {
	(inp?: MomentInput, strict?: boolean): Moment;
	(inp?: MomentInput, format?: MomentFormatSpecification, strict?: boolean): Moment;
	(inp?: MomentInput, format?: MomentFormatSpecification, language?: string, strict?: boolean): Moment;
}

export const moment = obsidianMoment as unknown as MomentFn & typeof obsidianMoment;
