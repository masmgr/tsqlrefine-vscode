import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import {
	logOperationContext,
	type OperationLogContext,
} from "../../server/shared/logging";
import type { NotificationManager } from "../../server/state/notificationManager";

/**
 * Mock notification manager for testing.
 */
function createMockNotificationManager(): {
	manager: NotificationManager;
	logs: string[];
} {
	const logs: string[] = [];

	const manager = {
		log: (message: string) => {
			logs.push(message);
		},
		warn: () => {},
		error: () => {},
		notifyStderr: () => {},
		notifyRunFailure: () => {},
		isMissingTsqlRefineError: () => false,
		maybeNotifyMissingTsqlRefine: async () => {},
		lastMissingTsqlRefineNoticeAtMs: 0,
		connection: {} as Connection,
	} as unknown as NotificationManager;

	return { manager, logs };
}

suite("logOperationContext", () => {
	test("logs lint operation context", () => {
		const { manager, logs } = createMockNotificationManager();

		const context: OperationLogContext = {
			operation: "Lint",
			uri: "file:///workspace/test.sql",
			filePath: "/workspace/test.sql",
			cwd: "/workspace",
			configPath: "/workspace/tsqlrefine.config.json",
			targetFilePath: "/tmp/test.sql",
			isSavedFile: true,
		};

		logOperationContext(manager, context);

		assert.ok(logs.length > 0);
		assert.ok(logs.some((log) => log.includes("[executeLint]")));
		assert.ok(
			logs.some((log) => log.includes("URI: file:///workspace/test.sql")),
		);
		assert.ok(
			logs.some((log) => log.includes("File path: /workspace/test.sql")),
		);
		assert.ok(
			logs.some((log) => log.includes("Target file path: /tmp/test.sql")),
		);
		assert.ok(logs.some((log) => log.includes("CWD: /workspace")));
		assert.ok(logs.some((log) => log.includes("Is saved: true")));
		assert.ok(
			logs.some((log) =>
				log.includes("Config path: /workspace/tsqlrefine.config.json"),
			),
		);
	});

	test("logs format operation context", () => {
		const { manager, logs } = createMockNotificationManager();

		const context: OperationLogContext = {
			operation: "Format",
			uri: "file:///workspace/test.sql",
			filePath: "/workspace/test.sql",
			cwd: "/workspace",
			configPath: undefined,
		};

		logOperationContext(manager, context);

		assert.ok(logs.length > 0);
		assert.ok(logs.some((log) => log.includes("[executeFormat]")));
		assert.ok(
			logs.some((log) => log.includes("URI: file:///workspace/test.sql")),
		);
		assert.ok(
			logs.some((log) => log.includes("File path: /workspace/test.sql")),
		);
		assert.ok(logs.some((log) => log.includes("CWD: /workspace")));
		assert.ok(
			logs.some((log) => log.includes("Config path: (tsqlrefine default)")),
		);
	});

	test("logs fix operation context", () => {
		const { manager, logs } = createMockNotificationManager();

		const context: OperationLogContext = {
			operation: "Fix",
			uri: "file:///workspace/test.sql",
			filePath: "/workspace/test.sql",
			cwd: "/workspace",
			configPath: "/custom/config.json",
		};

		logOperationContext(manager, context);

		assert.ok(logs.length > 0);
		assert.ok(logs.some((log) => log.includes("[executeFix]")));
		assert.ok(
			logs.some((log) => log.includes("Config path: /custom/config.json")),
		);
	});

	test("omits optional fields when not provided", () => {
		const { manager, logs } = createMockNotificationManager();

		const context: OperationLogContext = {
			operation: "Format",
			uri: "file:///test.sql",
			filePath: "/test.sql",
			cwd: "/",
			configPath: undefined,
		};

		logOperationContext(manager, context);

		// Should not include target file path or saved status for Format
		assert.ok(!logs.some((log) => log.includes("Target file path")));
		assert.ok(!logs.some((log) => log.includes("Is saved")));
	});

	test("handles missing configPath", () => {
		const { manager, logs } = createMockNotificationManager();

		const context: OperationLogContext = {
			operation: "Lint",
			uri: "file:///test.sql",
			filePath: "/test.sql",
			cwd: "/",
			configPath: undefined,
			targetFilePath: "/test.sql",
			isSavedFile: false,
		};

		logOperationContext(manager, context);

		assert.ok(
			logs.some((log) => log.includes("Config path: (tsqlrefine default)")),
		);
	});
});
