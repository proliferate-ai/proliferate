export interface EnvFileSpec {
	workspacePath: string;
	path: string;
	format: string;
	mode: string;
	keys: Array<{ key: string; required: boolean }>;
}
