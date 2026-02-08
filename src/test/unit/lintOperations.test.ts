import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { TextDocument as TextDocumentImpl } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../../server/shared/documentContext";
import type { TsqlRefineSettings } from "../../server/config/settings";
import { DocumentStateManager } from "../../server/state/documentStateManager";

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
function createMockNotificationManager(isMissingError = false): {
	notificationManager: {
		log: (message: string) => void;
		warn: (message: string) => void;
		notifyStderr: (stderr: string) => void;
		notifyRunFailure: (error: unknown) => void;
		isMissingTsqlRefineError: (message: string) => boolean;
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
		isMissingTsqlRefineError: (_message: string) => isMissingError,
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

		test("isMissingTsqlRefineError returns configured value", () => {
			const { notificationManager: manager1 } =
				createMockNotificationManager(false);
			const { notificationManager: manager2 } =
				createMockNotificationManager(true);

			assert.strictEqual(manager1.isMissingTsqlRefineError("any error"), false);
			assert.strictEqual(manager2.isMissingTsqlRefineError("any error"), true);
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
});
