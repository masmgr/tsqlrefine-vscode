import type { Connection } from "vscode-languageserver/node";
import type { NotificationManager } from "../state/notificationManager";
import { MissingTsqlRefineError } from "./errors";
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
	const message = firstLine(
		error instanceof Error ? error.message : String(error),
	);

	if (error instanceof MissingTsqlRefineError) {
		// Don't await - the warning carries an action button and stays unresolved
		// until the user dismisses it, which would hold this operation open and
		// leave the status bar spinner running.
		void notificationManager.maybeNotifyMissingTsqlRefine(message);
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
