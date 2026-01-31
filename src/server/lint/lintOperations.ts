import * as path from "node:path";
import type { Connection, Diagnostic } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../shared/documentContext";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import { type EndOfLine, normalizeLineEndings } from "./decodeOutput";
import { parseOutput } from "./parseOutput";
import { runTsqllint } from "./runTsqllint";
import type { LintReason } from "./scheduler";
import type { LintRunResult } from "./types";

export type LintOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	lintStateManager: DocumentStateManager;
};

export type LintResult = {
	diagnosticsCount: number;
	success: boolean;
};

export async function executeLint(
	context: DocumentContext,
	document: TextDocument,
	reason: LintReason,
	deps: LintOperationDeps,
): Promise<LintResult> {
	const { connection, notificationManager, lintStateManager } = deps;
	const {
		uri,
		filePath,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
		isSavedFile,
	} = context;

	// Check file size limit
	const maxBytes = maxFileSizeBytes(effectiveSettings.maxFileSizeKb);
	if (maxBytes !== null && reason !== "manual") {
		const sizeBytes = getDocumentSizeBytes(document);
		if (sizeBytes > maxBytes) {
			const sizeKb = Math.ceil(sizeBytes / 1024);
			notificationManager.log(
				`[executeLint] Skipping lint: file is ${sizeKb}KB > maxFileSizeKb=${effectiveSettings.maxFileSizeKb}`,
			);
			connection.sendDiagnostics({
				uri,
				diagnostics: [
					createFileTooLargeDiagnostic(sizeKb, effectiveSettings.maxFileSizeKb),
				],
			});
			return { diagnosticsCount: 0, success: true };
		}
	}

	const controller = new AbortController();
	lintStateManager.setInFlight(uri, controller);

	const useStdin = !isSavedFile;
	const targetFilePath = useStdin ? filePath || "untitled.sql" : filePath;

	logLintContext(
		notificationManager,
		uri,
		filePath,
		targetFilePath,
		cwd,
		isSavedFile,
		useStdin,
		effectiveConfigPath,
	);

	let result: LintRunResult;
	try {
		result = await runTsqllint({
			filePath: targetFilePath,
			cwd,
			settings: effectiveSettings,
			signal: controller.signal,
			stdin: useStdin ? documentText : null,
		});
	} catch (error) {
		lintStateManager.clearInFlight(uri);
		return await handleLintError(error, uri, deps);
	}

	if (lintStateManager.isCurrentInFlight(uri, controller)) {
		lintStateManager.clearInFlight(uri);
	}

	if (result.timedOut) {
		await connection.window.showWarningMessage("tsqlrefine: lint timed out.");
		notificationManager.warn("tsqlrefine: lint timed out.");
		connection.sendDiagnostics({ uri, diagnostics: [] });
		return { diagnosticsCount: -1, success: false };
	}

	if (controller.signal.aborted || result.cancelled) {
		return { diagnosticsCount: -1, success: false };
	}

	if (result.stderr.trim()) {
		await notificationManager.notifyStderr(result.stderr);
	}

	// Detect EOL from document and normalize stdout line endings
	const eol: EndOfLine = documentText.includes("\r\n") ? "CRLF" : "LF";
	const normalizedStdout = normalizeLineEndings(result.stdout, eol);

	const targetPaths = useStdin
		? [targetFilePath, "untitled.sql", path.resolve(cwd, "untitled.sql")]
		: [targetFilePath];

	const diagnostics = parseOutput({
		stdout: normalizedStdout,
		uri,
		cwd,
		lines: documentText.split(/\r?\n/),
		targetPaths,
		logger: {
			log: (message: string) => notificationManager.log(message),
		},
	});

	connection.sendDiagnostics({ uri, diagnostics });
	return { diagnosticsCount: diagnostics.length, success: true };
}

function maxFileSizeBytes(maxFileSizeKb: number): number | null {
	if (!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0) {
		return null;
	}
	return Math.floor(maxFileSizeKb * 1024);
}

function getDocumentSizeBytes(document: TextDocument): number {
	return Buffer.byteLength(document.getText(), "utf8");
}

function createFileTooLargeDiagnostic(
	sizeKb: number,
	maxFileSizeKb: number,
): Diagnostic {
	return {
		message: `tsqlrefine: lint skipped (file too large: ${sizeKb}KB > maxFileSizeKb=${maxFileSizeKb}). Run "TSQLRefine: Run" to lint manually or increase the limit.`,
		severity: DiagnosticSeverity.Information,
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
		},
		source: "tsqlrefine",
		code: "lint-skipped-file-too-large",
	};
}

function logLintContext(
	notificationManager: NotificationManager,
	uri: string,
	filePath: string,
	targetFilePath: string,
	cwd: string,
	isSavedFile: boolean,
	useStdin: boolean,
	effectiveConfigPath: string | undefined,
): void {
	notificationManager.log(`[executeLint] URI: ${uri}`);
	notificationManager.log(`[executeLint] File path: ${filePath}`);
	notificationManager.log(`[executeLint] Target file path: ${targetFilePath}`);
	notificationManager.log(`[executeLint] CWD: ${cwd}`);
	notificationManager.log(`[executeLint] Is saved: ${isSavedFile}`);
	notificationManager.log(`[executeLint] Using stdin: ${useStdin}`);
	notificationManager.log(
		`[executeLint] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
	);
}

async function handleLintError(
	error: unknown,
	uri: string,
	deps: LintOperationDeps,
): Promise<LintResult> {
	const { connection, notificationManager } = deps;
	const message = firstLine(String(error));

	if (notificationManager.isMissingTsqllintError(message)) {
		await notificationManager.maybeNotifyMissingTsqllint(message);
		notificationManager.warn(`tsqlrefine: ${message}`);
		connection.sendDiagnostics({
			uri,
			diagnostics: [createMissingTsqllintDiagnostic(message)],
		});
	} else {
		await notificationManager.notifyRunFailure(error);
		connection.sendDiagnostics({ uri, diagnostics: [] });
	}
	return { diagnosticsCount: -1, success: false };
}

function createMissingTsqllintDiagnostic(message: string): Diagnostic {
	return {
		message: `tsqlrefine: ${message}`,
		severity: DiagnosticSeverity.Error,
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 },
		},
		source: "tsqlrefine",
		code: "tsqlrefine-not-found",
	};
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}
