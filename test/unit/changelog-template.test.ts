import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dedent from 'dedent';
import { Liquid } from 'liquidjs';

const liquid = new Liquid({ strictFilters: true, strictVariables: true });
const releaseTemplatePath = resolve(process.cwd(), '.changeset/changelog.liquid');
const releaseTemplate = liquid.parse(
	readFileSync(releaseTemplatePath, 'utf8'),
	releaseTemplatePath,
);
const dependencyTemplatePath = resolve(process.cwd(), '.changeset/dependency-changelog.liquid');
const dependencyTemplate = liquid.parse(
	readFileSync(dependencyTemplatePath, 'utf8'),
	dependencyTemplatePath,
);

interface ReleaseFixture {
	readonly summary: string;
	readonly continuations: readonly string[];
	readonly summaryHasTerminal: boolean;
	readonly commit: { readonly short: string; readonly url: string } | null;
	readonly pullRequest: {
		readonly number: number;
		readonly url: string;
		readonly user: string | null;
		readonly userUrl: string | null;
		readonly externalAuthor: boolean;
	} | null;
}

const baseRelease: ReleaseFixture = {
	summary: 'Add managed inference',
	continuations: [],
	summaryHasTerminal: false,
	commit: null,
	pullRequest: null,
};

function renderRelease(release: ReleaseFixture): string {
	const output: unknown = liquid.renderSync(releaseTemplate, { release });
	if (typeof output !== 'string') throw new Error('Liquid did not render release text');
	return output;
}

function renderDependencies(dependencies: readonly { name: string; newVersion: string }[]): string {
	const output: unknown = liquid.renderSync(dependencyTemplate, { dependencies });
	if (typeof output !== 'string') throw new Error('Liquid did not render dependency text');
	return output;
}

describe('Changesets changelog templates', () => {
	test('renders the established internal pull-request line exactly', () => {
		const pullRequestUrl = 'https://github.com/example/repo/pull/42';
		expect(
			renderRelease({
				...baseRelease,
				pullRequest: {
					number: 42,
					url: pullRequestUrl,
					user: 'maintainer',
					userUrl: 'https://github.com/maintainer',
					externalAuthor: false,
				},
			}),
		).toBe(`- Add managed inference ([#42](${pullRequestUrl})).\n`);
	});

	test('renders the established external-author line exactly', () => {
		const pullRequestUrl = 'https://github.com/example/repo/pull/7';
		const contributorUrl = 'https://github.com/contributor';
		expect(
			renderRelease({
				...baseRelease,
				pullRequest: {
					number: 7,
					url: pullRequestUrl,
					user: 'contributor',
					userUrl: contributorUrl,
					externalAuthor: true,
				},
			}),
		).toBe(
			`- Add managed inference ([#7](${pullRequestUrl}) by [@contributor](${contributorUrl})).\n`,
		);
	});

	test('renders commit fallback, punctuation, and continuations exactly', () => {
		const commitUrl = 'https://github.com/example/repo/commit/abcdef0';
		const expected = dedent`
			- Add managed inference ([\`abcdef0\`](${commitUrl})).
			  More detail.

			  Final detail.
		`;
		expect(
			renderRelease({
				...baseRelease,
				continuations: ['More detail.', '', 'Final detail.'],
				commit: { short: 'abcdef0', url: commitUrl },
			}),
		).toBe(`${expected}\n`);
		expect(renderRelease(baseRelease)).toBe('- Add managed inference.\n');
		expect(
			renderRelease({
				...baseRelease,
				summary: 'Already punctuated.',
				summaryHasTerminal: true,
			}),
		).toBe('- Already punctuated.\n');
	});

	test('renders dependency updates exactly without control-flow-only separators', () => {
		expect(
			renderDependencies([
				{ name: 'first-package', newVersion: '1.2.3' },
				{ name: 'second-package', newVersion: '4.5.6' },
			]),
		).toBe(
			`${dedent`
			- Updated dependencies:
			  - first-package@1.2.3
			  - second-package@4.5.6
		`}\n`,
		);
	});
});
