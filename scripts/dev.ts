/**
 * Dev launcher: start an isolated Pi session with the extension loaded from TypeScript source.
 *
 * All Pi state (settings, auth, sessions) stays in the project-local .pi/agent/ directory,
 * so `/login cursor` here never touches ~/.pi/.
 *
 * Usage: mise run dev [-- ...pi args]
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { argv, cwd, env } from 'node:process';
import cursorInference from '@cursor';
import { main } from '@earendil-works/pi-coding-agent';

const projectAgentDir = join(cwd(), '.pi', 'agent');
mkdirSync(projectAgentDir, { recursive: true });
env['PI_CODING_AGENT_DIR'] = projectAgentDir;

await main(
	[
		'--no-extensions',
		'--no-session',
		'--no-skills',
		'--no-themes',
		'--no-prompt-templates',
		'--no-context-files',
		...argv.slice(2),
	],
	{ extensionFactories: [cursorInference] },
);
