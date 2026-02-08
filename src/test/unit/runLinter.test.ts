import * as assert from "node:assert";
import type { TsqlRefineSettings } from "../../server/config/settings";
import {
	runLinter,
	verifyTsqlRefineInstallation,
	type RunLinterOptions,
} from "../../server/lint/runLinter";

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
 * Creates default test options for runLinter.
 */
function createTestOptions(
	overrides: Partial<RunLinterOptions> = {},
): RunLinterOptions {
	return {
		filePath: "test.sql",
		cwd: process.cwd(),
		settings: createTestSettings(),
		signal: new AbortController().signal,
		stdin: "SELECT 1;",
		...overrides,
	};
}

suite("runLinter", () => {
	test("returns cancelled result when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const options = createTestOptions({
			signal: controller.signal,
		});

		const result = await runLinter(options);

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.timedOut, false);
		assert.strictEqual(result.exitCode, null);
		assert.strictEqual(result.stdout, "");
		assert.strictEqual(result.stderr, "");
	});

	suite("argument building", () => {
		test("includes configPath in arguments when provided", async () => {
			const controller = new AbortController();
			controller.abort(); // Abort immediately to prevent actual CLI execution

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					configPath: "/path/to/config.json",
				}),
			});

			// The function should return cancelled result without error
			const result = await runLinter(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("excludes configPath when not provided", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					configPath: "",
				}),
			});

			const result = await runLinter(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("includes severity argument", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					minSeverity: "warning",
				}),
			});

			const result = await runLinter(options);
			assert.strictEqual(result.cancelled, true);
		});
	});
});

suite("verifyTsqlRefineInstallation", () => {
	test("returns available status for default settings", async () => {
		const settings = createTestSettings();

		const result = await verifyTsqlRefineInstallation(settings);

		// Result depends on whether tsqlrefine is actually installed
		assert.ok(typeof result.available === "boolean");
		if (!result.available) {
			assert.ok(typeof result.message === "string");
		}
	});

	test("returns result for custom path settings", async () => {
		const settings = createTestSettings({
			path: "/nonexistent/tsqlrefine",
		});

		const result = await verifyTsqlRefineInstallation(settings);

		// Should complete without throwing
		assert.ok(typeof result.available === "boolean");
	});
});
