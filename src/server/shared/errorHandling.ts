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

	if (notificationManager.isMissingTsqllintError(message)) {
		await notificationManager.maybeNotifyMissingTsqllint(message);
		notificationManager.warn(`tsqlrefine ${operationName}: ${message}`);
	} else {
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage(
			`tsqlrefine: ${operationName} failed (${message})`,
		);
		notificationManager.warn(
			`tsqlrefine: ${operationName} failed (${message})`,
		);
	}
}
