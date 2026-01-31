import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../shared/documentContext";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import type { ProcessRunResult } from "../shared/types";
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

	const targetFilePath = filePath || "untitled.sql";

	logFormatContext(
		notificationManager,
		uri,
		filePath,
		cwd,
		effectiveConfigPath,
	);

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

function logFormatContext(
	notificationManager: NotificationManager,
	uri: string,
	filePath: string,
	cwd: string,
	effectiveConfigPath: string | undefined,
): void {
	notificationManager.log(`[executeFormat] URI: ${uri}`);
	notificationManager.log(`[executeFormat] File path: ${filePath}`);
	notificationManager.log(`[executeFormat] CWD: ${cwd}`);
	notificationManager.log(
		`[executeFormat] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
	);
}

async function handleFormatError(
	error: unknown,
	deps: FormatOperationDeps,
): Promise<null> {
	const { connection, notificationManager } = deps;
	const message = firstLine(String(error));

	if (notificationManager.isMissingTsqllintError(message)) {
		await notificationManager.maybeNotifyMissingTsqllint(message);
		notificationManager.warn(`tsqlrefine format: ${message}`);
	} else {
		await connection.window.showWarningMessage(
			`tsqlrefine: format failed (${message})`,
		);
		notificationManager.warn(`tsqlrefine: format failed (${message})`);
	}
	return null;
}

function createFullDocumentEdit(
	document: TextDocument,
	newText: string,
): TextEdit {
	const lastLineIndex = document.lineCount - 1;
	const lastLine = document.getText({
		start: { line: lastLineIndex, character: 0 },
		end: { line: lastLineIndex, character: Number.MAX_SAFE_INTEGER },
	});

	return {
		range: {
			start: { line: 0, character: 0 },
			end: { line: lastLineIndex, character: lastLine.length },
		},
		newText,
	};
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}
