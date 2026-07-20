import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocument as TextDocumentImpl } from "vscode-languageserver-textdocument";
import type { TsqlRefineSettings } from "../../server/config/settings";
import { executeLint } from "../../server/lint/lintOperations";
import type { DocumentContext } from "../../server/shared/documentContext";
import { MissingTsqlRefineError } from "../../server/shared/errors";
import { DocumentStateManager } from "../../server/state/documentStateManager";
import { NotificationManager } from "../../server/state/notificationManager";

/**
 * Creates default test settings.
 */
function createTestSettings(
	overrides: Partial<TsqlRefineSettings> = {},
): TsqlRefineSettings {
	return {
		runOnSave: true,
		runOnType: false,
		runOnOpen: true,
		debounceMs: 500,
		timeoutMs: 10000,
		maxFileSizeKb: 0,
		minSeverity: "info",
		enableLint: true,
		enableFormat: true,
		enableFix: true,
		allowPlugins: false,
		...overrides,
	};
}

/**
 * Creates a mock DocumentContext for testing.
 */
function createMockDocumentContext(
	overrides: Partial<DocumentContext> = {},
): DocumentContext {
	return {
		uri: "file:///test.sql",
		filePath: "/test.sql",
		workspaceRoot: "/workspace",
		cwd: "/workspace",
		effectiveSettings: createTestSettings(),
		effectiveConfigPath: undefined,
		documentText: "SELECT 1;",
		isSavedFile: true,
		...overrides,
	};
}

/**
 * Creates a mock TextDocument for testing.
 */
function createMockTextDocument(
	uri = "file:///test.sql",
	text = "SELECT 1;",
): TextDocument {
	return TextDocumentImpl.create(uri, "sql", 1, text);
}

/**
 * Interface for tracking mock connection calls.
 */
interface MockConnectionCalls {
	showWarningMessage: string[];
	sendDiagnostics: Array<{
		uri: string;
		diagnostics: Array<{ message: string; severity?: DiagnosticSeverity }>;
	}>;
}

/**
 * Creates a mock Connection for testing.
 */
function createMockConnection(): {
	connection: Connection;
	calls: MockConnectionCalls;
} {
	const calls: MockConnectionCalls = {
		showWarningMessage: [],
		sendDiagnostics: [],
	};

	const connection = {
		window: {
			showWarningMessage: async (message: string) => {
				calls.showWarningMessage.push(message);
				return undefined;
			},
		},
		sendDiagnostics: (params: {
			uri: string;
			diagnostics: Array<{ message: string; severity?: DiagnosticSeverity }>;
		}) => {
			calls.sendDiagnostics.push(params);
		},
		console: {
			log: () => {},
			warn: () => {},
			error: () => {},
		},
	} as unknown as Connection;

	return { connection, calls };
}

/**
 * Interface for tracking mock notification manager calls.
 */
interface MockNotificationManagerCalls {
	log: string[];
	warn: string[];
	notifyStderr: string[];
	notifyRunFailure: unknown[];
	maybeNotifyMissingTsqlRefine: string[];
}

/**
 * Creates a mock NotificationManager for testing.
 */
function createMockNotificationManager(): {
	notificationManager: {
		log: (message: string) => void;
		warn: (message: string) => void;
		notifyStderr: (stderr: string) => void;
		notifyRunFailure: (error: unknown) => void;
		maybeNotifyMissingTsqlRefine: (message: string) => Promise<void>;
	};
	calls: MockNotificationManagerCalls;
} {
	const calls: MockNotificationManagerCalls = {
		log: [],
		warn: [],
		notifyStderr: [],
		notifyRunFailure: [],
		maybeNotifyMissingTsqlRefine: [],
	};

	const notificationManager = {
		log: (message: string) => {
			calls.log.push(message);
		},
		warn: (message: string) => {
			calls.warn.push(message);
		},
		notifyStderr: (stderr: string) => {
			calls.notifyStderr.push(stderr);
		},
		notifyRunFailure: (error: unknown) => {
			calls.notifyRunFailure.push(error);
		},
		maybeNotifyMissingTsqlRefine: async (message: string) => {
			calls.maybeNotifyMissingTsqlRefine.push(message);
		},
	};

	return { notificationManager, calls };
}

