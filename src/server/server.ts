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

type LintReason = "save" | "type" | "manual";
type PendingLint = { reason: LintReason; version: number | null; fix: boolean };

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let workspaceFolders: string[] = [];
let settings: TsqllintSettings = defaultSettings;

const inFlightByUri = new Map<string, AbortController>();
const pendingByUri = new Map<string, PendingLint>();
const debounceTimerByUri = new Map<string, NodeJS.Timeout>();
const savedVersionByUri = new Map<string, number>();
const queuedUris: string[] = [];
const maxConcurrentRuns = 4;
let activeRuns = 0;

connection.onInitialize((params) => {
	workspaceFolders =
		params.workspaceFolders?.map((folder) => URI.parse(folder.uri).fsPath) ??
		[];
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
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
	if (!settings.runOnType) {
		return;
	}
	const uri = change.document.uri;
	requestLint(uri, "type", false, change.document.version);
});

documents.onDidOpen((change) => {
	const uri = change.document.uri;
	if (URI.parse(uri).scheme === "file") {
		savedVersionByUri.set(uri, change.document.version);
	}
});

documents.onDidSave((change) => {
	const uri = change.document.uri;
	savedVersionByUri.set(uri, change.document.version);
	if (settings.fixOnSave) {
		requestLint(uri, "save", true, change.document.version);
		return;
	}
	if (settings.runOnSave) {
		requestLint(uri, "save", false, change.document.version);
	}
});

documents.onDidClose((change) => {
	const uri = change.document.uri;
	clearDebounce(uri);
	cancelInFlight(uri);
	pendingByUri.delete(uri);
	savedVersionByUri.delete(uri);
	removeFromQueue(uri);
	connection.sendDiagnostics({ uri, diagnostics: [] });
});

connection.onRequest(
	"tsqllint/lintDocument",
	async (params: { uri: string }) => {
		const issues = await requestLint(
			params.uri,
			"manual",
			false,
			null,
		);
		return { ok: issues >= 0, issues: Math.max(0, issues) };
	},
);

connection.onRequest(
	"tsqllint/fixDocument",
	async (params: { uri: string }) => {
		const result = await requestLint(params.uri, "manual", true, null);
		const ok = result >= 0;
		return { ok };
	},
);

connection.onNotification(
	"tsqllint/clearDiagnostics",
	(params: { uris: string[] }) => {
		for (const uri of params.uris) {
			clearDebounce(uri);
			cancelInFlight(uri);
			pendingByUri.delete(uri);
			savedVersionByUri.delete(uri);
			removeFromQueue(uri);
			connection.sendDiagnostics({ uri, diagnostics: [] });
		}
	},
);

documents.listen(connection);
connection.listen();

async function refreshSettings(): Promise<void> {
	const config =
		(await connection.workspace.getConfiguration("tsqllint")) ?? {};
	settings = {
		...defaultSettings,
		...config,
	};
	if (settings.rangeMode !== "character" && settings.rangeMode !== "line") {
		settings.rangeMode = "character";
	}
}

async function requestLint(
	uri: string,
	reason: LintReason,
	fix: boolean,
	version: number | null,
): Promise<number> {
	const document = documents.get(uri);
	if (!document) {
		return 0;
	}
	const finalVersion = version ?? document.version;
	pendingByUri.set(uri, { reason, version: finalVersion, fix });
	if (reason === "manual") {
		return await runLintWhenPossible(uri);
	}
	scheduleLint(uri, reason);
	return 0;
}

function scheduleLint(uri: string, reason: LintReason): void {
	clearDebounce(uri);
	if (reason !== "type") {
		void runLintIfReady(uri);
		return;
	}
	const timer = setTimeout(() => {
		debounceTimerByUri.delete(uri);
		void runLintIfReady(uri);
	}, settings.debounceMs);
	debounceTimerByUri.set(uri, timer);
}

function clearDebounce(uri: string): void {
	const timer = debounceTimerByUri.get(uri);
	if (timer) {
		clearTimeout(timer);
		debounceTimerByUri.delete(uri);
	}
}

