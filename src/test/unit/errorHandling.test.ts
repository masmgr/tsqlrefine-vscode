import * as assert from "node:assert";
import {
	handleOperationError,
	type ErrorHandlerDeps,
} from "../../server/shared/errorHandling";
import type { Connection } from "vscode-languageserver/node";
import type { NotificationManager } from "../../server/state/notificationManager";

/**
 * Mock connection for testing.
 */
function createMockConnection(): {
	connection: Connection;
	warnings: string[];
} {
	const warnings: string[] = [];

	const connection = {
		window: {
			showWarningMessage: async (message: string) => {
				warnings.push(message);
			},
		},
	} as Connection;

	return { connection, warnings };
}

/**
 * Mock notification manager for testing.
 */
function createMockNotificationManager(isMissingTsqlRefine = false): {
	manager: NotificationManager;
	warns: string[];
	missingNotifications: string[];
} {
	const warns: string[] = [];
	const missingNotifications: string[] = [];

	const manager = {
		log: () => {},
		warn: (message: string) => {
			warns.push(message);
		},
		error: () => {},
		notifyStderr: () => {},
		notifyRunFailure: () => {},
		isMissingTsqlRefineError: () => isMissingTsqlRefine,
		maybeNotifyMissingTsqlRefine: async (message: string) => {
			missingNotifications.push(message);
		},
		lastMissingTsqlRefineNoticeAtMs: 0,
		connection: {} as Connection,
	} as unknown as NotificationManager;

	return { manager, warns, missingNotifications };
}

suite("handleOperationError", () => {
	test("handles missing tsqlrefine error", async () => {
		const { connection } = createMockConnection();
		const { manager, warns, missingNotifications } =
			createMockNotificationManager(true);

		const deps: ErrorHandlerDeps = {
			connection,
			notificationManager: manager,
		};

		const error = new Error("Command 'tsqlrefine' not found");

		await handleOperationError(error, deps, "format");

		assert.strictEqual(missingNotifications.length, 1);
		// The error is converted to string which includes "Error: " prefix
		assert.strictEqual(
			missingNotifications[0],
			"Error: Command 'tsqlrefine' not found",
		);
		assert.strictEqual(warns.length, 1);
		assert.ok(warns[0]?.includes("format failed"));
	});

	test("handles general error", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager, warns } = createMockNotificationManager(false);

		const deps: ErrorHandlerDeps = {
			connection,
			notificationManager: manager,
		};

		const error = new Error("Unexpected error occurred");

		await handleOperationError(error, deps, "fix");

		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0]?.includes("fix failed"));
		assert.ok(warnings[0]?.includes("Unexpected error occurred"));
		assert.strictEqual(warns.length, 1);
		assert.ok(warns[0]?.includes("fix failed"));
	});

	test("handles error with multiline message", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager } = createMockNotificationManager(false);

		const deps: ErrorHandlerDeps = {
			connection,
			notificationManager: manager,
		};

		const error = new Error("Line 1\nLine 2\nLine 3");

		await handleOperationError(error, deps, "format");

		// Should only include first line
		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0]?.includes("Line 1"));
		assert.ok(!warnings[0]?.includes("Line 2"));
	});

	test("handles non-Error object", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager, warns } = createMockNotificationManager(false);

		const deps: ErrorHandlerDeps = {
			connection,
			notificationManager: manager,
		};

		await handleOperationError("String error", deps, "lint");

		assert.strictEqual(warnings.length, 1);
		assert.ok(warnings[0]?.includes("lint failed"));
		assert.ok(warnings[0]?.includes("String error"));
		assert.strictEqual(warns.length, 1);
	});
});