suite("lintOperations", () => {
	suite("DocumentStateManager integration", () => {
		test("setInFlight and clearInFlight work correctly", () => {
			const stateManager = new DocumentStateManager();
			const uri = "file:///test.sql";
			const controller = new AbortController();

			stateManager.setInFlight(uri, controller);
			assert.strictEqual(stateManager.isCurrentInFlight(uri, controller), true);

			stateManager.clearInFlight(uri);
			assert.strictEqual(
				stateManager.isCurrentInFlight(uri, controller),
				false,
			);
		});

		test("cancelInFlight aborts the controller", () => {
			const stateManager = new DocumentStateManager();
			const uri = "file:///test.sql";
			const controller = new AbortController();

			stateManager.setInFlight(uri, controller);
			assert.strictEqual(controller.signal.aborted, false);

			stateManager.cancelInFlight(uri);
			assert.strictEqual(controller.signal.aborted, true);
		});

		test("isCurrentInFlight returns false for different controller", () => {
			const stateManager = new DocumentStateManager();
			const uri = "file:///test.sql";
			const controller1 = new AbortController();
			const controller2 = new AbortController();

			stateManager.setInFlight(uri, controller1);
			assert.strictEqual(
				stateManager.isCurrentInFlight(uri, controller2),
				false,
			);
		});
	});

	suite("Mock connection behavior", () => {
		test("mock connection tracks showWarningMessage calls", async () => {
			const { connection, calls } = createMockConnection();

			await connection.window.showWarningMessage("Test warning");

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.strictEqual(calls.showWarningMessage[0], "Test warning");
		});

		test("mock connection tracks sendDiagnostics calls", () => {
			const { connection, calls } = createMockConnection();

			connection.sendDiagnostics({
				uri: "file:///test.sql",
				diagnostics: [
					{
						message: "Test diagnostic",
						severity: DiagnosticSeverity.Error,
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 1 },
						},
					},
				],
			});

			assert.strictEqual(calls.sendDiagnostics.length, 1);
			assert.strictEqual(calls.sendDiagnostics[0]?.uri, "file:///test.sql");
			assert.strictEqual(calls.sendDiagnostics[0]?.diagnostics.length, 1);
		});
	});

	suite("Mock notification manager behavior", () => {
		test("tracks log and warn calls", () => {
			const { notificationManager, calls } = createMockNotificationManager();

			notificationManager.log("Log message");
			notificationManager.warn("Warn message");
			notificationManager.notifyStderr("stderr output");

			assert.strictEqual(calls.log.length, 1);
			assert.strictEqual(calls.log[0], "Log message");
			assert.strictEqual(calls.warn.length, 1);
			assert.strictEqual(calls.warn[0], "Warn message");
			assert.strictEqual(calls.notifyStderr.length, 1);
			assert.strictEqual(calls.notifyStderr[0], "stderr output");
		});
	});

	suite("File size limiting", () => {
		test("calculates document size correctly", () => {
			const text = "SELECT 1;\n".repeat(100);
			const document = createMockTextDocument("file:///test.sql", text);

			const sizeBytes = Buffer.byteLength(document.getText(), "utf8");
			const sizeKb = Math.ceil(sizeBytes / 1024);

			assert.ok(sizeBytes > 0);
			assert.ok(sizeKb > 0);
		});

		test("detects when file exceeds size limit", () => {
			const largeText = "SELECT 1;\n".repeat(10000); // ~90KB
			const sizeBytes = Buffer.byteLength(largeText, "utf8");
			const sizeKb = Math.ceil(sizeBytes / 1024);
			const maxFileSizeKb = 10;

			assert.ok(sizeKb > maxFileSizeKb, "Document should exceed limit");
		});
	});

	suite("Mock document context", () => {
		test("creates valid context with defaults", () => {
			const context = createMockDocumentContext();

			assert.strictEqual(context.uri, "file:///test.sql");
			assert.strictEqual(context.filePath, "/test.sql");
			assert.strictEqual(context.cwd, "/workspace");
			assert.strictEqual(context.documentText, "SELECT 1;");
			assert.strictEqual(context.isSavedFile, true);
		});

		test("creates valid context with overrides", () => {
			const context = createMockDocumentContext({
				uri: "file:///custom.sql",
				filePath: "/custom/custom.sql",
				cwd: "/custom",
				documentText: "SELECT 2;",
				isSavedFile: false,
			});

			assert.strictEqual(context.uri, "file:///custom.sql");
			assert.strictEqual(context.filePath, "/custom/custom.sql");
			assert.strictEqual(context.cwd, "/custom");
			assert.strictEqual(context.documentText, "SELECT 2;");
			assert.strictEqual(context.isSavedFile, false);
		});
	});

	test("treats a null exit code as failure without clearing diagnostics", async () => {
		const diagnosticsCalls: unknown[] = [];
		const connection = {
			window: { showWarningMessage: async () => undefined },
			console: {
				debug: () => {},
				log: () => {},
				warn: () => {},
				error: () => {},
			},
			sendDiagnostics: (params: unknown) => diagnosticsCalls.push(params),
		} as unknown as Connection;
		const document = TextDocumentImpl.create(
			"file:///test.sql",
			"sql",
			1,
			"SELECT 1;",
		);
		const context = createMockDocumentContext({
			uri: document.uri,
			documentText: document.getText(),
			effectiveSettings: createTestSettings(),
		});

		const result = await executeLint(context, document, "manual", {
			connection,
			notificationManager: new NotificationManager(connection),
			lintStateManager: new DocumentStateManager(),
			runner: async () => ({
				stdout: "{truncated",
				stderr: "output limit exceeded",
				exitCode: null,
				timedOut: false,
				cancelled: false,
			}),
		});

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.diagnosticsCount, -1);
		assert.strictEqual(diagnosticsCalls.length, 0);
	});

	test("reports a typed missing executable error as a diagnostic", async () => {
		const { connection, calls } = createMockConnection();
		const document = createMockTextDocument();
		const context = createMockDocumentContext({
			uri: document.uri,
			documentText: document.getText(),
		});

		const result = await executeLint(context, document, "manual", {
			connection,
			notificationManager: new NotificationManager(connection),
			lintStateManager: new DocumentStateManager(),
			runner: async () => {
				throw new MissingTsqlRefineError(
					"tsqlrefine executable is unavailable",
				);
			},
		});

		assert.strictEqual(result.success, false);
		assert.strictEqual(calls.sendDiagnostics.length, 1);
		assert.ok(
			calls.sendDiagnostics[0]?.diagnostics[0]?.message.includes(
				"tsqlrefine executable is unavailable",
			),
		);
	});
});
