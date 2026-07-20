import * as path from "node:path";
import type { Connection, Diagnostic } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../shared/documentContext";
import { MissingTsqlRefineError } from "../shared/errors";
import { logOperationContext } from "../shared/logging";
import {
	type InFlightExecution,
	reportCliFailure,
	runWithInFlight,
} from "../shared/operationExecution";
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
	runner?: typeof runLinter;
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
	const runner = deps.runner ?? runLinter;
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
			notificationManager.debug(
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

	let execution: InFlightExecution<ProcessRunResult>;
	try {
		execution = await runWithInFlight(lintStateManager, uri, (controller) =>
			runner({
				cwd,
				settings: effectiveSettings,
				signal: controller.signal,
				stdin: documentText,
			}),
		);
	} catch (error) {
		return await handleLintError(error, uri, deps);
	}

	const { controller, result } = execution;
	if (
		reportCliFailure({
			result,
			operation: "lint",
			deps,
			successExitCodes: [0, 1],
			cancelled: controller.signal.aborted,
		})
	) {
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
			debug: (message: string | (() => string)) =>
				notificationManager.debug(message),
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
	const message = firstLine(
		error instanceof Error ? error.message : String(error),
	);

	if (error instanceof MissingTsqlRefineError) {
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
