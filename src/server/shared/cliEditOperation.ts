import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CLI_EXIT_CODE_DESCRIPTIONS } from "../config/constants";
import { detectEndOfLine, normalizeLineEndings } from "../lint/decodeOutput";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import type { DocumentContext } from "./documentContext";
import { createFullDocumentEdit } from "./documentEdit";
import { handleOperationError } from "./errorHandling";
import { logOperationContext } from "./logging";
import { firstLine } from "./textUtils";
import type { ProcessRunResult } from "./types";

export type CliEditOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	stateManager: DocumentStateManager;
};

type CliEditOperationOptions = {
	operationName: "format" | "fix";
	isEnabled: (context: DocumentContext) => boolean;
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

	if (!options.isEnabled(context)) {
		notificationManager.debug(
			`tsqlrefine: ${operation} is disabled for ${uri}`,
		);
		return null;
	}

	const controller = new AbortController();
	stateManager.setInFlight(uri, controller);
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
			signal: controller.signal,
			stdin: documentText,
		});
	} catch (error) {
		if (stateManager.isCurrentInFlight(uri, controller)) {
			stateManager.clearInFlight(uri);
		}
		await handleOperationError(error, deps, operation);
		return null;
	}

	if (stateManager.isCurrentInFlight(uri, controller)) {
		stateManager.clearInFlight(uri);
	}
	if (result.timedOut) {
		const message = `tsqlrefine: ${operation} timed out`;
		void connection.window.showWarningMessage(message);
		notificationManager.warn(message);
		return null;
	}
	if (controller.signal.aborted || result.cancelled) {
		return null;
	}
	if (result.stderr.trim()) {
		notificationManager.warn(
			`tsqlrefine ${operation} stderr: ${result.stderr}`,
		);
	}
	if (result.exitCode !== 0) {
		const description =
			result.exitCode === null
				? "unknown error"
				: (CLI_EXIT_CODE_DESCRIPTIONS[result.exitCode] ??
					`exit code ${result.exitCode}`);
		const stderrDetail = result.stderr.trim();
		const detail = stderrDetail ? ` (${firstLine(stderrDetail)})` : "";
		const message = `tsqlrefine: ${operation} failed - ${description}${detail}`;
		void connection.window.showWarningMessage(message);
		notificationManager.warn(message);
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
