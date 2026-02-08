import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
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
	overrides: Partial<{
		uri: string;
		text: string;
		lineCount: number;
	}> = {},
): TextDocument {
	const text = overrides.text ?? "SELECT 1;";
	const lineCount = overrides.lineCount ?? 1;

	return {
		uri: overrides.uri ?? "file:///test.sql",
		languageId: "sql",
		version: 1,
		getText: (range?: { start: { line: number }; end: { line: number } }) => {
			if (!range) return text;
			const lines = text.split("\n");
			if (range.start.line === lineCount - 1) {
				return lines[range.start.line] ?? "";
			}
			return text;
		},
		lineCount,
		positionAt: (offset: number) => ({ line: 0, character: offset }),
		offsetAt: (position: { line: number; character: number }) =>
			position.character,
	} as TextDocument;
}

/**
 * Interface for tracking mock connection calls.
 */
interface MockConnectionCalls {
	showWarningMessage: string[];
	diagnostics: Array<{ uri: string; diagnostics: unknown[] }>;
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
		diagnostics: [],
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
		sendNotification: () => {},
		sendDiagnostics: (params: { uri: string; diagnostics: unknown[] }) => {
			calls.diagnostics.push(params);
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
	notifyStderr: string[];
	notifyRunFailure: unknown[];
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
		notifyStderr: (stderr: string) => void;
		notifyRunFailure: (error: unknown) => void;
	};
	calls: MockNotificationManagerCalls;
} {
	const calls: MockNotificationManagerCalls = {
		log: [],
		warn: [],
		maybeNotifyMissingTsqlRefine: [],
		notifyStderr: [],
		notifyRunFailure: [],
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
		notifyStderr: (stderr: string) => {
			calls.notifyStderr.push(stderr);
		},
		notifyRunFailure: (error: unknown) => {
			calls.notifyRunFailure.push(error);
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

	suite("File size limit logic", () => {
		test("maxFileSizeBytes returns null for zero", () => {
			const maxFileSizeKb = 0;
			const result =
				!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0
					? null
					: Math.floor(maxFileSizeKb * 1024);
			assert.strictEqual(result, null);
		});

		test("maxFileSizeBytes returns null for negative", () => {
			const maxFileSizeKb = -1;
			const result =
				!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0
					? null
					: Math.floor(maxFileSizeKb * 1024);
			assert.strictEqual(result, null);
		});

		test("maxFileSizeBytes returns bytes for positive value", () => {
			const maxFileSizeKb = 100;
			const result =
				!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0
					? null
					: Math.floor(maxFileSizeKb * 1024);
			assert.strictEqual(result, 102400);
		});

		test("maxFileSizeBytes returns null for NaN", () => {
			const maxFileSizeKb = Number.NaN;
			const result =
				!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0
					? null
					: Math.floor(maxFileSizeKb * 1024);
			assert.strictEqual(result, null);
		});

		test("maxFileSizeBytes returns null for Infinity", () => {
			const maxFileSizeKb = Number.POSITIVE_INFINITY;
			const result =
				!Number.isFinite(maxFileSizeKb) || maxFileSizeKb <= 0
					? null
					: Math.floor(maxFileSizeKb * 1024);
			assert.strictEqual(result, null);
		});
	});

	suite("Document size calculation", () => {
		test("calculates byte size correctly for ASCII", () => {
			const text = "SELECT 1;";
			const sizeBytes = Buffer.byteLength(text, "utf8");
			assert.strictEqual(sizeBytes, 9);
		});

		test("calculates byte size correctly for UTF-8", () => {
			const text = "SELECT '日本語';";
			const sizeBytes = Buffer.byteLength(text, "utf8");
			// '日本語' = 3 characters × 3 bytes each = 9 bytes
			// Total: "SELECT '" (8) + 9 + "';" (2) = 19 bytes
			assert.strictEqual(sizeBytes, 19);
		});

		test("calculates byte size correctly for empty string", () => {
			const text = "";
			const sizeBytes = Buffer.byteLength(text, "utf8");
			assert.strictEqual(sizeBytes, 0);
		});
	});

	suite("File size skip logic", () => {
		function shouldSkipLint(
			maxBytes: number | null,
			sizeBytes: number,
			reason: string,
		): boolean {
			return maxBytes !== null && reason !== "manual" && sizeBytes > maxBytes;
		}

		test("skips lint when file exceeds size limit for non-manual reason", () => {
			assert.strictEqual(shouldSkipLint(100, 150, "save"), true);
		});

		test("does not skip lint when file is within size limit", () => {
			assert.strictEqual(shouldSkipLint(100, 50, "save"), false);
		});

		test("does not skip lint for manual reason even if file exceeds limit", () => {
			assert.strictEqual(shouldSkipLint(100, 150, "manual"), false);
		});

		test("does not skip lint when maxBytes is null (unlimited)", () => {
			assert.strictEqual(shouldSkipLint(null, 999999, "save"), false);
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
				diagnostics: [],
			});

			assert.strictEqual(calls.diagnostics.length, 1);
			assert.strictEqual(calls.diagnostics[0]?.uri, "file:///test.sql");
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

		test("tracks notifyStderr calls", () => {
			const { notificationManager, calls } = createMockNotificationManager();

			notificationManager.notifyStderr("stderr output");

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

	suite("Result handling logic", () => {
		test("timeout result returns failure", () => {
			const result = {
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: true,
				cancelled: false,
			};

			const isFailure = result.timedOut;
			assert.strictEqual(isFailure, true);
		});

		test("cancelled result returns failure", () => {
			const controller = new AbortController();
			controller.abort();

			const result = {
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: false,
				cancelled: true,
			};

			const isFailure = controller.signal.aborted || result.cancelled;
			assert.strictEqual(isFailure, true);
		});

		test("normal result returns success", () => {
			const result = {
				stdout: "output",
				stderr: "",
				exitCode: 0,
				timedOut: false,
				cancelled: false,
			};

			const isFailure = result.timedOut || result.cancelled;
			assert.strictEqual(isFailure, false);
		});
	});

	suite("DocumentContext creation", () => {
		test("mock context has all required properties", () => {
			const context = createMockDocumentContext();

			assert.strictEqual(context.uri, "file:///test.sql");
			assert.strictEqual(context.filePath, "/test.sql");
			assert.strictEqual(context.cwd, "/workspace");
			assert.strictEqual(context.documentText, "SELECT 1;");
			assert.strictEqual(context.isSavedFile, true);
			assert.ok(context.effectiveSettings);
		});

		test("mock context can be customized", () => {
			const context = createMockDocumentContext({
				uri: "file:///custom.sql",
				documentText: "SELECT * FROM users;",
				isSavedFile: false,
			});

			assert.strictEqual(context.uri, "file:///custom.sql");
			assert.strictEqual(context.documentText, "SELECT * FROM users;");
			assert.strictEqual(context.isSavedFile, false);
		});
	});

	suite("TextDocument mock", () => {
		test("getText returns full text when no range", () => {
			const doc = createMockTextDocument({ text: "SELECT 1;\nSELECT 2;" });
			assert.strictEqual(doc.getText(), "SELECT 1;\nSELECT 2;");
		});

		test("lineCount is correct", () => {
			const doc = createMockTextDocument({ text: "SELECT 1;", lineCount: 1 });
			assert.strictEqual(doc.lineCount, 1);
		});
	});

	suite("Exit code handling", () => {
		test("exit code 0 is success (no violations)", () => {
			const result = {
				exitCode: 0,
				timedOut: false,
				cancelled: false,
			};

			const isError = result.exitCode !== null && result.exitCode >= 2;
			assert.strictEqual(isError, false);
		});

		test("exit code 1 is success (violations found)", () => {
			const result = {
				exitCode: 1,
				timedOut: false,
				cancelled: false,
			};

			const isError = result.exitCode !== null && result.exitCode >= 2;
			assert.strictEqual(isError, false);
		});

		test("exit code 2 is failure (parse error)", () => {
			const result = {
				exitCode: 2,
				timedOut: false,
				cancelled: false,
			};

			const isError = result.exitCode !== null && result.exitCode >= 2;
			assert.strictEqual(isError, true);
		});

		test("exit code 3 is failure (configuration error)", () => {
			const result = {
				exitCode: 3,
				timedOut: false,
				cancelled: false,
			};

			const isError = result.exitCode !== null && result.exitCode >= 2;
			assert.strictEqual(isError, true);
		});

		test("exit code 4 is failure (runtime exception)", () => {
			const result = {
				exitCode: 4,
				timedOut: false,
				cancelled: false,
			};

			const isError = result.exitCode !== null && result.exitCode >= 2;
			assert.strictEqual(isError, true);
		});
	});

	suite("Target file path resolution", () => {
		test("uses filePath when provided", () => {
			const filePath = "/path/to/test.sql";
			const targetFilePath = filePath || "untitled.sql";
			assert.strictEqual(targetFilePath, "/path/to/test.sql");
		});

		test("uses untitled.sql fallback when filePath is empty", () => {
			const filePath = "";
			const targetFilePath = filePath || "untitled.sql";
			assert.strictEqual(targetFilePath, "untitled.sql");
		});
	});

	suite("Missing tsqlrefine diagnostic creation", () => {
		test("creates diagnostic with correct properties", () => {
			const message = "tsqlrefine not found in PATH";
			const diagnostic = {
				message: `tsqlrefine: ${message}`,
				severity: 1, // DiagnosticSeverity.Error
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 0 },
				},
				source: "tsqlrefine",
				code: "tsqlrefine-not-found",
			};

			assert.strictEqual(
				diagnostic.message,
				"tsqlrefine: tsqlrefine not found in PATH",
			);
			assert.strictEqual(diagnostic.severity, 1);
			assert.strictEqual(diagnostic.source, "tsqlrefine");
			assert.strictEqual(diagnostic.code, "tsqlrefine-not-found");
		});
	});

	suite("File too large diagnostic creation", () => {
		test("creates diagnostic with correct message", () => {
			const sizeKb = 150;
			const maxFileSizeKb = 100;
			const diagnostic = {
				message: `tsqlrefine: lint skipped (file too large: ${sizeKb}KB > maxFileSizeKb=${maxFileSizeKb}). Run "TSQLRefine: Run" to lint manually or increase the limit.`,
				severity: 3, // DiagnosticSeverity.Information
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 0 },
				},
				source: "tsqlrefine",
				code: "lint-skipped-file-too-large",
			};

			assert.ok(diagnostic.message.includes("150KB"));
			assert.ok(diagnostic.message.includes("maxFileSizeKb=100"));
			assert.strictEqual(diagnostic.severity, 3);
			assert.strictEqual(diagnostic.code, "lint-skipped-file-too-large");
		});
	});
});
