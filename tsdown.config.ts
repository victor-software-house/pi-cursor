import { defineConfig } from 'tsdown';

const piPeers = [
	'@earendil-works/pi-ai',
	'@earendil-works/pi-coding-agent',
	'@earendil-works/pi-tui',
];

/**
 * One published implementation artifact: dist/index.mjs (minified, no source map) plus the entry's
 * declaration. Public runtime libraries and Pi peers stay external package imports. Only the private
 * type-kit build dependency is bundled and tree-shaken out of the consumer dependency graph.
 */
export default defineConfig({
	entry: { index: 'src/index.ts' },
	format: 'esm',
	platform: 'node',
	target: 'node24',
	fixedExtension: true,
	minify: true,
	treeshake: true,
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
		onlyBundle: ['@victor-software-house/pi-type-kit'],
		onlyImport: [...piPeers, '@bufbuild/protobuf', 'ts-pattern'],
	},
});
