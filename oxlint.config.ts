import { defineConfig } from 'oxlint';

export default defineConfig({
	options: { typeAware: true },
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
	plugins: ['typescript', 'import'],
	rules: {
		'no-console': 'error',
		'import/extensions': ['error', 'never', { ignorePackages: true }],
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
	},
	overrides: [
		{
			files: ['scripts/**', 'mise-tasks/**'],
			rules: { 'no-console': 'off' },
		},
	],
});
