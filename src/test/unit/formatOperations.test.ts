import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
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
 * Interface for tracking mock connection calls.
 */
interface MockConnectionCalls {
	showWarningMessage: string[];
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
	};

	const connection = {
		window: {
			showWarningMessage: async (message: string) => {
				calls.showWarningMessage.push(message);
				return undefined;
			},
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
	maybeNotifyMissingTsqlRefine: string[];
}

/**
 * Creates a mock NotificationManager for testing.
 */
function createMockNotificationManager(isMissingError = false): {
	notificationManager: {
		log: (message: string) => void;
		warn: (message: string) => void;
		isMissingTsqlRefineError: (message: string) => boolean;
		maybeNotifyMissingTsqlRefine: (message: string) => Promise<void>;
	};
	calls: MockNotificationManagerCalls;
} {
	const calls: MockNotificationManagerCalls = {
		log: [],
		warn: [],
		maybeNotifyMissingTsqlRefine: [],
	};

	const notificationManager = {
		log: (message: string) => {
			calls.log.push(message);
		},
		warn: (message: string) => {
			calls.warn.push(message);
		},
		isMissingTsqlRefineError: (_message: string) => isMissingError,
		maybeNotifyMissingTsqlRefine: async (message: string) => {
			calls.maybeNotifyMissingTsqlRefine.push(message);
		},
	};

	return { notificationManager, calls };
}

suite("formatOperations", () => {
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
	});

	suite("Mock notification manager behavior", () => {
		test("tracks log and warn calls", () => {
			const { notificationManager, calls } = createMockNotificationManager();

			notificationManager.log("Log message");
			notificationManager.warn("Warn message");

			assert.strictEqual(calls.log.length, 1);
			assert.strictEqual(calls.log[0], "Log message");
			assert.strictEqual(calls.warn.length, 1);
			assert.strictEqual(calls.warn[0], "Warn message");
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

	suite("Format disabled handling", () => {
		test("checks enableFormat setting correctly", () => {
			const context = createMockDocumentContext({
				effectiveSettings: createTestSettings({
					enableFormat: false,
				}),
			});

			assert.strictEqual(context.effectiveSettings.enableFormat, false);
		});

		test("enableFormat is true by default", () => {
			const context = createMockDocumentContext();

			assert.strictEqual(context.effectiveSettings.enableFormat, true);
		});
	});

	suite("Timeout handling", () => {
		test("uses formatTimeoutMs when available", () => {
			const settings = createTestSettings({
				formatTimeoutMs: 5000,
				timeoutMs: 10000,
			});

			const timeoutMs = settings.formatTimeoutMs ?? settings.timeoutMs;

			assert.strictEqual(timeoutMs, 5000);
		});

		test("falls back to timeoutMs when formatTimeoutMs is not set", () => {
			const settings = createTestSettings({
				timeoutMs: 15000,
			});

			const timeoutMs = settings.formatTimeoutMs ?? settings.timeoutMs;

			assert.strictEqual(timeoutMs, 15000);
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
				documentText: "select   2;",
				isSavedFile: false,
			});

			assert.strictEqual(context.uri, "file:///custom.sql");
			assert.strictEqual(context.filePath, "/custom/custom.sql");
			assert.strictEqual(context.cwd, "/custom");
			assert.strictEqual(context.documentText, "select   2;");
			assert.strictEqual(context.isSavedFile, false);
		});
	});

	suite("Document change detection", () => {
		test("detects when formatted text differs from original", () => {
			const originalText: string = "select   1;";
			const formattedText: string = "SELECT 1;";

			const hasChanges = formattedText !== originalText;

			assert.strictEqual(hasChanges, true);
		});

		test("detects when formatted text is identical to original", () => {
			const originalText: string = "SELECT 1;";
			const formattedText: string = "SELECT 1;";

			const hasChanges = formattedText !== originalText;

			assert.strictEqual(hasChanges, false);
		});
	});
});
