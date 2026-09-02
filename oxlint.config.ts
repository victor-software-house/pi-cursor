import { defineConfig } from 'oxlint';

export default defineConfig({
	options: {
		typeAware: true,
	},
	ignorePatterns: ['dist/**', '.pi/**', 'src/gen/**'],
	categories: {
		correctness: 'error',
		suspicious: 'error',
		perf: 'off',
		style: 'off',
		restriction: 'off',
		pedantic: 'off',
		nursery: 'off',
	},
	plugins: ['typescript', 'unicorn', 'import', 'promise', 'oxc'],
	jsPlugins: [
		{
			name: 'zod',
			specifier: 'eslint-plugin-zod',
		},
		{
			name: '@limegrass/import-alias',
			specifier: '@limegrass/eslint-plugin-import-alias',
		},
	],
	rules: {
		'no-console': 'error',
		complexity: ['error', { max: 20, variant: 'modified' }],
		'import/no-default-export': 'error',
		'import/no-cycle': 'error',
		'import/extensions': [
			'error',
			'never',
			{
				ignorePackages: true,
				pattern: {
					json: 'always',
					liquid: 'always',
					md: 'always',
				},
			},
		],
		'typescript/no-explicit-any': 'error',
		'typescript/no-non-null-assertion': 'error',
		'typescript/consistent-type-imports': 'error',
		'typescript/no-unused-vars': 'error',
		'typescript/no-floating-promises': 'error',
		'typescript/no-misused-promises': 'error',
		'typescript/await-thenable': 'error',
		'typescript/strict-boolean-expressions': 'error',
		'typescript/no-unnecessary-type-assertion': 'error',
		'typescript/no-unsafe-type-assertion': 'error',
		'typescript/no-unsafe-assignment': 'error',
		'typescript/no-unsafe-call': 'error',
		'typescript/no-unsafe-member-access': 'error',
		'typescript/no-unsafe-return': 'error',
		'typescript/no-unsafe-argument': 'error',
		'typescript/no-deprecated': 'error',
		'typescript/consistent-type-assertions': 'error',
		'unicorn/prefer-node-protocol': 'error',
		'unicorn/no-array-for-each': 'error',
		'unicorn/no-null': 'off',
		'promise/always-return': 'error',
		'promise/no-return-wrap': 'error',
		'zod/consistent-import': 'error',
		'zod/consistent-import-source': ['error', { sources: ['zod'] }],
		'zod/no-native-enum': 'error',
		'zod/prefer-strict-object': 'error',
		'zod/prefer-top-level-string-formats': 'error',
		'zod/require-error-message': 'error',
		'@limegrass/import-alias/import-alias': ['error', { aliasConfigPath: 'tsconfig.json' }],
	},
	overrides: [
		{
			files: [
				'src/index.ts',
				'.changeset/changelog.ts',
				'commitlint.config.ts',
				'tsdown.config.ts',
				'oxlint.config.ts',
			],
			rules: {
				'import/no-default-export': 'off',
			},
		},
		{
			files: ['test/**', 'scripts/**', 'mise-tasks/**'],
			rules: {
				'no-console': 'off',
			},
		},
	],
});
