import type { Connection } from "vscode-languageserver/node";
import type { NotificationManager } from "../state/notificationManager";
import { firstLine } from "./textUtils";

export type ErrorHandlerDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
};

/**
 * Handle CLI operation errors with consistent notification and logging.
 * Used by format and fix operations.
 */
export async function handleOperationError(
	error: unknown,
	deps: ErrorHandlerDeps,
	operationName: string,
): Promise<void> {
	const { connection, notificationManager } = deps;
	const message = firstLine(String(error));

	if (notificationManager.isMissingTsqlRefineError(message)) {
		await notificationManager.maybeNotifyMissingTsqlRefine(message);
		notificationManager.warn(
			`tsqlrefine: ${operationName} failed (${message})`,
		);
	} else {
		const formatted = `tsqlrefine: ${operationName} failed (${message})`;
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage(formatted);
		notificationManager.warn(formatted);
	}
}
