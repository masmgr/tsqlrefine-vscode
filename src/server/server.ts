import {
	CodeActionKind,
	OptionalVersionedTextDocumentIdentifier,
	ProposedFeatures,
	TextDocumentEdit,
	TextDocumentSyncKind,
	TextDocuments,
	createConnection,
	type CodeAction,
	type CodeActionParams,
	type DocumentFormattingParams,
	type TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { MAX_CONCURRENT_RUNS } from "./config/constants";
import { executeFix, type FixOperationDeps } from "./fix/fixOperations";
import {
	executeFormat,
	type FormatOperationDeps,
} from "./format/formatOperations";
import { executeLint, type LintOperationDeps } from "./lint/lintOperations";
import { verifyTsqlRefineInstallation } from "./lint/runLinter";
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
const fixStateManager = new DocumentStateManager();

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
	stateManager: formatStateManager,
};

const fixDeps: FixOperationDeps = {
	connection,
	notificationManager,
	stateManager: fixStateManager,
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
	// `trace` is "off" | "messages" | "verbose"; anything other than "off"
	// (or absent) enables verbose debug logging on the server.
	notificationManager.setDebugEnabled(
		params.trace != null && params.trace !== "off",
	);
	return {
		capabilities: {
			workspace: {
				workspaceFolders: {
					supported: true,
					changeNotifications: true,
				},
			},
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Incremental,
				save: { includeText: false },
			},
			documentFormattingProvider: true,
			codeActionProvider: {
				codeActionKinds: [CodeActionKind.QuickFix],
			},
		},
	};
});

connection.onInitialized(async () => {
	connection.workspace.onDidChangeWorkspaceFolders((event) => {
		const removed = new Set(
			event.removed.map((folder) => URI.parse(folder.uri).fsPath),
		);
		const added = event.added.map((folder) => URI.parse(folder.uri).fsPath);
		workspaceFolders = [
			...workspaceFolders.filter((folder) => !removed.has(folder)),
			...added,
		];
		// Document-scoped settings can depend on workspace folders.
		settingsManager.invalidateAll();
	});

	await settingsManager.refreshSettings();
	await verifyInstallation();
});

// Track the client's trace setting so verbose debug logging can be gated.
connection.onNotification(
	"$/setTrace",
	(params: { value?: "off" | "messages" | "verbose" }) => {
		notificationManager.setDebugEnabled(
			params.value != null && params.value !== "off",
		);
	},
);

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
	settingsManager.invalidateDocument(uri);
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
		const document = documents.get(params.uri);
		if (!document) {
			return { ok: false, error: "Document not found" };
		}
		const version = document.version;
		const edits = await formatDocument(params.uri);
		return await applyEditsWithVersionGuard(
			params.uri,
			version,
			edits,
			"Format",
		);
	},
);

connection.onRequest(
	"tsqlrefine/fixDocument",
	async (params: { uri: string }): Promise<{ ok: boolean; error?: string }> => {
		const document = documents.get(params.uri);
		if (!document) {
			return { ok: false, error: "Document not found" };
		}
		const version = document.version;
		const edits = await fixDocument(params.uri);
		const applyResult = await applyEditsWithVersionGuard(
			params.uri,
			version,
			edits,
			"Fix",
		);
		if (!applyResult.ok) {
			return applyResult;
		}
		if (edits?.length === 0) {
			return { ok: true };
		}
		// Re-run lint to update diagnostics after fix
		await requestLint(params.uri, "manual", null);
		return { ok: true };
	},
);

// ============================================================================
// Code Action Handler
// ============================================================================

