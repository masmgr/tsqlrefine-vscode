import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	createConnection,
	DiagnosticSeverity,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
	type DocumentFormattingParams,
	type TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { MAX_CONCURRENT_RUNS } from "./config/constants";
import { resolveConfigPath } from "./config/resolveConfigPath";
import type { TsqllintSettings } from "./config/settings";
import { runFormatter, type FormatResult } from "./format/runFormatter";
import { parseOutput } from "./lint/parseOutput";
import { runTsqllint, verifyTsqllintInstallation } from "./lint/runTsqllint";
import {
	type LintReason,
	LintScheduler,
	type PendingLint,
} from "./lint/scheduler";
import type { LintRunResult } from "./lint/types";
import { DocumentStateManager } from "./state/documentStateManager";
import { NotificationManager } from "./state/notificationManager";
import { SettingsManager } from "./state/settingsManager";

// LSP connection and document manager
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// State managers
const settingsManager = new SettingsManager(connection);
const notificationManager = new NotificationManager(connection);
const lintStateManager = new DocumentStateManager();
const formatStateManager = new DocumentStateManager();

// Workspace state
let workspaceFolders: string[] = [];

// Lint scheduler
const scheduler = new LintScheduler({
	maxConcurrentRuns: MAX_CONCURRENT_RUNS,
	getDocumentVersion: (uri) => {
		const document = documents.get(uri);
		return document ? document.version : null;
	},
	runLint: (uri, pending) => runLintWithCancel(uri, pending),
});

// ============================================================================
// LSP Lifecycle Handlers
// ============================================================================

connection.onInitialize((params) => {
	workspaceFolders =
		params.workspaceFolders?.map((folder) => URI.parse(folder.uri).fsPath) ??
		[];
	return {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Incremental,
				save: { includeText: false },
			},
			documentFormattingProvider: true,
		},
	};
});

connection.onInitialized(async () => {
	await settingsManager.refreshSettings();
	await verifyInstallation();
});

connection.onDidChangeConfiguration(async () => {
	const previousPath = settingsManager.getSettings().path;
	await settingsManager.refreshSettings();

	// Re-verify if path setting changed
	if (previousPath !== settingsManager.getSettings().path) {
		await verifyInstallation();
	}
});

// ============================================================================
// Document Event Handlers
// ============================================================================

documents.onDidChangeContent((change) => {
	void handleDidChangeContent(change.document);
});

documents.onDidOpen((change) => {
	void handleDidOpen(change.document);
});

documents.onDidSave((change) => {
	void handleDidSave(change.document);
});

documents.onDidClose((change) => {
	const uri = change.document.uri;
	scheduler.clear(uri);
	lintStateManager.clearAll(uri);
	connection.sendDiagnostics({ uri, diagnostics: [] });
});

// ============================================================================
// LSP Request/Notification Handlers
// ============================================================================

connection.onRequest(
	"tsqlrefine/lintDocument",
	async (params: { uri: string }) => {
		const issues = await requestLint(params.uri, "manual", null);
		return { ok: issues >= 0, issues: Math.max(0, issues) };
	},
);

connection.onNotification(
	"tsqlrefine/clearDiagnostics",
	(params: { uris: string[] }) => {
		for (const uri of params.uris) {
			scheduler.clear(uri);
			lintStateManager.clearAll(uri);
			connection.sendDiagnostics({ uri, diagnostics: [] });
		}
	},
);

connection.onDocumentFormatting(
	async (params: DocumentFormattingParams): Promise<TextEdit[] | null> => {
		return await formatDocument(params.textDocument.uri);
	},
);

connection.onRequest(
	"tsqlrefine/formatDocument",
	async (params: { uri: string }): Promise<{ ok: boolean; error?: string }> => {
		const edits = await formatDocument(params.uri);
		if (edits === null) {
			return { ok: false, error: "Format failed" };
		}
		return { ok: true };
	},
);

// Start listening
documents.listen(connection);
connection.listen();

// ============================================================================
// Document Event Handler Implementations
// ============================================================================

async function verifyInstallation(): Promise<void> {
	const result = await verifyTsqllintInstallation(
		settingsManager.getSettings(),
	);

	if (!result.available) {
		const message = result.message || "tsqlrefine not found";
		await notificationManager.maybeNotifyMissingTsqllint(message);
		notificationManager.warn(`[startup] ${message}`);
	} else {
		notificationManager.log("[startup] tsqlrefine installation verified");
	}
}

async function handleDidChangeContent(document: TextDocument): Promise<void> {
	try {
		const docSettings = await settingsManager.getSettingsForDocument(
			document.uri,
		);
		if (!docSettings.runOnType) {
			return;
		}
		lintStateManager.cancelInFlight(document.uri);
		requestLint(document.uri, "type", document.version, docSettings.debounceMs);
	} catch (error) {
		notificationManager.error(
			`tsqlrefine: failed to react to change (${String(error)})`,
		);
	}
}

