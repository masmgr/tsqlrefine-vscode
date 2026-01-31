import type { NotificationManager } from "../state/notificationManager";

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

/**
 * Log operation context with consistent formatting.
 */
export function logOperationContext(
	notificationManager: NotificationManager,
	context: OperationLogContext,
): void {
	const prefix = `[execute${context.operation}]`;

	notificationManager.log(`${prefix} URI: ${context.uri}`);
	notificationManager.log(`${prefix} File path: ${context.filePath}`);

	if (context.targetFilePath !== undefined) {
		notificationManager.log(
			`${prefix} Target file path: ${context.targetFilePath}`,
		);
	}

	notificationManager.log(`${prefix} CWD: ${context.cwd}`);

	if (context.isSavedFile !== undefined) {
		notificationManager.log(`${prefix} Is saved: ${context.isSavedFile}`);
	}

	notificationManager.log(
		`${prefix} Config path: ${context.configPath ?? "(tsqlrefine default)"}`,
	);
}
