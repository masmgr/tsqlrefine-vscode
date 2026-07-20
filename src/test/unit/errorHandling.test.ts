import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import {
	type ErrorHandlerDeps,
	handleOperationError,
} from "../../server/shared/errorHandling";
import { MissingTsqlRefineError } from "../../server/shared/errors";
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
function createMockNotificationManager(): {
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
			createMockNotificationManager();

		const deps: ErrorHandlerDeps = {
			connection,
			notificationManager: manager,
		};

		const error = new MissingTsqlRefineError("Command 'tsqlrefine' not found");

		await handleOperationError(error, deps, "format");

		assert.strictEqual(missingNotifications.length, 1);
		assert.strictEqual(
			missingNotifications[0],
			"Command 'tsqlrefine' not found",
		);
		assert.strictEqual(warns.length, 1);
		assert.ok(warns[0]?.includes("format failed"));
	});

	test("handles general error", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager, warns } = createMockNotificationManager();

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

	test("does not classify a similarly worded generic error as missing", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager, missingNotifications } = createMockNotificationManager();

		await handleOperationError(
			new Error("tsqlrefine not found after an unrelated failure"),
			{ connection, notificationManager: manager },
			"format",
		);

		assert.strictEqual(missingNotifications.length, 0);
		assert.strictEqual(warnings.length, 1);
	});

	test("handles error with multiline message", async () => {
		const { connection, warnings } = createMockConnection();
		const { manager } = createMockNotificationManager();

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
		const { manager, warns } = createMockNotificationManager();

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
