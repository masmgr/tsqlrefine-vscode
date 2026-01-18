import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { defaultSettings, type TsqllintSettings } from "./config/settings";
import { parseOutput } from "./lint/parseOutput";
import { runTsqllint } from "./lint/runTsqllint";
import {
	LintScheduler,
	type LintReason,
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
});

connection.onDidChangeConfiguration(async () => {
	await refreshSettings();
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
	"tsqllint/lintDocument",
	async (params: { uri: string }) => {
		const issues = await requestLint(params.uri, "manual", null);
		return { ok: issues >= 0, issues: Math.max(0, issues) };
	},
);

connection.onNotification(
	"tsqllint/clearDiagnostics",
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
			section: "tsqllint",
		})) ?? {};
	settings = normalizeSettings({
		...defaultSettings,
		...config,
	});
}

async function handleDidChangeContent(document: TextDocument): Promise<void> {
	try {
		const docSettings = await getSettingsForDocument(document.uri);
		if (!docSettings.runOnType) {
			return;
		}
		requestLint(document.uri, "type", document.version, docSettings.debounceMs);
	} catch (error) {
		connection.console.error(
			`tsqllint: failed to react to change (${String(error)})`,
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
			`tsqllint: failed to react to save (${String(error)})`,
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
			`tsqllint: failed to react to open (${String(error)})`,
		);
	}
}

async function getSettingsForDocument(uri: string): Promise<TsqllintSettings> {
	const scopedConfig = ((await connection.workspace.getConfiguration({
		scopeUri: uri,
		section: "tsqllint",
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
	const cwd = resolveCwd(filePath || undefined);
	const controller = new AbortController();
	inFlightByUri.set(uri, controller);

	let tempInfo: { dir: string; filePath: string } | null = null;
	let targetFilePath = filePath;
	const isSavedFile = isSaved(document);

	if (!isSavedFile) {
		tempInfo = await createTempFile(document.getText());
		targetFilePath = tempInfo.filePath;
	}

	const documentSettings = await getSettingsForDocument(uri);

	let result: LintRunResult;
	try {
		result = await runTsqllint({
			filePath: targetFilePath,
			cwd,
			settings: documentSettings,
			signal: controller.signal,
		});
	} catch (error) {
		inFlightByUri.delete(uri);
		await notifyRunFailure(error);
		connection.sendDiagnostics({ uri, diagnostics: [] });
		await cleanupTemp(tempInfo);
		return -1;
	}

	if (inFlightByUri.get(uri) === controller) {
		inFlightByUri.delete(uri);
	}

	if (result.timedOut) {
		await connection.window.showWarningMessage("tsqllint: lint timed out.");
		connection.console.warn("tsqllint: lint timed out.");
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
		lines: document.getText().split(/\r?\n/),
		...(tempInfo ? { targetPaths: [tempInfo.filePath] } : {}),
	});

	connection.sendDiagnostics({ uri, diagnostics });
	await cleanupTemp(tempInfo);
	return diagnostics.length;
}

function resolveCwd(filePath: string | undefined): string {
	if (workspaceFolders.length === 0) {
		return filePath ? path.dirname(filePath) : process.cwd();
	}

	if (filePath) {
		for (const folder of workspaceFolders) {
			const normalized = path.resolve(folder);
			if (path.resolve(filePath).startsWith(normalized)) {
				return normalized;
			}
		}
	}

	return (
		workspaceFolders[0] ?? (filePath ? path.dirname(filePath) : process.cwd())
	);
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
): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-"));
	const filePath = path.join(dir, "untitled.sql");
	await fs.writeFile(filePath, content, "utf8");
	return { dir, filePath };
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
			`tsqllint: failed to remove temp dir (${String(error)})`,
		);
	}
}

async function notifyRunFailure(error: unknown): Promise<void> {
	const message = String(error);
	await connection.window.showWarningMessage(
		`tsqllint: failed to run (${message})`,
	);
	connection.console.warn(`tsqllint: failed to run (${message})`);
}

async function notifyStderr(stderr: string): Promise<void> {
	const trimmed = stderr.trim();
	if (!trimmed) {
		return;
	}
	await connection.window.showWarningMessage(`tsqllint: ${firstLine(trimmed)}`);
	connection.console.warn(trimmed);
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}
