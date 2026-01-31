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
import { runFixer } from "./runFixer";

export type FixOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	fixStateManager: DocumentStateManager;
};

export async function executeFix(
	context: DocumentContext,
	document: TextDocument,
	deps: FixOperationDeps,
): Promise<TextEdit[] | null> {
	const { connection, notificationManager, fixStateManager } = deps;
	const {
		uri,
		filePath,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
	} = context;

	const controller = new AbortController();
	fixStateManager.setInFlight(uri, controller);

	const targetFilePath = resolveTargetFilePath(filePath);

	logOperationContext(notificationManager, {
		operation: "Fix",
		uri,
		filePath,
		cwd,
		configPath: effectiveConfigPath,
	});

	let result: ProcessRunResult;
	try {
		result = await runFixer({
			filePath: targetFilePath,
			cwd,
			settings: effectiveSettings,
			signal: controller.signal,
			stdin: documentText,
		});
	} catch (error) {
		fixStateManager.clearInFlight(uri);
		return await handleFixError(error, deps);
	}

	if (fixStateManager.isCurrentInFlight(uri, controller)) {
		fixStateManager.clearInFlight(uri);
	}

	if (result.timedOut) {
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage("tsqlrefine: fix timed out.");
		notificationManager.warn("tsqlrefine: fix timed out.");
		return null;
	}

	if (controller.signal.aborted || result.cancelled) {
		return null;
	}

	if (result.stderr.trim()) {
		notificationManager.warn(`tsqlrefine fix stderr: ${result.stderr}`);
	}

	if (result.exitCode !== 0) {
		const errorMessage =
			result.stderr.trim() || `Exit code: ${result.exitCode}`;
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage(
			`tsqlrefine: fix failed (${firstLine(errorMessage)})`,
		);
		notificationManager.warn(
			`tsqlrefine: fix failed with exit code ${result.exitCode}`,
		);
		return null;
	}

	const fixedText = result.stdout;

	if (fixedText === documentText) {
		return [];
	}

	return [createFullDocumentEdit(document, fixedText)];
}

async function handleFixError(
	error: unknown,
	deps: FixOperationDeps,
): Promise<null> {
	await handleOperationError(error, deps, "fix");
	return null;
}
