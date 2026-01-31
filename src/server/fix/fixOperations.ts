import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../shared/documentContext";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import type { ProcessRunResult } from "../shared/types";
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

	const targetFilePath = filePath || "untitled.sql";

	logFixContext(notificationManager, uri, filePath, cwd, effectiveConfigPath);

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
		await connection.window.showWarningMessage("tsqlrefine: fix timed out.");
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
		await connection.window.showWarningMessage(
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

function logFixContext(
	notificationManager: NotificationManager,
	uri: string,
	filePath: string,
	cwd: string,
	effectiveConfigPath: string | undefined,
): void {
	notificationManager.log(`[executeFix] URI: ${uri}`);
	notificationManager.log(`[executeFix] File path: ${filePath}`);
	notificationManager.log(`[executeFix] CWD: ${cwd}`);
	notificationManager.log(
		`[executeFix] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
	);
}

async function handleFixError(
	error: unknown,
	deps: FixOperationDeps,
): Promise<null> {
	const { connection, notificationManager } = deps;
	const message = firstLine(String(error));

	if (notificationManager.isMissingTsqllintError(message)) {
		await notificationManager.maybeNotifyMissingTsqllint(message);
		notificationManager.warn(`tsqlrefine fix: ${message}`);
	} else {
		await connection.window.showWarningMessage(
			`tsqlrefine: fix failed (${message})`,
		);
		notificationManager.warn(`tsqlrefine: fix failed (${message})`);
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
