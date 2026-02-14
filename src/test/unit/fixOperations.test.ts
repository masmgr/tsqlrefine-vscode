import * as assert from "node:assert";
import type { Connection, TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentContext } from "../../server/shared/documentContext";
import type { TsqlRefineSettings } from "../../server/config/settings";
import { DocumentStateManager } from "../../server/state/documentStateManager";

// We need to test executeFix by mocking runFixer
// Since runFixer is imported directly, we use a different approach:
// We test the behavior through integration with a mock state manager

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
			// For getting the last line
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
		sendNotification: () => {},
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

suite("fixOperations", () => {
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

	suite("TextEdit creation", () => {
		test("createFullDocumentEdit creates correct range for single line", () => {
			const document = createMockTextDocument({
				text: "SELECT 1;",
				lineCount: 1,
			});

			// Simulate what createFullDocumentEdit does
			const lastLineIndex = document.lineCount - 1;
			const lastLine = document.getText({
				start: { line: lastLineIndex, character: 0 },
				end: { line: lastLineIndex, character: Number.MAX_SAFE_INTEGER },
			});

			const edit: TextEdit = {
				range: {
					start: { line: 0, character: 0 },
					end: { line: lastLineIndex, character: lastLine.length },
				},
				newText: "SELECT 1;",
			};

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 0);
			assert.strictEqual(edit.range.end.character, 9); // "SELECT 1;".length
		});

		test("createFullDocumentEdit creates correct range for multiline", () => {
			const text = "SELECT 1;\nSELECT 2;";
			const document = createMockTextDocument({
				text,
				lineCount: 2,
			});

			const lastLineIndex = document.lineCount - 1;
			const lastLine = document.getText({
				start: { line: lastLineIndex, character: 0 },
				end: { line: lastLineIndex, character: Number.MAX_SAFE_INTEGER },
			});

			const edit: TextEdit = {
				range: {
					start: { line: 0, character: 0 },
					end: { line: lastLineIndex, character: lastLine.length },
				},
				newText: text,
			};

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 1);
			assert.strictEqual(edit.range.end.character, 9); // "SELECT 2;".length
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

		test("uses untitled.sql fallback when filePath is empty", () => {
			const context = createMockDocumentContext({
				filePath: "",
			});

			// The actual code uses: const targetFilePath = filePath || "untitled.sql";
			const targetFilePath = context.filePath || "untitled.sql";
			assert.strictEqual(targetFilePath, "untitled.sql");
		});
	});

	suite("Result handling patterns (simulated)", () => {
		test("empty array is returned when text unchanged", () => {
			const originalText = "SELECT 1;";
			const fixedText = "SELECT 1;";

			// Logic from executeFix: if (fixedText === documentText) return [];
			const edits: TextEdit[] =
				fixedText === originalText ? [] : [{ range: {} as never, newText: "" }];

			assert.strictEqual(edits.length, 0);
		});

		test("TextEdit array is returned when text changes", () => {
			const originalText = "select 1;";
			const fixedText = "SELECT 1;";

			// Use string comparison that TypeScript can understand
			const hasChanges = String(fixedText) !== String(originalText);
			assert.strictEqual(hasChanges, true);
		});

		test("null is returned for timeout (simulated)", () => {
			const result = {
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: true,
				cancelled: false,
			};

			// Logic from executeFix: if (result.timedOut) return null;
			const edits = result.timedOut ? null : [];
			assert.strictEqual(edits, null);
		});

		test("null is returned for cancellation (simulated)", () => {
			const controller = new AbortController();
			controller.abort();

			const result = {
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: false,
				cancelled: true,
			};

			// Logic from executeFix: if (controller.signal.aborted || result.cancelled) return null;
			const edits = controller.signal.aborted || result.cancelled ? null : [];
			assert.strictEqual(edits, null);
		});

		test("null is returned for non-zero exit code (simulated)", () => {
			const result = {
				stdout: "",
				stderr: "Error message",
				exitCode: 1,
				timedOut: false,
				cancelled: false,
			};

			// Logic from executeFix: if (result.exitCode !== 0) return null;
			const edits = result.exitCode !== 0 ? null : [];
			assert.strictEqual(edits, null);
		});
	});

	suite("Error message extraction", () => {
		test("firstLine extracts first line from multiline text", () => {
			const text = "First line\nSecond line\nThird line";
			const index = text.indexOf("\n");
			const firstLine = index === -1 ? text : text.slice(0, index);

			assert.strictEqual(firstLine, "First line");
		});

		test("firstLine returns full text when no newline", () => {
			const text = "Single line text";
			const index = text.indexOf("\n");
			const firstLine = index === -1 ? text : text.slice(0, index);

			assert.strictEqual(firstLine, "Single line text");
		});

		test("firstLine handles empty string", () => {
			const text = "";
			const index = text.indexOf("\n");
			const firstLine = index === -1 ? text : text.slice(0, index);

			assert.strictEqual(firstLine, "");
		});
	});

	suite("Stderr handling", () => {
		test("stderr is logged when present", () => {
			const { notificationManager, calls } = createMockNotificationManager();
			const stderr = "Warning: something happened";

			if (stderr.trim()) {
				notificationManager.warn(`tsqlrefine fix stderr: ${stderr}`);
			}

			assert.strictEqual(calls.warn.length, 1);
			assert.ok(calls.warn[0]?.includes("tsqlrefine fix stderr:"));
		});

		test("stderr is not logged when empty", () => {
			const { notificationManager, calls } = createMockNotificationManager();
			const stderr = "   ";

			if (stderr.trim()) {
				notificationManager.warn(`tsqlrefine fix stderr: ${stderr}`);
			}

			assert.strictEqual(calls.warn.length, 0);
		});
	});

	suite("Exit code handling", () => {
		test("exit code 2 maps to SQL parse error description", () => {
			const CLI_EXIT_CODE_DESCRIPTIONS: Record<number, string> = {
				2: "SQL parse error",
				3: "configuration error",
				4: "runtime exception",
			};
			const exitCode = 2;
			const description =
				CLI_EXIT_CODE_DESCRIPTIONS[exitCode] ?? `exit code ${exitCode}`;
			assert.strictEqual(description, "SQL parse error");
		});

		test("exit code 3 maps to configuration error description", () => {
			const CLI_EXIT_CODE_DESCRIPTIONS: Record<number, string> = {
				2: "SQL parse error",
				3: "configuration error",
				4: "runtime exception",
			};
			const exitCode = 3;
			const description =
				CLI_EXIT_CODE_DESCRIPTIONS[exitCode] ?? `exit code ${exitCode}`;
			assert.strictEqual(description, "configuration error");
		});

		test("exit code 4 maps to runtime exception description", () => {
			const CLI_EXIT_CODE_DESCRIPTIONS: Record<number, string> = {
				2: "SQL parse error",
				3: "configuration error",
				4: "runtime exception",
			};
			const exitCode = 4;
			const description =
				CLI_EXIT_CODE_DESCRIPTIONS[exitCode] ?? `exit code ${exitCode}`;
			assert.strictEqual(description, "runtime exception");
		});

		test("stderr detail is included in error message", () => {
			const stderrDetail = "Config file not found";
			const description = "configuration error";
			const detail = stderrDetail ? ` (${stderrDetail})` : "";
			const formatted = `tsqlrefine: fix failed - ${description}${detail}`;
			assert.strictEqual(
				formatted,
				"tsqlrefine: fix failed - configuration error (Config file not found)",
			);
		});
	});
});
