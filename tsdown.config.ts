import { defineConfig } from 'tsdown';

const piPeers = [
	'@earendil-works/pi-ai',
	'@earendil-works/pi-coding-agent',
	'@earendil-works/pi-tui',
];

/**
 * One published artifact: dist/index.mjs (minified, no source map) plus the entry's declaration.
 * Everything that is not a Pi peer is bundled into it, so the published package has no runtime
 * dependency list to keep in sync and exposes nothing beyond the extension entry.
 */
export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node24',
	fixedExtension: true,
	minify: true,
	sourcemap: false,
	clean: true,
	hash: false,
	dts: { tsconfig: 'tsconfig.build.json' },
	failOnWarn: 'ci-only',
	suppressWarnings: [
		'TypeScript 7.0 does not yet have a stable API and is experimental. Some options will be unavailable.',
	],
	deps: {
		neverBundle: piPeers,
		onlyBundle: [],
		onlyImport: piPeers,
	},
});
