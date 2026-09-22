import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { detectEndOfLine, normalizeLineEndings } from "../lint/decodeOutput";
import type { NotificationManager } from "../state/notificationManager";
import type { DocumentContext } from "./documentContext";
import { createFullDocumentEdit } from "./documentEdit";
import { handleOperationError } from "./errorHandling";
import { logOperationContext } from "./logging";
import { type OperationControl, reportCliFailure } from "./operationExecution";
import type { ProcessRunResult } from "./types";

export type CliEditOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	control: OperationControl;
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
	const { connection, notificationManager, control } = deps;
	const {
		uri,
		filePath,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
	} = context;
	const operation = options.operationName;
	if (!control.isCurrent()) {
		return null;
	}

	logOperationContext(notificationManager, {
		operation: operation === "format" ? "Format" : "Fix",
		uri,
		filePath,
		cwd,
		configPath: effectiveConfigPath,
	});

	let result: ProcessRunResult;
	try {
		result = await options.runner({
			cwd,
			settings: effectiveSettings,
			signal: control.signal,
			stdin: documentText,
		});
	} catch (error) {
		if (control.isCurrent()) {
			await handleOperationError(error, deps, operation);
		}
		return null;
	}

	if (!control.isCurrent()) {
		return null;
	}
	if (
		reportCliFailure({
			result,
			operation,
			deps,
			successExitCodes: [0],
			cancelled: control.signal.aborted,
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