async function handleDidSave(document: TextDocument): Promise<void> {
	try {
		const uri = document.uri;
		lintStateManager.setSavedVersion(uri, document.version);
		const docSettings = await settingsManager.getSettingsForDocument(uri);
		if (docSettings.runOnSave) {
			requestLint(uri, "save", document.version);
		}
	} catch (error) {
		notificationManager.error(
			`tsqlrefine: failed to react to save (${String(error)})`,
		);
	}
}

async function handleDidOpen(document: TextDocument): Promise<void> {
	try {
		const uri = document.uri;
		if (URI.parse(uri).scheme === "file") {
			lintStateManager.setSavedVersion(uri, document.version);
		}

		const docSettings = await settingsManager.getSettingsForDocument(uri);
		if (docSettings.runOnOpen) {
			requestLint(uri, "open", document.version);
		}
	} catch (error) {
		notificationManager.error(
			`tsqlrefine: failed to react to open (${String(error)})`,
		);
	}
}

// ============================================================================
// Lint Operations
// ============================================================================

async function requestLint(
	uri: string,
	reason: LintReason,
	version: number | null,
	debounceMs?: number,
): Promise<number> {
	const document = documents.get(uri);
	if (!document) {
		return 0;
	}
	const finalVersion = version ?? document.version;
	return await scheduler.requestLint(uri, reason, finalVersion, debounceMs);
}

async function runLintWithCancel(
	uri: string,
	pending: PendingLint,
): Promise<number> {
	lintStateManager.cancelInFlight(uri);
	return await runLintNow(uri, pending.reason);
}