connection.onCodeAction(
	async (params: CodeActionParams): Promise<CodeAction[] | null> => {
		// Check if any fixable diagnostic from tsqlrefine exists
		const fixableDiagnostics = params.context.diagnostics.filter(
			(diag) =>
				diag.source === "tsqlrefine" &&
				(diag.data as { fixable?: boolean } | undefined)?.fixable === true,
		);

		if (fixableDiagnostics.length === 0) {
			return null;
		}

		// Create the Code Action without executing fix yet.
		// The fix will be executed when the user selects the action.
		const codeAction: CodeAction = {
			title: "Fix all tsqlrefine issues",
			kind: CodeActionKind.QuickFix,
			diagnostics: fixableDiagnostics,
			command: {
				title: "Fix all tsqlrefine issues",
				command: "tsqlrefine.fix",
				arguments: [params.textDocument.uri],
			},
		};

		return [codeAction];
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
	const result = await verifyTsqlRefineInstallation(
		settingsManager.getSettings(),
		workspaceFolders[0] ?? process.cwd(),
	);

	if (!result.available) {
		const message = result.message || "tsqlrefine not found";
		await notificationManager.maybeNotifyMissingTsqlRefine(message);
		notificationManager.warn(`[startup] ${message}`);
	} else {
		notificationManager.debug("[startup] tsqlrefine installation verified");
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
		if (!docSettings.runOnType || !docSettings.enableLint) {
			return;
		}
		lintStateManager.cancelInFlight(document.uri);
		void requestLint(
			document.uri,
			"type",
			document.version,
			docSettings.debounceMs,
		);
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
		if (docSettings.runOnSave && docSettings.enableLint) {
			void requestLint(uri, "save", document.version);
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
		if (docSettings.runOnOpen && docSettings.enableLint) {
			void requestLint(uri, "open", document.version);
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
	return await withDocumentOperation(
		uri,
		"Lint",
		async (context, document) => {
			const result = await executeLint(context, document, reason, lintDeps);
			return result.diagnosticsCount;
		},
		0,
	);
}

// ============================================================================
// Format Operations
// ============================================================================

async function formatDocument(uri: string): Promise<TextEdit[] | null> {
	formatStateManager.cancelInFlight(uri);
	return await withDocumentOperation(
		uri,
		"Format",
		(context, document) => executeFormat(context, document, formatDeps),
		null,
	);
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

// ============================================================================
// Fix Operations
// ============================================================================

async function fixDocument(uri: string): Promise<TextEdit[] | null> {
	fixStateManager.cancelInFlight(uri);
	return await withDocumentOperation(
		uri,
		"Fix",
		(context, document) => executeFix(context, document, fixDeps),
		null,
	);
}

async function withDocumentOperation<T>(
	uri: string,
	operation: "Lint" | "Format" | "Fix",
	run: (
		context: Awaited<ReturnType<typeof createDocumentContext>>,
		document: TextDocument,
	) => Promise<T>,
	notFoundResult: T,
): Promise<T> {
	const document = documents.get(uri);
	if (!document) {
		return notFoundResult;
	}
	const documentSettings = await settingsManager.getSettingsForDocument(uri);
	const enabled =
		operation === "Lint"
			? documentSettings.enableLint
			: operation === "Format"
				? documentSettings.enableFormat
				: documentSettings.enableFix;
	if (!enabled) {
		return notFoundResult;
	}
	const context = await createDocumentContext({
		document,
		documentSettings,
		workspaceFolders,
		isSavedFn: (doc) => isSaved(doc),
	});
	connection.sendNotification("tsqlrefine/operationState", {
		state: "started",
	});
	const startMs = Date.now();
	try {
		const result = await run(context, document);
		const elapsedMs = Date.now() - startMs;
		notificationManager.debug(
			`[execute${operation}] Completed in ${elapsedMs}ms`,
		);
		return result;
	} finally {
		connection.sendNotification("tsqlrefine/operationState", {
			state: "completed",
		});
	}
}

async function applyEditsWithVersionGuard(
	uri: string,
	version: number,
	edits: TextEdit[] | null,
	operation: "Format" | "Fix",
): Promise<{ ok: boolean; error?: string }> {
	if (edits === null) {
		return { ok: false, error: `${operation} failed` };
	}
	if (edits.length === 0) {
		return { ok: true };
	}
	const result = await connection.workspace.applyEdit({
		documentChanges: [
			TextDocumentEdit.create(
				OptionalVersionedTextDocumentIdentifier.create(uri, version),
				edits,
			),
		],
	});
	return result.applied
		? { ok: true }
		: { ok: false, error: "Failed to apply edits" };
}
