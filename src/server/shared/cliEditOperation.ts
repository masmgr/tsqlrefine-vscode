import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { detectEndOfLine, normalizeLineEndings } from "../lint/decodeOutput";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import type { DocumentContext } from "./documentContext";
import { createFullDocumentEdit } from "./documentEdit";
import { handleOperationError } from "./errorHandling";
import { logOperationContext } from "./logging";
import {
	type InFlightExecution,
	reportCliFailure,
	runWithInFlight,
} from "./operationExecution";
import type { ProcessRunResult } from "./types";

export type CliEditOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	stateManager: DocumentStateManager;
};

type CliEditOperationOptions = {
	operationName: "format" | "fix";
	runner: (options: {
		cwd: string;
		settings: DocumentContext["effectiveSettings"];
		signal: AbortSignal;
		stdin: string;
	}) => Promise<ProcessRunResult>;
};

export async function executeCliEditOperation(
	context: DocumentContext,
	document: TextDocument,
	deps: CliEditOperationDeps,
	options: CliEditOperationOptions,
): Promise<TextEdit[] | null> {
	const { connection, notificationManager, stateManager } = deps;
	const {
		uri,
		filePath,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
	} = context;
	const operation = options.operationName;

	logOperationContext(notificationManager, {
		operation: operation === "format" ? "Format" : "Fix",
		uri,
		filePath,
		cwd,
		configPath: effectiveConfigPath,
	});

	let execution: InFlightExecution<ProcessRunResult>;
	try {
		execution = await runWithInFlight(stateManager, uri, async (controller) =>
			options.runner({
				cwd,
				settings: effectiveSettings,
				signal: controller.signal,
				stdin: documentText,
			}),
		);
	} catch (error) {
		await handleOperationError(error, deps, operation);
		return null;
	}

	const { controller, result } = execution;
	if (
		reportCliFailure({
			result,
			operation,
			deps,
			successExitCodes: [0],
			cancelled: controller.signal.aborted,
		})
	) {
		return null;
	}

	if (documentText.length > 0 && result.stdout.length === 0) {
		const message = `tsqlrefine: ${operation} failed - empty output for a non-empty document`;
		void connection.window.showWarningMessage(message);
		notificationManager.warn(message);
		return null;
	}

	const outputText = normalizeLineEndings(
		result.stdout,
		detectEndOfLine(documentText),
	);
	if (outputText === documentText) {
		return [];
	}
	return [createFullDocumentEdit(document, outputText)];
}
