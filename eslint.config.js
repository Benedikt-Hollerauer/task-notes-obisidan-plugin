// Flat ESLint config. The point of this file is `eslint-plugin-obsidianmd`: it
// encodes the Obsidian plugin-review team's own checklist, so running it before
// submitting turns a review round-trip into a local one.
//
// The plugin sat in devDependencies for a while with no config at all, which
// meant it had never actually run. A pre-publish audit drove it through the API
// by hand and found real objections (a Component leak, a private-API cast, an
// adapter read, command names repeating the plugin name). Those are fixed; this
// file is what keeps them fixed.
//
// NOTE the scoping: the obsidianmd rules apply to `src/` ONLY. They encode what
// is true of code that runs inside Obsidian — no Node builtins, `moment` from
// the host, sentence-case UI strings — and none of that is true of the test
// suite, which runs in Vitest on Node and reads fixtures off disk.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';

export default tseslint.config(
	{
		// Build output, deps, and the scratch vault. `main.js` is the bundle.
		ignores: [
			'main.js',
			'app.css',
			'node_modules/**',
			'test-vault/**',
			'docs/**',
			'*.config.js',
			'*.config.mjs',
			'vitest.config.ts',
		],
	},

	js.configs.recommended,
	...tseslint.configs.recommended,
	// Applied to everything, then switched back off for `tests/` below — the
	// plugin's own config nests `extends`, which cannot be re-scoped with a
	// `files` key without flattening it by hand.
	...obsidianmd.configs.recommended,

	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
				// Obsidian augments the global scope with these DOM helpers.
				createDiv: 'readonly',
				createEl: 'readonly',
				createSpan: 'readonly',
				createFragment: 'readonly',
			},
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			// The codebase leans on leading-underscore params for deliberately
			// unused callback arguments, which reads better than reordering an
			// Obsidian callback signature.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
		},
	},

	{
		// `depend/ban-dependencies` is generic JS advice that inverts inside an
		// Obsidian plugin:
		//
		//   moment            Obsidian BUNDLES moment and hands it to plugins.
		//                     Using anything else would ship a second date library
		//                     and, worse, disagree with the host about formats and
		//                     locale. It is a devDependency here purely so the
		//                     Vitest `obsidian` mock can re-export the same one.
		//   builtin-modules   Used by esbuild.config.mjs to mark Node builtins
		//                     external. It never reaches the bundle.
		files: ['package.json'],
		rules: { 'depend/ban-dependencies': 'off' },
	},

	{
		// Tests fake Obsidian objects on purpose (`as never` for a partial App is
		// the point of a unit test, not a type hole), read fixtures with node:fs,
		// and call async helpers positionally inside `it(...)`.
		//
		// The obsidianmd rules switched off here describe code that runs INSIDE
		// Obsidian. The test suite runs in Vitest on Node, so "no Node builtins"
		// and "import moment from the host" are not just inapplicable, they are
		// backwards.
		files: ['tests/**/*.ts'],
		rules: {
			'import/no-nodejs-modules': 'off',
			'no-restricted-imports': 'off',
			'obsidianmd/ui/sentence-case': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
