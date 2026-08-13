import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { compile, preprocess } from 'svelte/compiler';
import { sveltePreprocess } from 'svelte-preprocess';

/**
 * Compile `.svelte` for the component tests under tests/dom/.
 *
 * @sveltejs/vite-plugin-svelte does not accept vite 7 as a peer, and the compiler
 * is already a dependency — this is the same two steps esbuild.config.mjs runs
 * (preprocess to strip TS, then compile), just wired into vitest.
 */
const svelteForTests = {
	name: 'tn-svelte-for-tests',
	enforce: 'pre' as const,
	async transform(code: string, id: string) {
		if (!id.endsWith('.svelte')) return null;
		const processed = await preprocess(code, sveltePreprocess(), { filename: id });
		const { js } = compile(processed.code, { generate: 'client', filename: id });
		return { code: js.code, map: js.map };
	},
};

export default defineConfig({
	plugins: [svelteForTests],
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		// Every date assertion in this suite is about a WALL CLOCK. Inheriting the
		// machine's zone makes the DST tests pass vacuously on a UTC CI box, which
		// is exactly how an hour-wrong `timeOnDayTs` survived this long.
		env: { TZ: 'Europe/Berlin' },
	},
	resolve: {
		// Svelte's client runtime, not its server build — the same conditions
		// esbuild.config.mjs sets for the real bundle.
		conditions: ['svelte', 'browser'],
		alias: {
			// core/ modules import obsidian only via lib/moment.ts; the mock re-exports
			// the npm `moment` package plus the tiny handful of helpers pure code touches.
			obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)),
		},
	},
});
