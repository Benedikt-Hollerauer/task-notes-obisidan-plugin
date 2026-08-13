// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { TaskPropertiesView } from '../../src/ui/views/task-properties-view';
import { ExplorerDecorator } from '../../src/ui/explorer/explorer-decorator';
import { DEFAULT_SETTINGS } from '../../src/settings/settings';
import { TASK_EMOJIS } from '../../src/constants';
import { generateTaskName } from '../../src/core/task-name';
import { normalizeEmoji } from '../../src/core/emoji';

function installObsidianDom(): void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
	proto.addClass = function (this: HTMLElement, cls: string) {
		this.classList.add(cls);
	};
	proto.removeClass = function (this: HTMLElement, cls: string) {
		this.classList.remove(cls);
	};
	proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
	};
	proto.appendText = function (this: HTMLElement, text: string) {
		this.append(text);
	};
	proto.createEl = function (
		this: HTMLElement,
		tag: string,
		o: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	) {
		const el = document.createElement(tag);
		if (o.text != null) el.textContent = o.text;
		if (o.cls) el.className = o.cls;
		for (const [key, value] of Object.entries(o.attr ?? {})) el.setAttribute(key, value);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: HTMLElement, o = {}) {
		return (this as unknown as { createEl: (tag: string, opts: unknown) => HTMLElement }).createEl('div', o);
	};
	proto.createSpan = function (this: HTMLElement, o = {}) {
		return (this as unknown as { createEl: (tag: string, opts: unknown) => HTMLElement }).createEl('span', o);
	};
}

function file(path: string): TFile {
	return new (TFile as unknown as new (path: string) => TFile)(path);
}

describe('TaskPropertiesView draft lifecycle', () => {
	beforeEach(installObsidianDom);
	afterEach(() => document.body.replaceChildren());

	function input(view: TaskPropertiesView, label: string): HTMLInputElement {
		const group = [...view.contentEl.querySelectorAll<HTMLElement>('.tn-input-group')].find(
			(el) => el.querySelector('.tn-input-label')?.textContent === label,
		);
		const found = group?.querySelector<HTMLInputElement>('input');
		if (!found) throw new Error(`Missing ${label} input`);
		return found;
	}

	function build() {
		const title = generateTaskName(
			{
				actionWords: 'write',
				amount: 'one',
				amountOutcome: 'report',
				startDate: '2026-08-20',
				time: '09.30h',
				endDate: '2026-08-22',
			},
			DEFAULT_SETTINGS.scheduledTaskFormat,
		);
		let active = file(`${normalizeEmoji(TASK_EMOJIS.SCHEDULED)} ${title}.md`);
		const app = {
			workspace: {
				getActiveFile: () => active,
				on: () => ({}),
			},
			vault: { on: () => ({}) },
		};
		const view = new TaskPropertiesView(
			{ app } as never,
			{} as never,
			{ showContextMenu: () => undefined } as never,
			() => DEFAULT_SETTINGS,
		);
		document.body.appendChild(view.contentEl);
		return { view, setActive: (next: TFile) => (active = next) };
	}

	it('does not rebuild for unrelated events and restores a draft after a tab change', async () => {
		const { view, setActive } = build();
		await view.onOpen();
		const action = input(view, 'Action');
		action.value = 'unsaved draft';

		view.render();
		expect(input(view, 'Action')).toBe(action);
		expect(input(view, 'Action').value).toBe('unsaved draft');

		const original = (view as unknown as { file: TFile }).file;
		setActive(file(`${normalizeEmoji(TASK_EMOJIS.UNCHECKED)} Another - one - task.md`));
		view.render();
		expect(input(view, 'Action').value).not.toBe('unsaved draft');
		setActive(original);
		view.render();
		expect(input(view, 'Action').value).toBe('unsaved draft');
	});

	it('carries date and time drafts through staged type changes', async () => {
		const { view } = build();
		await view.onOpen();
		input(view, 'Date').value = '2026-09-01';
		input(view, 'At').value = '14:45';
		input(view, 'To').value = '2026-09-03';

		view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="Change to unchecked"]')?.click();
		expect(view.contentEl.querySelector('input[type="date"]')).toBeNull();
		view.contentEl.querySelector<HTMLButtonElement>('[aria-label^="Change to scheduled"]')?.click();

		expect(input(view, 'Date').value).toBe('2026-09-01');
		expect(input(view, 'At').value).toBe('14:45');
		expect(input(view, 'To').value).toBe('2026-09-03');
	});
});

describe('ExplorerDecorator disabled lifecycle', () => {
	beforeEach(installObsidianDom);
	afterEach(() => document.body.replaceChildren());

	it('stays undecorated across layout, create, and rename callbacks after stop()', () => {
		const task = file(`${normalizeEmoji(TASK_EMOJIS.UNCHECKED)} Task.md`);
		const root = document.createElement('div');
		const container = root.createDiv({ cls: 'nav-files-container' });
		const title = container.createDiv({ cls: 'nav-file-title' });
		title.setAttribute('data-path', task.path);
		title.createDiv({ cls: 'nav-file-title-content' });
		document.body.appendChild(root);
		const vaultHandlers = new Map<string, (item: TFile) => void>();
		const workspaceHandlers = new Map<string, () => void>();
		const app = {
			vault: {
				on: (name: string, callback: (item: TFile) => void) => {
					vaultHandlers.set(name, callback);
					return {};
				},
				getMarkdownFiles: () => [task],
				getAllFolders: () => [],
				getAbstractFileByPath: () => task,
			},
			workspace: {
				on: (name: string, callback: () => void) => {
					workspaceHandlers.set(name, callback);
					return {};
				},
				getLeavesOfType: () => [{ view: { containerEl: root } }],
			},
		};
		const decorator = new ExplorerDecorator(app as never, () => undefined);
		decorator.register({ registerEvent: () => undefined } as never);
		decorator.start();
		expect(root.querySelectorAll('.task-notes-explorer-checkbox')).toHaveLength(1);

		decorator.stop();
		workspaceHandlers.get('layout-change')?.();
		vaultHandlers.get('create')?.(task);
		vaultHandlers.get('rename')?.(task);
		expect(root.querySelectorAll('.task-notes-explorer-checkbox')).toHaveLength(0);
	});
});
