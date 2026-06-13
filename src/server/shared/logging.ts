export type OperationLogContext = {
	operation: "Lint" | "Format" | "Fix";
	uri: string;
	filePath: string;
	cwd: string;
	configPath: string | undefined;
	/** Target file path (Lint only) */
	targetFilePath?: string;
	/** Whether the file is saved (Lint only) */
	isSavedFile?: boolean;
};

type DebugLogger = {
	debug(message: string): void;
};

/**
 * Log operation context with consistent formatting.
 */
export function logOperationContext(
	logger: DebugLogger,
	context: OperationLogContext,
): void {
	const prefix = `[execute${context.operation}]`;

	logger.debug(`${prefix} URI: ${context.uri}`);
	logger.debug(`${prefix} File path: ${context.filePath}`);

	if (context.targetFilePath !== undefined) {
		logger.debug(`${prefix} Target file path: ${context.targetFilePath}`);
	}

	logger.debug(`${prefix} CWD: ${context.cwd}`);

	if (context.isSavedFile !== undefined) {
		logger.debug(`${prefix} Is saved: ${context.isSavedFile}`);
	}

	logger.debug(
		`${prefix} Config path: ${context.configPath ?? "(tsqlrefine default)"}`,
	);
}
