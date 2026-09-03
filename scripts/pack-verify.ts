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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exit, stderr } from 'node:process';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pi } from '@repo/package.json' with { type: 'json' };
import { isRecord } from '@victor-software-house/pi-type-kit';
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

const allowedExternalImports = new Set([
	'@bufbuild/protobuf',
	'@bufbuild/protobuf/codegenv2',
	'@bufbuild/protobuf/wkt',
	'@earendil-works/pi-ai',
	'@earendil-works/pi-coding-agent',
	'@earendil-works/pi-tui',
	'ts-pattern',
]);
const maxBundleBytes = 160_000;
const maxGzipBytes = 50_000;
const root = join(import.meta.dir, '..');

const workDir = mkdtempSync(join(tmpdir(), 'pi-cursor-pack-'));
const failures: string[] = [];

function jsonRecord(line: string): Record<string, unknown> {
	const value: unknown = JSON.parse(line);
	if (!isRecord(value)) throw new Error('Pi JSON mode emitted a non-object event');
	return value;
}

async function checkImport(runtime: 'node' | 'bun', bundlePath: string): Promise<void> {
	const probe = `const loaded = await import(${JSON.stringify(pathToFileURL(bundlePath).href)}); if (typeof loaded.default !== 'function') throw new Error('default export is not an extension factory');`;
	const process = Bun.spawn({
		cmd: [runtime, '--eval', probe],
		stdout: 'ignore',
		stderr: 'ignore',
		timeout: 5_000,
		killSignal: 'SIGKILL',
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		failures.push(
			`${runtime} could not import the packed extension (exit ${String(exitCode)}${process.killed ? ', timed out' : ''})`,
		);
	}
}

async function checkPiLoader(bundlePath: string, agentDir: string): Promise<void> {
	const previousAgentDir = process.env['PI_CODING_AGENT_DIR'];
	process.env['PI_CODING_AGENT_DIR'] = agentDir;
	try {
		const { discoverAndLoadExtensions } = await import('@earendil-works/pi-coding-agent');
		const loaded = await discoverAndLoadExtensions([bundlePath], workDir, agentDir);
		for (const error of loaded.errors) {
			failures.push(`Pi loader rejected ${error.path}: ${error.error}`);
		}
		if (loaded.extensions.length !== 1) {
			failures.push(`Pi loader expected one extension, found ${loaded.extensions.length}`);
		}
		const extension = loaded.extensions[0];
		if (extension !== undefined && !extension.commands.has('cursor')) {
			failures.push('packed extension did not register the /cursor command');
		}
		const providers = loaded.runtime.pendingNativeProviderRegistrations;
		if (providers.length !== 1 || providers[0]?.provider.id !== 'cursor') {
			failures.push('packed extension did not register exactly one native Cursor provider');
		}
	} catch (error) {
		failures.push(`Pi could not load the packed extension: ${String(error)}`);
	} finally {
		if (previousAgentDir === undefined) delete process.env['PI_CODING_AGENT_DIR'];
		else process.env['PI_CODING_AGENT_DIR'] = previousAgentDir;
	}
}

async function runPiCommand(
	bundlePath: string,
	agentDir: string,
	mode: 'print' | 'json',
): Promise<string | undefined> {
	mkdirSync(agentDir, { recursive: true });
	const command = [
		'pi',
		'--no-extensions',
		'--extension',
		bundlePath,
		'--no-session',
		'--no-skills',
		'--no-themes',
		'--no-prompt-templates',
		'--no-context-files',
		'--offline',
		...(mode === 'json' ? ['--mode', 'json'] : []),
		'-p',
		'/cursor help',
	];
	const process = Bun.spawn({
		cmd: command,
		env: { ...Bun.env, PI_CODING_AGENT_DIR: agentDir },
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 5_000,
		killSignal: 'SIGKILL',
	});
	const [exitCode, stdoutOutput, stderrOutput] = await Promise.all([
		process.exited,
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
	]);
	if (exitCode === 0) return mode === 'print' ? stderrOutput : stdoutOutput;
	failures.push(
		`Pi ${mode} command proof failed (exit ${String(exitCode)}${process.killed ? ', timed out' : ''})`,
	);
	return undefined;
}

async function checkPiCommandModes(bundlePath: string, agentDir: string): Promise<void> {
	const [printOutput, jsonOutput] = await Promise.all([
		runPiCommand(bundlePath, join(agentDir, 'print'), 'print'),
		runPiCommand(bundlePath, join(agentDir, 'json'), 'json'),
	]);
	if (printOutput !== undefined && !printOutput.includes('Usage: /cursor [usage|help]')) {
		failures.push('packed /cursor help produced no print-mode output');
	}
	if (jsonOutput !== undefined) {
		const events = jsonOutput
			.split('\n')
			.filter((line) => line !== '')
			.map(jsonRecord);
		const commandMessage = events.find(
			(event) =>
				event['type'] === 'message_start' &&
				Reflect.get(event['message'] ?? {}, 'customType') === 'cursor-command-output',
		);
		if (!JSON.stringify(commandMessage).includes('Usage: /cursor [usage|help]')) {
			failures.push('packed /cursor help produced no JSON command message');
		}
	}
}

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
		const packageRoot = join(workDir, 'package');
		const bundlePath = join(packageRoot, 'dist', 'index.mjs');
		symlinkSync(join(root, 'node_modules'), join(packageRoot, 'node_modules'), 'dir');
		await Promise.all([
			checkImport('node', bundlePath),
			checkImport('bun', bundlePath),
			checkPiLoader(bundlePath, join(workDir, 'agent')),
			checkPiCommandModes(bundlePath, join(workDir, 'command-agent')),
		]);
		const bundle = await Bun.file(bundlePath).text();
		for (const pattern of forbiddenInBundle) {
			if (pattern.test(bundle)) {
				failures.push(`bundle matches forbidden pattern ${pattern}`);
			}
		}
		if (bundle.split('\n').length > 50) {
			failures.push(`bundle is not minified (${bundle.split('\n').length} lines)`);
		}
		const bundleBytes = Buffer.byteLength(bundle);
		if (bundleBytes > maxBundleBytes) {
			failures.push(`bundle exceeds ${String(maxBundleBytes)} bytes (${String(bundleBytes)})`);
		}
		const gzipBytes = gzipSync(bundle).byteLength;
		if (gzipBytes > maxGzipBytes) {
			failures.push(`gzip bundle exceeds ${String(maxGzipBytes)} bytes (${String(gzipBytes)})`);
		}
		const imports = [...bundle.matchAll(/(?:from|import\()["']([^"']+)["']/gu)].flatMap((match) =>
			match[1] === undefined ? [] : [match[1]],
		);
		for (const specifier of new Set(imports)) {
			if (!specifier.startsWith('node:') && !allowedExternalImports.has(specifier)) {
				failures.push(`bundle has unexpected external import: ${specifier}`);
			}
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
