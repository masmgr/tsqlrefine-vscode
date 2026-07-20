import type { Connection } from "vscode-languageserver/node";
import { CLI_EXIT_CODE_DESCRIPTIONS } from "../config/constants";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import { firstLine } from "./textUtils";
import type { ProcessRunResult } from "./types";

export type CliOperationName = "lint" | "format" | "fix";

type CliFailureDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
};

type ReportCliFailureOptions = {
	result: ProcessRunResult;
	operation: CliOperationName;
	deps: CliFailureDeps;
	successExitCodes: readonly number[];
	cancelled?: boolean;
};

export type InFlightExecution<T> = {
	controller: AbortController;
	result: T;
};

/**
 * Run an operation while safely tracking its AbortController for a document.
 * An older operation never clears a controller installed by a newer operation.
 */
export async function runWithInFlight<T>(
	stateManager: DocumentStateManager,
	uri: string,
	run: (controller: AbortController) => Promise<T>,
): Promise<InFlightExecution<T>> {
	const controller = new AbortController();
	stateManager.setInFlight(uri, controller);
	try {
		return { controller, result: await run(controller) };
	} finally {
		if (stateManager.isCurrentInFlight(uri, controller)) {
			stateManager.clearInFlight(uri);
		}
	}
}

/**
 * Report timeout and unsuccessful exit results consistently.
 * Returns true when the caller should stop processing the result.
 */
export function reportCliFailure(options: ReportCliFailureOptions): boolean {
	const {
		result,
		operation,
		deps: { connection, notificationManager },
		successExitCodes,
		cancelled = false,
	} = options;

	if (result.timedOut) {
		const message = `tsqlrefine: ${operation} timed out`;
		void connection.window.showWarningMessage(message);
		notificationManager.warn(message);
		return true;
	}
	if (cancelled || result.cancelled) {
		return true;
	}

	const stderr = result.stderr.trim();
	if (stderr) {
		if (operation === "lint") {
			notificationManager.notifyStderr(result.stderr);
		} else {
			notificationManager.warn(
				`tsqlrefine ${operation} stderr: ${result.stderr}`,
			);
		}
	}

	if (result.exitCode !== null && successExitCodes.includes(result.exitCode)) {
		return false;
	}

	const description =
		result.exitCode === null
			? "process terminated without an exit code"
			: (CLI_EXIT_CODE_DESCRIPTIONS[result.exitCode] ??
				`exit code ${result.exitCode}`);
	const detail = stderr ? ` (${firstLine(stderr)})` : "";
	const message = `tsqlrefine: ${operation} failed - ${description}${detail}`;
	void connection.window.showWarningMessage(message);
	notificationManager.warn(message);
	return true;
}
