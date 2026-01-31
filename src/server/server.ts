import {
	createConnection,
	ProposedFeatures,
	TextDocumentSyncKind,
	TextDocuments,
	type DocumentFormattingParams,
	type TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { MAX_CONCURRENT_RUNS } from "./config/constants";
import {
	executeFormat,
	type FormatOperationDeps,
} from "./format/formatOperations";
import { executeLint, type LintOperationDeps } from "./lint/lintOperations";
import { verifyTsqllintInstallation } from "./lint/runTsqllint";
import {
	type LintReason,
	LintScheduler,
	type PendingLint,
} from "./lint/scheduler";
import { createDocumentContext } from "./shared/documentContext";
import { DocumentStateManager } from "./state/documentStateManager";
import { NotificationManager } from "./state/notificationManager";
import { SettingsManager } from "./state/settingsManager";

// ============================================================================
// LSP Connection and State Managers
// ============================================================================

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

const settingsManager = new SettingsManager(connection);
const notificationManager = new NotificationManager(connection);
const lintStateManager = new DocumentStateManager();
const formatStateManager = new DocumentStateManager();

let workspaceFolders: string[] = [];

// ============================================================================
// Operation Dependencies
// ============================================================================

const lintDeps: LintOperationDeps = {
	connection,
	notificationManager,
	lintStateManager,
};

const formatDeps: FormatOperationDeps = {
	connection,
	notificationManager,
	formatStateManager,
};

// ============================================================================
// Lint Scheduler
// ============================================================================

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
		const result = await requestLint(params.uri, "manual", null);
		return { ok: result >= 0, issues: Math.max(0, result) };
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

// ============================================================================
// Start Server
// ============================================================================

documents.listen(connection);
connection.listen();

// ============================================================================
// Installation Verification
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

// ============================================================================
// Document Event Handler Implementations
// ============================================================================

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

	const documentSettings = await settingsManager.getSettingsForDocument(uri);
	const context = await createDocumentContext({
		document,
		documentSettings,
		workspaceFolders,
		isSavedFn: (doc) => isSaved(doc),
	});

	const result = await executeLint(context, document, reason, lintDeps);
	return result.diagnosticsCount;
}

// ============================================================================
// Format Operations
// ============================================================================

async function formatDocument(uri: string): Promise<TextEdit[] | null> {
	const document = documents.get(uri);
	if (!document) {
		return null;
	}

	formatStateManager.cancelInFlight(uri);

	const documentSettings = await settingsManager.getSettingsForDocument(uri);
	const context = await createDocumentContext({
		document,
		documentSettings,
		workspaceFolders,
		isSavedFn: (doc) => isSaved(doc),
	});

	return await executeFormat(context, document, formatDeps);
}

// ============================================================================
// Utility Functions
// ============================================================================

function isSaved(document: TextDocument): boolean {
	if (URI.parse(document.uri).scheme !== "file") {
		return false;
	}
	return lintStateManager.isSaved(document.uri, document.version);
}
