import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CLI_EXIT_CODE_DESCRIPTIONS } from "../config/constants";
import type { DocumentContext } from "../shared/documentContext";
import { createFullDocumentEdit } from "../shared/documentEdit";
import { handleOperationError } from "../shared/errorHandling";
import { logOperationContext } from "../shared/logging";
import { firstLine, resolveTargetFilePath } from "../shared/textUtils";
import type { ProcessRunResult } from "../shared/types";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import { runFormatter } from "./runFormatter";

export type FormatOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	formatStateManager: DocumentStateManager;
};

/**
 * Execute format operation on a document.
 *
 * @param context - Document context containing URI, settings, and text
 * @param document - The TextDocument to format
 * @param deps - Dependencies including connection and managers
 * @returns Array of TextEdits to apply, empty if no changes, null on error
 */
export async function executeFormat(
	context: DocumentContext,
	document: TextDocument,
	deps: FormatOperationDeps,
): Promise<TextEdit[] | null> {
	const { connection, notificationManager, formatStateManager } = deps;
	const {
		uri,
		filePath,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
	} = context;

	if (!effectiveSettings.enableFormat) {
		notificationManager.log(
			`tsqlrefine: format is disabled (enableFormat=false) for ${uri}`,
		);
		return null;
	}

	const controller = new AbortController();
	formatStateManager.setInFlight(uri, controller);

	const targetFilePath = resolveTargetFilePath(filePath);

	logOperationContext(notificationManager, {
		operation: "Format",
		uri,
		filePath,
		cwd,
		configPath: effectiveConfigPath,
	});

	let result: ProcessRunResult;
	try {
		result = await runFormatter({
			filePath: targetFilePath,
			cwd,
			settings: effectiveSettings,
			signal: controller.signal,
			stdin: documentText,
		});
	} catch (error) {
		formatStateManager.clearInFlight(uri);
		return await handleFormatError(error, deps);
	}

	if (formatStateManager.isCurrentInFlight(uri, controller)) {
		formatStateManager.clearInFlight(uri);
	}

	if (result.timedOut) {
		const formatted = "tsqlrefine: format timed out";
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage(formatted);
		notificationManager.warn(formatted);
		return null;
	}

	if (controller.signal.aborted || result.cancelled) {
		return null;
	}

	if (result.stderr.trim()) {
		notificationManager.warn(`tsqlrefine format stderr: ${result.stderr}`);
	}

	if (result.exitCode !== 0) {
		const description =
			result.exitCode !== null
				? (CLI_EXIT_CODE_DESCRIPTIONS[result.exitCode] ??
					`exit code ${result.exitCode}`)
				: "unknown error";
		const stderrDetail = result.stderr.trim();
		const detail = stderrDetail ? ` (${firstLine(stderrDetail)})` : "";
		const formatted = `tsqlrefine: format failed - ${description}${detail}`;

		void connection.window.showWarningMessage(formatted);
		notificationManager.warn(formatted);
		return null;
	}

	const formattedText = result.stdout;

	if (formattedText === documentText) {
		return [];
	}

	return [createFullDocumentEdit(document, formattedText)];
}

async function handleFormatError(
	error: unknown,
	deps: FormatOperationDeps,
): Promise<null> {
	await handleOperationError(error, deps, "format");
	return null;
}
