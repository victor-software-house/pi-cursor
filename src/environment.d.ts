declare global {
	namespace NodeJS {
		interface ProcessEnv {
			readonly CI?: string;
			readonly GITHUB_ENV?: string;
			PI_CODING_AGENT_DIR?: string;
			readonly PI_CURSOR_IDE_STORAGE?: string;
			readonly PI_CURSOR_TOKEN?: string;
		}
	}
}

export {};