async function runLintNow(uri: string, reason: LintReason): Promise<number> {
	const document = documents.get(uri);
	if (!document) {
		return 0;
	}

	const parsedUri = URI.parse(uri);
	const filePath = parsedUri.fsPath;
	const workspaceRoot = resolveWorkspaceRoot(filePath || undefined);
	const cwd =
		workspaceRoot ?? (filePath ? path.dirname(filePath) : process.cwd());

	const documentSettings = await settingsManager.getSettingsForDocument(uri);
	const effectiveConfigPath = await resolveConfigPath({
		configuredConfigPath: documentSettings.configPath,
		filePath: filePath || null,
		workspaceRoot,
	});
	const effectiveSettings: TsqllintSettings =
		typeof effectiveConfigPath === "string" && effectiveConfigPath.trim()
			? { ...documentSettings, configPath: effectiveConfigPath }
			: documentSettings;

	const documentText = document.getText();
	const isSavedFile = isSaved(document);
	const maxBytes = maxFileSizeBytes(effectiveSettings.maxFileSizeKb);
	if (maxBytes !== null && reason !== "manual") {
		const sizeBytes = await getDocumentSizeBytes(
			document,
			filePath,
			isSavedFile,
		);
		if (sizeBytes > maxBytes) {
			const sizeKb = Math.ceil(sizeBytes / 1024);
			notificationManager.log(
				`[runLintNow] Skipping lint: file is ${sizeKb}KB > maxFileSizeKb=${effectiveSettings.maxFileSizeKb}`,
			);
			connection.sendDiagnostics({
				uri,
				diagnostics: [
					{
						message: `tsqlrefine: lint skipped (file too large: ${sizeKb}KB > maxFileSizeKb=${effectiveSettings.maxFileSizeKb}). Run "TSQLRefine: Run" to lint manually or increase the limit.`,
						severity: DiagnosticSeverity.Information,
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 0 },
						},
						source: "tsqlrefine",
						code: "lint-skipped-file-too-large",
					},
				],
			});
			return 0;
		}
	}

	const controller = new AbortController();
	lintStateManager.setInFlight(uri, controller);

	// Use stdin for unsaved files, file path for saved files
	const useStdin = !isSavedFile;
	const targetFilePath = useStdin ? filePath || "untitled.sql" : filePath;

	notificationManager.log(`[runLintNow] URI: ${uri}`);
	notificationManager.log(`[runLintNow] File path: ${filePath}`);
	notificationManager.log(`[runLintNow] Target file path: ${targetFilePath}`);
	notificationManager.log(`[runLintNow] CWD: ${cwd}`);
	notificationManager.log(`[runLintNow] Is saved: ${isSavedFile}`);
	notificationManager.log(`[runLintNow] Using stdin: ${useStdin}`);
	notificationManager.log(
		`[runLintNow] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
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
		const message = firstLine(String(error));
		if (notificationManager.isMissingTsqllintError(message)) {
			await notificationManager.maybeNotifyMissingTsqllint(message);
			notificationManager.warn(`tsqlrefine: ${message}`);
			connection.sendDiagnostics({
				uri,
				diagnostics: [
					{
						message: `tsqlrefine: ${message}`,
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 0 },
						},
						source: "tsqlrefine",
						code: "tsqlrefine-not-found",
					},
				],
			});
		} else {
			await notificationManager.notifyRunFailure(error);
			connection.sendDiagnostics({ uri, diagnostics: [] });
		}
		return -1;
	}

	if (lintStateManager.isCurrentInFlight(uri, controller)) {
		lintStateManager.clearInFlight(uri);
	}

	if (result.timedOut) {
		await connection.window.showWarningMessage("tsqlrefine: lint timed out.");
		notificationManager.warn("tsqlrefine: lint timed out.");
		connection.sendDiagnostics({ uri, diagnostics: [] });
		return -1;
	}

	if (controller.signal.aborted || result.cancelled) {
		return -1;
	}

	if (result.stderr.trim()) {
		await notificationManager.notifyStderr(result.stderr);
	}

	// When using stdin, also accept "untitled.sql" as a valid path in output
	// since the CLI may not know the actual file path.
	// We include both the raw name and the resolved path to handle path resolution.
	const targetPaths = useStdin
		? [targetFilePath, "untitled.sql", path.resolve(cwd, "untitled.sql")]
		: [targetFilePath];

	const diagnostics = parseOutput({
		stdout: result.stdout,
		uri,
		cwd,
		lines: documentText.split(/\r?\n/),
		targetPaths,
		logger: {
			log: (message: string) => notificationManager.log(message),
		},
	});

	connection.sendDiagnostics({ uri, diagnostics });
	return diagnostics.length;
}

// ============================================================================
// Format Operations
// ============================================================================

async function formatDocument(uri: string): Promise<TextEdit[] | null> {
	const document = documents.get(uri);
	if (!document) {
		return null;
	}

	// Cancel any in-flight format for this document
	formatStateManager.cancelInFlight(uri);

	const parsedUri = URI.parse(uri);
	const filePath = parsedUri.fsPath;
	const workspaceRoot = resolveWorkspaceRoot(filePath || undefined);
	const cwd =
		workspaceRoot ?? (filePath ? path.dirname(filePath) : process.cwd());

	const documentSettings = await settingsManager.getSettingsForDocument(uri);
	const effectiveConfigPath = await resolveConfigPath({
		configuredConfigPath: documentSettings.configPath,
		filePath: filePath || null,
		workspaceRoot,
	});
	const effectiveSettings: TsqllintSettings =
		typeof effectiveConfigPath === "string" && effectiveConfigPath.trim()
			? { ...documentSettings, configPath: effectiveConfigPath }
			: documentSettings;

	const documentText = document.getText();
	const targetFilePath = filePath || "untitled.sql";

	const controller = new AbortController();
	formatStateManager.setInFlight(uri, controller);

	notificationManager.log(`[formatDocument] URI: ${uri}`);
	notificationManager.log(`[formatDocument] File path: ${filePath}`);
	notificationManager.log(`[formatDocument] CWD: ${cwd}`);
	notificationManager.log(
		`[formatDocument] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
	);

	let result: FormatResult;
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

	// Exit code 0 means success
	// Exit code 2 means parse error - return null
	// Exit code 3 means config error - return null
	// Exit code 4 means runtime error - return null
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

	// If the formatted text is the same as the original, return empty array
	if (formattedText === documentText) {
		return [];
	}

	// Return a single TextEdit that replaces the entire document
	const lastLineIndex = document.lineCount - 1;
	const lastLine = document.getText({
		start: { line: lastLineIndex, character: 0 },
		end: { line: lastLineIndex, character: Number.MAX_SAFE_INTEGER },
	});

	return [
		{
			range: {
				start: { line: 0, character: 0 },
				end: { line: lastLineIndex, character: lastLine.length },
			},
			newText: formattedText,
		},
	];
}

// ============================================================================
// Utility Functions
// ============================================================================

function maxFileSizeBytes(maxFileSizeKb: number): number | null {
	if (!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0) {
		return null;
	}
	return Math.floor(maxFileSizeKb * 1024);
}

async function getDocumentSizeBytes(
	document: TextDocument,
	filePath: string | undefined,
	isSavedFile: boolean,
): Promise<number> {
	if (isSavedFile && filePath) {
		try {
			const stat = await fs.stat(filePath);
			if (stat.isFile()) {
				return stat.size;
			}
		} catch {
			// fall back to in-memory content
		}
	}
	return Buffer.byteLength(document.getText(), "utf8");
}

function resolveWorkspaceRoot(filePath: string | undefined): string | null {
	if (workspaceFolders.length === 0) {
		return null;
	}

	if (filePath) {
		const normalizedFilePath = path.resolve(filePath);
		for (const folder of workspaceFolders) {
			const normalizedFolder = path.resolve(folder);
			if (normalizedFilePath.startsWith(normalizedFolder)) {
				return normalizedFolder;
			}
		}
		return null;
	}

	return workspaceFolders[0] ?? null;
}

function isSaved(document: TextDocument): boolean {
	if (URI.parse(document.uri).scheme !== "file") {
		return false;
	}
	return lintStateManager.isSaved(document.uri, document.version);
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}
