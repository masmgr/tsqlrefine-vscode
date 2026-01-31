import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { NotificationManager } from "../../server/state/notificationManager";

/**
 * Interface for tracking mock connection calls.
 */
interface MockConnectionCalls {
	showWarningMessage: Array<{ message: string; actions: unknown[] }>;
	sendNotification: Array<{ method: string }>;
	consoleLog: string[];
	consoleWarn: string[];
	consoleError: string[];
}

/**
 * Creates a mock Connection for testing NotificationManager.
 */
function createMockConnection(warningResponse?: { title: string }): {
	connection: Connection;
	calls: MockConnectionCalls;
} {
	const calls: MockConnectionCalls = {
		showWarningMessage: [],
		sendNotification: [],
		consoleLog: [],
		consoleWarn: [],
		consoleError: [],
	};

	const connection = {
		window: {
			showWarningMessage: async (message: string, ...actions: unknown[]) => {
				calls.showWarningMessage.push({ message, actions });
				return warningResponse;
			},
		},
		console: {
			log: (message: string) => {
				calls.consoleLog.push(message);
			},
			warn: (message: string) => {
				calls.consoleWarn.push(message);
			},
			error: (message: string) => {
				calls.consoleError.push(message);
			},
		},
		sendNotification: (method: string) => {
			calls.sendNotification.push({ method });
		},
	} as unknown as Connection;

	return { connection, calls };
}

suite("NotificationManager", () => {
	suite("constructor", () => {
		test("creates instance with connection", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);
			assert.ok(manager);
		});
	});

	suite("maybeNotifyMissingTsqllint", () => {
		test("shows warning message on first call", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.ok(
				calls.showWarningMessage[0]?.message.includes("tsqlrefine not found"),
			);
		});

		test("does not show warning within cooldown period", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");
			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");

			assert.strictEqual(calls.showWarningMessage.length, 1);
		});

		test("sends notification when user clicks Open Install Guide", async () => {
			const { connection, calls } = createMockConnection({
				title: "Open Install Guide",
			});
			const manager = new NotificationManager(connection);

			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");

			assert.strictEqual(calls.sendNotification.length, 1);
			assert.strictEqual(
				calls.sendNotification[0]?.method,
				"tsqlrefine/openInstallGuide",
			);
		});

		test("does not send notification when user dismisses warning", async () => {
			const { connection, calls } = createMockConnection(undefined);
			const manager = new NotificationManager(connection);

			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");

			assert.strictEqual(calls.sendNotification.length, 0);
		});

		test("includes action button in warning message", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			await manager.maybeNotifyMissingTsqllint("tsqlrefine not found");

			assert.strictEqual(calls.showWarningMessage.length, 1);
			const actions = calls.showWarningMessage[0]?.actions;
			assert.ok(Array.isArray(actions));
			assert.strictEqual(actions.length, 1);
			assert.deepStrictEqual(actions[0], { title: "Open Install Guide" });
		});
	});

	suite("notifyRunFailure", () => {
		test("shows warning message with error", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyRunFailure(new Error("spawn ENOENT"));

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.ok(calls.showWarningMessage[0]?.message.includes("failed to run"));
		});

		test("logs error to console", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyRunFailure("some error");

			assert.strictEqual(calls.consoleWarn.length, 1);
			assert.ok(calls.consoleWarn[0]?.includes("failed to run"));
		});

		test("handles non-string errors", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyRunFailure({ code: "ENOENT" });

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.ok(
				calls.showWarningMessage[0]?.message.includes("[object Object]"),
			);
		});
	});

	suite("notifyStderr", () => {
		test("shows warning for non-empty stderr", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyStderr("Warning: deprecated syntax");

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.ok(
				calls.showWarningMessage[0]?.message.includes("deprecated syntax"),
			);
		});

		test("logs stderr to console", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyStderr("Warning: deprecated syntax");

			assert.strictEqual(calls.consoleWarn.length, 1);
			assert.ok(calls.consoleWarn[0]?.includes("deprecated syntax"));
		});

		test("does not show warning for empty stderr", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyStderr("");

			assert.strictEqual(calls.showWarningMessage.length, 0);
		});

		test("does not show warning for whitespace-only stderr", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyStderr("   \n\t  ");

			assert.strictEqual(calls.showWarningMessage.length, 0);
		});

		test("extracts first line for warning message", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.notifyStderr("First line\nSecond line\nThird line");

			assert.strictEqual(calls.showWarningMessage.length, 1);
			assert.ok(calls.showWarningMessage[0]?.message.includes("First line"));
			assert.ok(!calls.showWarningMessage[0]?.message.includes("Second line"));
		});
	});

	suite("isMissingTsqllintError", () => {
		test("returns true for tsqlrefine not found", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);

			assert.strictEqual(
				manager.isMissingTsqllintError("tsqlrefine not found in PATH"),
				true,
			);
		});

		test("returns true for tsqlrefine.path not found", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);

			assert.strictEqual(
				manager.isMissingTsqllintError(
					"tsqlrefine.path not found: /invalid/path",
				),
				true,
			);
		});

		test("returns true for tsqlrefine.path is not a file", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);

			assert.strictEqual(
				manager.isMissingTsqllintError("tsqlrefine.path is not a file"),
				true,
			);
		});

		test("returns false for other errors", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);

			assert.strictEqual(manager.isMissingTsqllintError("spawn ENOENT"), false);
		});

		test("is case-insensitive", () => {
			const { connection } = createMockConnection();
			const manager = new NotificationManager(connection);

			assert.strictEqual(
				manager.isMissingTsqllintError("TSQLREFINE NOT FOUND"),
				true,
			);
		});
	});

	suite("log", () => {
		test("logs message to console", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.log("Test log message");

			assert.strictEqual(calls.consoleLog.length, 1);
			assert.strictEqual(calls.consoleLog[0], "Test log message");
		});
	});

	suite("warn", () => {
		test("logs warning to console", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.warn("Test warning message");

			assert.strictEqual(calls.consoleWarn.length, 1);
			assert.strictEqual(calls.consoleWarn[0], "Test warning message");
		});
	});

	suite("error", () => {
		test("logs error to console", () => {
			const { connection, calls } = createMockConnection();
			const manager = new NotificationManager(connection);

			manager.error("Test error message");

			assert.strictEqual(calls.consoleError.length, 1);
			assert.strictEqual(calls.consoleError[0], "Test error message");
		});
	});
});
