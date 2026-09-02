/**
 * Pack the package and enforce the published-artifact contract:
 *
 *  - only whitelisted files leave the repository,
 *  - every `pi.extensions` entry is present,
 *  - the bundle carries no source map reference, no source-tree paths, and no private names.
 *
 * Minification is not protection; this gate proves that nothing beyond the documented public
 * bundle is shipped.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exit, stderr } from 'node:process';
import { pi } from '@repo/package.json' with { type: 'json' };
import { $ } from 'bun';

const allowed = new Set([
	'package/package.json',
	'package/README.md',
	'package/CHANGELOG.md',
	'package/LICENSE',
	'package/dist/index.mjs',
	'package/dist/index.d.mts',
]);

const forbiddenInBundle: readonly RegExp[] = [
	/sourceMappingURL/u,
	/@victor-software-house\/pi-type-kit/u,
	/victor-software-house\/pi-stuff/u,
	/package manifest must be an object/u,
	/src\/(?:fallback|manifest|omit-values|result|scope|thrown)\.ts/u,
	/\/Users\/[a-z]/u,
	/\/home\/[a-z]/u,
	/[A-Za-z]:\\Users\\/u,
	/\bsrc\/[a-z-]+\.ts\b/u,
];

const workDir = mkdtempSync(join(tmpdir(), 'pi-cursor-pack-'));
const failures: string[] = [];

try {
	await $`bun pm pack --destination ${workDir} --quiet`.quiet();
	const tarballs = [...new Bun.Glob('*.tgz').scanSync(workDir)];
	const tarball = tarballs[0];
	if (tarball === undefined || tarballs.length !== 1) {
		failures.push(`expected exactly one tarball, found ${tarballs.length}`);
	} else {
		const tarballPath = join(workDir, tarball);
		const listing = await $`tar tzf ${tarballPath}`.text();
		const entries = listing.split('\n').filter((line) => line !== '');
		for (const entry of entries) {
			if (!allowed.has(entry)) {
				failures.push(`file outside whitelist: ${entry}`);
			}
		}
		for (const extension of pi.extensions) {
			const expected = `package/${extension.replace(/^\.\//u, '')}`;
			if (!entries.includes(expected)) {
				failures.push(`pi.extensions entry missing from tarball: ${expected}`);
			}
		}
		await $`tar xzf ${tarballPath} -C ${workDir}`.quiet();
		const bundle = await Bun.file(join(workDir, 'package', 'dist', 'index.mjs')).text();
		for (const pattern of forbiddenInBundle) {
			if (pattern.test(bundle)) {
				failures.push(`bundle matches forbidden pattern ${pattern}`);
			}
		}
		if (bundle.split('\n').length > 50) {
			failures.push(`bundle is not minified (${bundle.split('\n').length} lines)`);
		}
	}
} finally {
	rmSync(workDir, { recursive: true, force: true });
}

if (failures.length > 0) {
	for (const failure of failures) {
		stderr.write(`pack:verify ✘ ${failure}\n`);
	}
	exit(1);
}
