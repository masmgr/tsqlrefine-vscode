import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	createConnection,
	DiagnosticSeverity,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { resolveConfigPath } from "./config/resolveConfigPath";
import { defaultSettings, type TsqllintSettings } from "./config/settings";
import { parseOutput } from "./lint/parseOutput";
import { runTsqllint, verifyTsqllintInstallation } from "./lint/runTsqllint";
import {
	type LintReason,
	LintScheduler,
	type PendingLint,
} from "./lint/scheduler";
import type { LintRunResult } from "./lint/types";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceFolders: string[] = [];
let settings: TsqllintSettings = defaultSettings;

const inFlightByUri = new Map<string, AbortController>();
const savedVersionByUri = new Map<string, number>();
const maxConcurrentRuns = 4;
const scheduler = new LintScheduler({
	maxConcurrentRuns,
	getDocumentVersion: (uri) => {
		const document = documents.get(uri);
		return document ? document.version : null;
	},
	runLint: (uri, pending) => runLintWithCancel(uri, pending),
});

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
		},
	};
});

connection.onInitialized(async () => {
	await refreshSettings();
	await verifyInstallation();
});

connection.onDidChangeConfiguration(async () => {
	const previousPath = settings.path;
	await refreshSettings();

	// Re-verify if path setting changed
	if (previousPath !== settings.path) {
		await verifyInstallation();
	}
});

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
	cancelInFlight(uri);
	savedVersionByUri.delete(uri);
	connection.sendDiagnostics({ uri, diagnostics: [] });
});

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
			cancelInFlight(uri);
			savedVersionByUri.delete(uri);
			connection.sendDiagnostics({ uri, diagnostics: [] });
		}
	},
);

documents.listen(connection);
connection.listen();

async function refreshSettings(): Promise<void> {
	const config =
		(await connection.workspace.getConfiguration({
			section: "tsqlrefine",
		})) ?? {};
	settings = normalizeSettings({
		...defaultSettings,
		...config,
	});
}

async function verifyInstallation(): Promise<void> {
	const result = await verifyTsqllintInstallation(settings);

	if (!result.available) {
		const message = result.message || "tsqlrefine not found";
		await maybeNotifyMissingTsqllint(message);
		connection.console.warn(`[startup] ${message}`);
	} else {
		connection.console.log("[startup] tsqlrefine installation verified");
	}
}

async function handleDidChangeContent(document: TextDocument): Promise<void> {
	try {
		const docSettings = await getSettingsForDocument(document.uri);
		if (!docSettings.runOnType) {
			return;
		}
		cancelInFlight(document.uri);
		requestLint(document.uri, "type", document.version, docSettings.debounceMs);
	} catch (error) {
		connection.console.error(
			`tsqlrefine: failed to react to change (${String(error)})`,
		);
	}
}

async function handleDidSave(document: TextDocument): Promise<void> {
	try {
		const uri = document.uri;
		savedVersionByUri.set(uri, document.version);
		const docSettings = await getSettingsForDocument(uri);
		if (docSettings.runOnSave) {
			requestLint(uri, "save", document.version);
		}
	} catch (error) {
		connection.console.error(
			`tsqlrefine: failed to react to save (${String(error)})`,
		);
	}
}

async function handleDidOpen(document: TextDocument): Promise<void> {
	try {
		const uri = document.uri;
		if (URI.parse(uri).scheme === "file") {
			savedVersionByUri.set(uri, document.version);
		}

		const docSettings = await getSettingsForDocument(uri);
		if (docSettings.runOnOpen) {
			requestLint(uri, "open", document.version);
		}
	} catch (error) {
		connection.console.error(
			`tsqlrefine: failed to react to open (${String(error)})`,
		);
	}
}

async function getSettingsForDocument(uri: string): Promise<TsqllintSettings> {
	const scopedConfig = ((await connection.workspace.getConfiguration({
		scopeUri: uri,
		section: "tsqlrefine",
	})) ?? {}) as Partial<TsqllintSettings>;
	return normalizeSettings({
		...defaultSettings,
		...settings,
		...scopedConfig,
	});
}

function normalizeSettings(value: TsqllintSettings): TsqllintSettings {
	const normalized = { ...value };
	if (normalized.rangeMode !== "character" && normalized.rangeMode !== "line") {
		normalized.rangeMode = "character";
	}
	if (
		!Number.isFinite(normalized.maxFileSizeKb) ||
		normalized.maxFileSizeKb < 0
	) {
		normalized.maxFileSizeKb = 0;
	}
	return normalized;
}

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

function cancelInFlight(uri: string): void {
	const controller = inFlightByUri.get(uri);
	if (controller) {
		controller.abort();
		inFlightByUri.delete(uri);
	}
}

