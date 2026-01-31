import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
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
		await connection.window.showWarningMessage("tsqlrefine: format timed out.");
		notificationManager.warn("tsqlrefine: format timed out.");
		return null;
	}

	if (controller.signal.aborted || result.cancelled) {
		return null;
	}

	if (result.stderr.trim()) {
		notificationManager.warn(`tsqlrefine format stderr: ${result.stderr}`);
	}

	if (result.exitCode !== 0) {
		const errorMessage =
			result.stderr.trim() || `Exit code: ${result.exitCode}`;
		await connection.window.showWarningMessage(
			`tsqlrefine: format failed (${firstLine(errorMessage)})`,
		);
		notificationManager.warn(
			`tsqlrefine: format failed with exit code ${result.exitCode}`,
		);
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
