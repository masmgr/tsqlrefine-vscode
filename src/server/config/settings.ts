export type TsqllintSettings = {
	path?: string;
	configPath?: string;
	runOnSave: boolean;
	runOnType: boolean;
	runOnOpen: boolean;
	debounceMs: number;
	timeoutMs: number;
	maxFileSizeKb: number;
	rangeMode: "character" | "line";
	formatTimeoutMs?: number;
};

export const defaultSettings: TsqllintSettings = {
	runOnSave: true,
	runOnType: false,
	runOnOpen: true,
	debounceMs: 500,
	timeoutMs: 10000,
	maxFileSizeKb: 0,
	rangeMode: "character",
	formatTimeoutMs: 10000,
};
