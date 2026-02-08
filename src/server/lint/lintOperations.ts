import * as path from "node:path";
import type { Connection, Diagnostic } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CLI_EXIT_CODE_DESCRIPTIONS } from "../config/constants";
import type { DocumentContext } from "../shared/documentContext";
import { logOperationContext } from "../shared/logging";
import { firstLine, resolveTargetFilePath } from "../shared/textUtils";
import type { ProcessRunResult } from "../shared/types";
import type { DocumentStateManager } from "../state/documentStateManager";
import type { NotificationManager } from "../state/notificationManager";
import { parseOutput } from "./parseOutput";
import { runLinter } from "./runLinter";
import type { LintReason } from "./scheduler";

export type LintOperationDeps = {
	connection: Connection;
	notificationManager: NotificationManager;
	lintStateManager: DocumentStateManager;
};

export type LintResult = {
	diagnosticsCount: number;
	success: boolean;
};

/**
 * Execute lint operation on a document.
 *
 * @param context - Document context containing URI, settings, and text
 * @param document - The TextDocument to lint
 * @param reason - The reason for linting (save, type, manual, open)
 * @param deps - Dependencies including connection and managers
 * @returns Lint result with diagnostics count and success status
 */
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

	const targetFilePath = resolveTargetFilePath(filePath);

	logOperationContext(notificationManager, {
		operation: "Lint",
		uri,
		filePath,
		cwd,
		configPath: effectiveConfigPath,
		targetFilePath,
		isSavedFile,
	});

	let result: ProcessRunResult;
	try {
		result = await runLinter({
			filePath: targetFilePath,
			cwd,
			settings: effectiveSettings,
			signal: controller.signal,
			stdin: documentText,
		});
	} catch (error) {
		lintStateManager.clearInFlight(uri);
		return await handleLintError(error, uri, deps);
	}

	if (lintStateManager.isCurrentInFlight(uri, controller)) {
		lintStateManager.clearInFlight(uri);
	}

	if (result.timedOut) {
		const formatted = "tsqlrefine: lint timed out";
		// Don't await - warning message may block in some environments
		void connection.window.showWarningMessage(formatted);
		notificationManager.warn(formatted);
		connection.sendDiagnostics({ uri, diagnostics: [] });
		return { diagnosticsCount: -1, success: false };
	}

	if (controller.signal.aborted || result.cancelled) {
		return { diagnosticsCount: -1, success: false };
	}

	if (result.stderr.trim()) {
		notificationManager.notifyStderr(result.stderr);
	}

	// Exit code 0 = no violations, 1 = violations found (both are success)
	// Exit code 2 = parse error, 3 = config error, 4 = runtime exception
	if (result.exitCode !== null && result.exitCode >= 2) {
		const description =
			CLI_EXIT_CODE_DESCRIPTIONS[result.exitCode] ??
			`exit code ${result.exitCode}`;
		const stderrDetail = result.stderr.trim();
		const detail = stderrDetail ? ` (${firstLine(stderrDetail)})` : "";
		const formatted = `tsqlrefine: lint failed - ${description}${detail}`;

		void connection.window.showWarningMessage(formatted);
		notificationManager.warn(formatted);
		connection.sendDiagnostics({ uri, diagnostics: [] });
		return { diagnosticsCount: -1, success: false };
	}

	const targetPaths = [
		targetFilePath,
		"untitled.sql",
		path.resolve(cwd, "untitled.sql"),
	];

	const diagnostics = parseOutput({
		stdout: result.stdout,
		uri,
		cwd,
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

async function handleLintError(
	error: unknown,
	uri: string,
	deps: LintOperationDeps,
): Promise<LintResult> {
	const { connection, notificationManager } = deps;
	const message = firstLine(String(error));

	if (notificationManager.isMissingTsqlRefineError(message)) {
		await notificationManager.maybeNotifyMissingTsqlRefine(message);
		notificationManager.warn(`tsqlrefine: ${message}`);
		connection.sendDiagnostics({
			uri,
			diagnostics: [createMissingTsqlRefineDiagnostic(message)],
		});
	} else {
		notificationManager.notifyRunFailure(error);
		connection.sendDiagnostics({ uri, diagnostics: [] });
	}
	return { diagnosticsCount: -1, success: false };
}

function createMissingTsqlRefineDiagnostic(message: string): Diagnostic {
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
