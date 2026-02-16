export type TsqlRefineSettings = {
	path?: string;
	configPath?: string;
	runOnSave: boolean;
	runOnType: boolean;
	runOnOpen: boolean;
	debounceMs: number;
	timeoutMs: number;
	maxFileSizeKb: number;
	minSeverity: "error" | "warning" | "info" | "hint";
	formatTimeoutMs?: number;
	enableLint: boolean;
	enableFormat: boolean;
	enableFix: boolean;
	allowPlugins: boolean;
};

export const defaultSettings: TsqlRefineSettings = {
	runOnSave: true,
	runOnType: false,
	runOnOpen: true,
	debounceMs: 500,
	timeoutMs: 10000,
	maxFileSizeKb: 0,
	minSeverity: "info",
	formatTimeoutMs: 10000,
	enableLint: true,
	enableFormat: true,
	enableFix: true,
	allowPlugins: false,
};
