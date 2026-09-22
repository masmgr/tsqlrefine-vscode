import {
	type CodeAction,
	CodeActionKind,
	type CodeActionParams,
	type Connection,
	createConnection,
	type DocumentFormattingParams,
	OptionalVersionedTextDocumentIdentifier,
	ProposedFeatures,
	TextDocumentEdit,
	TextDocumentSyncKind,
	TextDocuments,
	type TextEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { MAX_CONCURRENT_RUNS } from "./config/constants";
import { clearConfigPathCache } from "./config/resolveConfigPath";
import type { TsqlRefineSettings } from "./config/settings";
import { executeFix, type FixOperationDeps } from "./fix/fixOperations";
import {
	executeFormat,
	type FormatOperationDeps,
} from "./format/formatOperations";
import { executeLint, type LintOperationDeps } from "./lint/lintOperations";
import { verifyTsqlRefineInstallation } from "./lint/runLinter";
import { type LintReason, LintScheduler } from "./lint/scheduler";
import { createDocumentContext } from "./shared/documentContext";
import {
	type OperationControl,
	runWithInFlight,
} from "./shared/operationExecution";
import { clearCommandAvailabilityCache } from "./shared/processRunner";
import { DocumentStateManager } from "./state/documentStateManager";
import { NotificationManager } from "./state/notificationManager";
import { SettingsManager } from "./state/settingsManager";

/**
 * Fingerprint of every setting that feeds the lint CLI. When it changes,
 * previously published diagnostics no longer reflect the active configuration.
 */
function lintSignature(settings: TsqlRefineSettings): string {
	return [
		settings.path,
		settings.configPath,
		settings.minSeverity,
		settings.maxFileSizeKb,
		settings.allowPlugins,
		settings.timeoutMs,
	].join("\u0000");
}

export type ServerRunners = {
	lint?: Pick<LintOperationDeps, "runner">;
	format?: Pick<FormatOperationDeps, "runner">;
	fix?: Pick<FixOperationDeps, "runner">;
};

export function registerServer(
	connection: Connection,
	runners: ServerRunners = {},
): void {
	// ============================================================================
	// LSP Connection and State Managers
	// ============================================================================

	const documents = new TextDocuments(TextDocument);

	const settingsManager = new SettingsManager(connection);
	const notificationManager = new NotificationManager(connection);
	const lintStateManager = new DocumentStateManager();
	const formatStateManager = new DocumentStateManager();
	const fixStateManager = new DocumentStateManager();

	let workspaceFolders: string[] = [];
	let configurationRevision = 0;
	const observedVersions = new WeakMap<TextDocument, number>();
	const stateManagers = {
		Lint: lintStateManager,
		Format: formatStateManager,
		Fix: fixStateManager,
	};

	function cancelDocumentOperations(uri: string): void {
		scheduler.clear(uri);
		for (const manager of Object.values(stateManagers)) {
			manager.cancelInFlight(uri);
		}
	}

	function documentGuard(document: TextDocument): () => boolean {
		const version = document.version;
		const revision = configurationRevision;
		return () =>
			documents.get(document.uri) === document &&
			document.version === version &&
			configurationRevision === revision;
	}

	// ============================================================================
	// Lint Scheduler
	// ============================================================================

	const scheduler = new LintScheduler({
		maxConcurrentRuns: MAX_CONCURRENT_RUNS,
		getDocumentVersion: (uri) => {
			const document = documents.get(uri);
			return document ? document.version : null;
		},
		runLint: (uri, pending) => runLintNow(uri, pending.reason),
		onError: (uri, error) => {
			notificationManager.error(
				`tsqlrefine: scheduled lint failed for ${uri} (${String(error)})`,
			);
		},
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
		const revision = ++configurationRevision;
		for (const document of documents.all()) {
			cancelDocumentOperations(document.uri);
		}
		const previousSettings = settingsManager.getSettings();
		const previousPath = previousSettings.path;
		const previousLintSignature = lintSignature(previousSettings);
		await settingsManager.refreshSettings();
		if (revision !== configurationRevision) {
			return;
		}
		// Existing diagnostics were produced with the old settings, so they are
		// stale as soon as anything the CLI reads changes.
		const lintInputsChanged =
			previousLintSignature !== lintSignature(settingsManager.getSettings());
		const pathChanged = previousPath !== settingsManager.getSettings().path;
		if (lintInputsChanged) {
			// `configPath` is part of the lint signature, and a resolved config path
			// is cached for CONFIG_CACHE_TTL_MS. Without this the re-lints issued
			// below would run against the previous resolution.
			clearConfigPathCache();
		}
		if (pathChanged) {
			// A stale "not available" verdict would otherwise survive for up to
			// COMMAND_CACHE_TTL_MS after the user points at a working executable,
			// including for the re-lints issued below.
			clearCommandAvailabilityCache();
		}

		await Promise.all(
			documents.all().map(async (document) => {
				const settings = await settingsManager.getSettingsForDocument(
					document.uri,
				);
				if (
					revision !== configurationRevision ||
					documents.get(document.uri) !== document
				) {
					return;
				}
				if (!settings.enableLint) {
					scheduler.clear(document.uri);
					lintStateManager.cancelInFlight(document.uri);
					connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
					return;
				}
				if (lintInputsChanged) {
					// "open" runs without debounce while still honouring maxFileSizeKb.
					void requestLint(document.uri, "open", null);
				}
			}),
		);

		if (pathChanged) {
			await verifyInstallation();
		}
	});

	// ============================================================================
	// Document Event Handlers
	// ============================================================================

	documents.onDidChangeContent(({ document }) => {
		// TextDocuments also emits this event immediately after didOpen.
		if (observedVersions.get(document) === document.version) {
			return;
		}
		observedVersions.set(document, document.version);
		cancelDocumentOperations(document.uri);
		void handleDidChangeContent(document);
	});

	documents.onDidOpen((change) => {
		observedVersions.set(change.document, change.document.version);
		void handleDidOpen(change.document);
	});

	documents.onDidSave((change) => {
		void handleDidSave(change.document);
	});

	documents.onDidClose((change) => {
		const uri = change.document.uri;
		cancelDocumentOperations(uri);
		for (const manager of Object.values(stateManagers)) {
			manager.clearAll(uri);
		}
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
				cancelDocumentOperations(uri);
				for (const manager of Object.values(stateManagers)) {
					manager.clearAll(uri);
				}
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
		async (params: {
			uri: string;
		}): Promise<{ ok: boolean; error?: string }> => {
			const document = documents.get(params.uri);
			if (!document) {
				return { ok: false, error: "Document not found" };
			}
			const version = document.version;
			const edits = await formatDocument(params.uri);
			return await applyEditsWithVersionGuard(
				document,
				version,
				edits,
				"Format",
			);
		},
	);

	connection.onRequest(
		"tsqlrefine/fixDocument",
		async (params: {
			uri: string;
		}): Promise<{ ok: boolean; error?: string }> => {
			const document = documents.get(params.uri);
			if (!document) {
				return { ok: false, error: "Document not found" };
			}
			const version = document.version;
			const edits = await fixDocument(params.uri);
			const applyResult = await applyEditsWithVersionGuard(
				document,
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

	documents.listen(connection);

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
		const isCurrent = documentGuard(document);
		try {
			const docSettings = await settingsManager.getSettingsForDocument(
				document.uri,
			);
			if (!isCurrent() || !docSettings.runOnType || !docSettings.enableLint) {
				return;
			}
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
		const isCurrent = documentGuard(document);
		try {
			const uri = document.uri;
			lintStateManager.setSavedVersion(uri, document.version);
			const docSettings = await settingsManager.getSettingsForDocument(uri);
			if (isCurrent() && docSettings.runOnSave && docSettings.enableLint) {
				void requestLint(uri, "save", document.version);
			}
		} catch (error) {
			notificationManager.error(
				`tsqlrefine: failed to react to save (${String(error)})`,
			);
		}
	}

	async function handleDidOpen(document: TextDocument): Promise<void> {
		const isCurrent = documentGuard(document);
		try {
			const uri = document.uri;
			if (URI.parse(uri).scheme === "file") {
				lintStateManager.setSavedVersion(uri, document.version);
			}

			const docSettings = await settingsManager.getSettingsForDocument(uri);
			if (isCurrent() && docSettings.runOnOpen && docSettings.enableLint) {
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

	async function runLintNow(uri: string, reason: LintReason): Promise<number> {
		return await withDocumentOperation(
			uri,
			"Lint",
			async (context, document, control) => {
				const result = await executeLint(context, document, reason, {
					connection,
					notificationManager,
					control,
					...runners.lint,
				});
				return result.diagnosticsCount;
			},
			0,
		);
	}

	// ============================================================================
	// Format Operations
	// ============================================================================

	async function formatDocument(uri: string): Promise<TextEdit[] | null> {
		return await withDocumentOperation(
			uri,
			"Format",
			(context, document, control) =>
				executeFormat(context, document, {
					connection,
					notificationManager,
					control,
					...runners.format,
				}),
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
		return await withDocumentOperation(
			uri,
			"Fix",
			(context, document, control) =>
				executeFix(context, document, {
					connection,
					notificationManager,
					control,
					...runners.fix,
				}),
			null,
		);
	}

	const ENABLE_SETTING_BY_OPERATION = {
		Lint: "enableLint",
		Format: "enableFormat",
		Fix: "enableFix",
	} as const;

	async function withDocumentOperation<T>(
		uri: string,
		operation: "Lint" | "Format" | "Fix",
		run: (
			context: Awaited<ReturnType<typeof createDocumentContext>>,
			document: TextDocument,
			control: OperationControl,
		) => Promise<T>,
		notFoundResult: T,
	): Promise<T> {
		const document = documents.get(uri);
		if (!document) {
			return notFoundResult;
		}
		const isDocumentCurrent = documentGuard(document);
		const execution = await runWithInFlight(
			stateManagers[operation],
			uri,
			async (controller) => {
				const control: OperationControl = {
					signal: controller.signal,
					isCurrent: () => !controller.signal.aborted && isDocumentCurrent(),
				};
				const documentSettings =
					await settingsManager.getSettingsForDocument(uri);
				const enableSetting = ENABLE_SETTING_BY_OPERATION[operation];
				if (!control.isCurrent() || !documentSettings[enableSetting]) {
					return notFoundResult;
				}
				const context = await createDocumentContext({
					document,
					documentSettings,
					workspaceFolders,
					isSavedFn: isSaved,
				});
				if (!control.isCurrent()) {
					return notFoundResult;
				}
				connection.sendNotification("tsqlrefine/operationState", {
					state: "started",
				});
				const startMs = Date.now();
				try {
					const result = await run(context, document, control);
					notificationManager.debug(
						`[execute${operation}] Completed in ${Date.now() - startMs}ms`,
					);
					return control.isCurrent() ? result : notFoundResult;
				} finally {
					connection.sendNotification("tsqlrefine/operationState", {
						state: "completed",
					});
				}
			},
		);
		return execution.result;
	}

	async function applyEditsWithVersionGuard(
		document: TextDocument,
		version: number,
		edits: TextEdit[] | null,
		operation: "Format" | "Fix",
	): Promise<{ ok: boolean; error?: string }> {
		const uri = document.uri;
		if (documents.get(uri) !== document || document.version !== version) {
			return { ok: false, error: "Document changed or closed" };
		}
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
}

// Process entry point for the language server. Unit tests call registerServer
// directly, so this never runs under coverage.
/* c8 ignore start */
if (require.main === module) {
	const connection = createConnection(ProposedFeatures.all);
	registerServer(connection);
	connection.listen();
}
/* c8 ignore stop */
