// Minimal `obsidian` stub for Vitest. Pure `core/` code only ever touches the
// symbols re-exported here (via `src/lib/moment.ts` and a couple of path helpers).
import moment from 'moment';

export { moment };

/** Small runtime file/folder shapes for service and DOM integration tests. */
export class TAbstractFile {
	name: string;
	constructor(public path: string) {
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFile extends TAbstractFile {
	basename: string;
	extension: string;
	constructor(path: string) {
		super(path);
		const dot = this.name.lastIndexOf('.');
		this.extension = dot >= 0 ? this.name.slice(dot + 1) : '';
		this.basename = dot >= 0 ? this.name.slice(0, dot) : this.name;
	}
}

export class TFolder extends TAbstractFile {}

export class ItemView {
	app: unknown;
	contentEl: HTMLElement;
	constructor(public leaf: { app: unknown }) {
		this.app = leaf.app;
		this.contentEl = document.createElement('div');
	}
	registerEvent(_ref: unknown): void {}
}

/** Base class only; service tests import modal modules but never open one. */
export class Modal {
	constructor(_app: unknown) {}
	open(): void {}
	close(): void {}
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not configured in this test');
}

export function normalizePath(path: string): string {
	// Mirror Obsidian's normalizePath closely enough for unit tests.
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/(^\/|\/$)/g, () => '')
		.trim();
}

/**
 * Notices are the plugin's in-app fallback channel, so a test asserting "the user
 * was told something" needs to see them. Every instance is recorded; call
 * `Notice.reset()` in a beforeEach.
 */
export class Notice {
	static shown: string[] = [];
	/** The instances themselves, for a test that asserts on the ELEMENT. */
	static instances: Notice[] = [];
	static reset(): void {
		Notice.shown = [];
		Notice.instances = [];
	}

	/**
	 * Stands in for the real notice element.
	 *
	 * Enough of Obsidian's HTMLElement extensions for the reminder notice to
	 * build its two lines for real, rather than being skipped behind a
	 * capability check — the classes and the text it writes are recorded, so a
	 * test can assert on the structure without a DOM.
	 */
	/**
	 * `messageEl`, matching the real Notice. It used to be named `noticeEl`, which
	 * is Obsidian's deprecated alias for the OUTER element — the plugin now writes
	 * into the message element, which is the one meant to hold content.
	 */
	messageEl = {
		classes: [] as string[],
		children: [] as { cls?: string; text?: string }[],
		props: {} as Record<string, string>,
		addClass(cls: string): void {
			this.classes.push(cls);
		},
		empty(): void {
			this.children.length = 0;
		},
		createDiv(o: { text?: string; cls?: string } = {}): unknown {
			this.children.push(o);
			return { addClass(): void {} };
		},
		style: {
			setProperty(this: void, _name: string, _value: string): void {},
		},
		addEventListener(): void {},
	};

	constructor(public message: string) {
		Notice.shown.push(message);
		Notice.instances.push(this);
	}
	setMessage(message: string): this {
		this.message = message;
		return this;
	}
	hide(): void {}
}

/**
 * Obsidian's platform flags. `isMobileApp` is the only one the plugin reads, and
 * it decides whether an OS notification is even attempted.
 */
export const Platform = {
	isMobileApp: false,
	isMobile: false,
	isPhone: false,
	isTablet: false,
	isDesktop: true,
};