function cancelInFlight(uri: string): void {
	const controller = inFlightByUri.get(uri);
	if (controller) {
		controller.abort();
		inFlightByUri.delete(uri);
	}
}

async function runLintIfReady(uri: string): Promise<void> {
	clearDebounce(uri);
	cancelInFlight(uri);

	if (activeRuns >= maxConcurrentRuns) {
		queueUri(uri);
		return;
	}
	const pending = pendingByUri.get(uri);
	if (!pending) {
		return;
	}
	pendingByUri.delete(uri);

	const document = documents.get(uri);
	if (!document) {
		return;
	}
	if (pending.version !== null && pending.version !== document.version) {
		queueUri(uri);
		return;
	}

	activeRuns += 1;
	try {
		await runLintNow(uri, pending.reason, pending.fix);
	} finally {
		activeRuns -= 1;
		void drainQueue();
	}
}

async function runLintWhenPossible(uri: string): Promise<number> {
	clearDebounce(uri);
	cancelInFlight(uri);
	removeFromQueue(uri);
	while (activeRuns >= maxConcurrentRuns) {
		await sleep(25);
	}
	const pending = pendingByUri.get(uri);
	if (!pending) {
		return 0;
	}
	pendingByUri.delete(uri);
	const document = documents.get(uri);
	if (!document) {
		return 0;
	}
	if (pending.version !== document.version) {
		pending.version = document.version;
	}
	activeRuns += 1;
	try {
		return await runLintNow(uri, pending.reason, pending.fix);
	} finally {
		activeRuns -= 1;
		void drainQueue();
	}
}

function queueUri(uri: string): void {
	if (!queuedUris.includes(uri)) {
		queuedUris.push(uri);
	}
}

function removeFromQueue(uri: string): void {
	const index = queuedUris.indexOf(uri);
	if (index >= 0) {
		queuedUris.splice(index, 1);
	}
}

async function drainQueue(): Promise<void> {
	while (activeRuns < maxConcurrentRuns && queuedUris.length > 0) {
		const nextUri = queuedUris.shift();
		if (!nextUri) {
			continue;
		}
		if (!pendingByUri.has(nextUri)) {
			continue;
		}
		await runLintIfReady(nextUri);
	}
}

async function runLintNow(
	uri: string,
	reason: LintReason,
	fix: boolean,
): Promise<number> {
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

	if (fix && !isSavedFile) {
		await connection.window.showWarningMessage(
			"tsqllint: --fix requires a saved file.",
		);
		inFlightByUri.delete(uri);
		return -1;
	}

	if (!isSavedFile) {
		tempInfo = await createTempFile(document.getText());
		targetFilePath = tempInfo.filePath;
	}

	let result: LintRunResult;
	try {
		result = await runTsqllint({
			filePath: targetFilePath,
			cwd,
			settings,
			signal: controller.signal,
			fix,
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

	if (fix) {
		await notifyFixResult(result.stdout);
		await cleanupTemp(tempInfo);
		return await runLintNow(uri, reason, false);
	}

	const diagnostics = parseOutput({
		stdout: result.stdout,
		uri,
		cwd,
		lines: document.getText().split(/\r?\n/),
		rangeMode: settings.rangeMode,
		targetPaths: tempInfo ? [tempInfo.filePath] : undefined,
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

	return workspaceFolders[0] ?? (filePath ? path.dirname(filePath) : process.cwd());
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
	await connection.window.showWarningMessage(
		`tsqllint: ${firstLine(trimmed)}`,
	);
	connection.console.warn(trimmed);
}

async function notifyFixResult(stdout: string): Promise<void> {
	const match = stdout.match(/(\d+)\s+Fixed\b/);
	if (!match) {
		return;
	}
	const count = Number(match[1]);
	if (Number.isNaN(count)) {
		return;
	}
	await connection.window.showInformationMessage(
		`tsqllint: ${count} issues fixed.`,
	);
}

function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
