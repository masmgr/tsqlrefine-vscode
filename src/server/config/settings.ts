export type TsqllintSettings = {
	path?: string;
	configPath?: string;
	runOnSave: boolean;
	fixOnSave: boolean;
	runOnType: boolean;
	debounceMs: number;
	timeoutMs: number;
	rangeMode: "character" | "line";
};

export const defaultSettings: TsqllintSettings = {
	runOnSave: true,
	fixOnSave: false,
	runOnType: false,
	debounceMs: 500,
	timeoutMs: 10000,
	rangeMode: "character",
};