async function runLintWithCancel(
	uri: string,
	pending: PendingLint,
): Promise<number> {
	cancelInFlight(uri);
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

	const documentSettings = await getSettingsForDocument(uri);
	const effectiveConfigPath = await resolveConfigPath({
		configuredConfigPath: documentSettings.configPath,
		filePath: filePath || null,
		workspaceRoot,
	});
	const effectiveSettings: TsqllintSettings =
		typeof effectiveConfigPath === "string" && effectiveConfigPath.trim()
			? { ...documentSettings, configPath: effectiveConfigPath }
			: documentSettings;

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
			connection.console.log(
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
	inFlightByUri.set(uri, controller);

	const documentText = document.getText();
	const tempInfo = await createTempFile(documentText, filePath);
	const targetFilePath = tempInfo.filePath;

	connection.console.log(`[runLintNow] URI: ${uri}`);
	connection.console.log(`[runLintNow] File path: ${filePath}`);
	connection.console.log(`[runLintNow] Target file path: ${targetFilePath}`);
	connection.console.log(`[runLintNow] CWD: ${cwd}`);
	connection.console.log(`[runLintNow] Is saved: ${isSavedFile}`);
	connection.console.log(
		`[runLintNow] Config path: ${effectiveConfigPath ?? "(tsqlrefine default)"}`,
	);

	let result: LintRunResult;
	try {
		result = await runTsqllint({
			filePath: targetFilePath,
			cwd,
			settings: effectiveSettings,
			signal: controller.signal,
		});
	} catch (error) {
		inFlightByUri.delete(uri);
		const message = firstLine(String(error));
		if (isMissingTsqllintError(message)) {
			await maybeNotifyMissingTsqllint(message);
			connection.console.warn(`tsqlrefine: ${message}`);
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
			await notifyRunFailure(error);
			connection.sendDiagnostics({ uri, diagnostics: [] });
		}
		await cleanupTemp(tempInfo);
		return -1;
	}

	if (inFlightByUri.get(uri) === controller) {
		inFlightByUri.delete(uri);
	}

	if (result.timedOut) {
		await connection.window.showWarningMessage("tsqlrefine: lint timed out.");
		connection.console.warn("tsqlrefine: lint timed out.");
		connection.sendDiagnostics({ uri, diagnostics: [] });
		await cleanupTemp(tempInfo);
		return -1;
	}

	if (controller.signal.aborted || result.cancelled) {
		await cleanupTemp(tempInfo);
		return -1;
	}

	if (result.stderr.trim()) {
		await notifyStderr(result.stderr);
	}

	const diagnostics = parseOutput({
		stdout: result.stdout,
		uri,
		cwd,
		lines: documentText.split(/\r?\n/),
		targetPaths: [tempInfo.filePath],
		logger: {
			log: (message: string) => connection.console.log(message),
		},
	});

	connection.sendDiagnostics({ uri, diagnostics });
	await cleanupTemp(tempInfo);
	return diagnostics.length;
}

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
	const savedVersion = savedVersionByUri.get(document.uri);
	return savedVersion !== undefined && savedVersion === document.version;
}

async function createTempFile(
	content: string,
	originalPath?: string,
): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-"));
	const filePath = path.join(dir, resolveTempFileName(originalPath));
	await fs.writeFile(filePath, content, "utf8");
	return { dir, filePath };
}

function resolveTempFileName(originalPath?: string): string {
	if (!originalPath) {
		return "untitled.sql";
	}
	const baseName = path.basename(originalPath);
	const extension = path.extname(baseName);
	if (extension) {
		return baseName;
	}
	return `${baseName}.sql`;
}

async function cleanupTemp(
	tempInfo: { dir: string; filePath: string } | null,
): Promise<void> {
	if (!tempInfo) {
		return;
	}
	try {
		await fs.rm(tempInfo.dir, { recursive: true, force: true });
	} catch (error) {
		connection.console.warn(
			`tsqlrefine: failed to remove temp dir (${String(error)})`,
		);
	}
}

async function notifyRunFailure(error: unknown): Promise<void> {
	const message = String(error);
	await connection.window.showWarningMessage(
		`tsqlrefine: failed to run (${message})`,
	);
	connection.console.warn(`tsqlrefine: failed to run (${message})`);
}

const missingTsqllintNoticeCooldownMs = 5 * 60 * 1000;
let lastMissingTsqllintNoticeAtMs = 0;

async function maybeNotifyMissingTsqllint(message: string): Promise<void> {
	const now = Date.now();
	if (now - lastMissingTsqllintNoticeAtMs < missingTsqllintNoticeCooldownMs) {
		return;
	}
	lastMissingTsqllintNoticeAtMs = now;
	const action = await connection.window.showWarningMessage(
		`tsqlrefine: ${message}`,
		{ title: "Open Install Guide" },
	);
	if (action?.title === "Open Install Guide") {
		connection.sendNotification("tsqlrefine/openInstallGuide");
	}
}

function isMissingTsqllintError(message: string): boolean {
	const normalized = message.toLowerCase();
	return (
		normalized.includes("tsqlrefine not found") ||
		normalized.includes("tsqlrefine.path not found") ||
		normalized.includes("tsqlrefine.path is not a file")
	);
}

async function notifyStderr(stderr: string): Promise<void> {
	const trimmed = stderr.trim();
	if (!trimmed) {
		return;
	}
	await connection.window.showWarningMessage(
		`tsqlrefine: ${firstLine(trimmed)}`,
	);
	connection.console.warn(trimmed);
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}
