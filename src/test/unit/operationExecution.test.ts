import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import {
	reportCliFailure,
	runWithInFlight,
} from "../../server/shared/operationExecution";
import { DocumentStateManager } from "../../server/state/documentStateManager";
import { NotificationManager } from "../../server/state/notificationManager";

function createHarness() {
	const warnings: string[] = [];
	const logs: string[] = [];
	const connection = {
		window: {
			showWarningMessage: async (message: string) => {
				warnings.push(message);
			},
		},
		console: {
			debug: () => {},
			log: () => {},
			warn: (message: string) => logs.push(message),
			error: () => {},
		},
	} as unknown as Connection;
	return {
		connection,
		notificationManager: new NotificationManager(connection),
		warnings,
		logs,
	};
}

suite("runWithInFlight", () => {
	test("clears its controller after success", async () => {
		const stateManager = new DocumentStateManager();
		const uri = "file:///test.sql";

		const execution = await runWithInFlight(stateManager, uri, async () => 42);

		assert.strictEqual(execution.result, 42);
		assert.strictEqual(stateManager.getInFlight(uri), undefined);
	});

	test("an older failing operation does not clear a newer controller", async () => {
		const stateManager = new DocumentStateManager();
		const uri = "file:///test.sql";
		const newerController = new AbortController();

		await assert.rejects(
			runWithInFlight(stateManager, uri, async () => {
				stateManager.setInFlight(uri, newerController);
				throw new Error("older operation failed");
			}),
		);

		assert.strictEqual(stateManager.getInFlight(uri), newerController);
	});
});

suite("reportCliFailure", () => {
	test("reports timeouts consistently", () => {
		const harness = createHarness();

		const shouldStop = reportCliFailure({
			result: {
				stdout: "",
				stderr: "",
				exitCode: null,
				timedOut: true,
				cancelled: false,
			},
			operation: "format",
			deps: harness,
			successExitCodes: [0],
		});

		assert.strictEqual(shouldStop, true);
		assert.deepStrictEqual(harness.warnings, ["tsqlrefine: format timed out"]);
	});

	test("accepts lint exit code 1 and reports stderr through notifyStderr", () => {
		const harness = createHarness();

		const shouldStop = reportCliFailure({
			result: {
				stdout: "{}",
				stderr: "lint detail",
				exitCode: 1,
				timedOut: false,
				cancelled: false,
			},
			operation: "lint",
			deps: harness,
			successExitCodes: [0, 1],
		});

		assert.strictEqual(shouldStop, false);
		assert.ok(harness.logs.includes("lint detail"));
	});

	test("reports unsuccessful exit codes with the first stderr line", () => {
		const harness = createHarness();

		const shouldStop = reportCliFailure({
			result: {
				stdout: "",
				stderr: "bad config\nmore detail",
				exitCode: 3,
				timedOut: false,
				cancelled: false,
			},
			operation: "fix",
			deps: harness,
			successExitCodes: [0],
		});

		assert.strictEqual(shouldStop, true);
		assert.ok(
			harness.warnings.includes(
				"tsqlrefine: fix failed - configuration error (bad config)",
			),
		);
	});
});
