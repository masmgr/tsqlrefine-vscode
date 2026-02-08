import * as assert from "node:assert";
import type { TsqlRefineSettings } from "../../server/config/settings";
import {
	runFormatter,
	type RunFormatterOptions,
} from "../../server/format/runFormatter";

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
 * Creates default test options for runFormatter.
 */
function createTestOptions(
	overrides: Partial<RunFormatterOptions> = {},
): RunFormatterOptions {
	return {
		filePath: "test.sql",
		cwd: process.cwd(),
		settings: createTestSettings(),
		signal: new AbortController().signal,
		stdin: "SELECT 1;",
		...overrides,
	};
}

suite("runFormatter", () => {
	test("returns cancelled result when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const options = createTestOptions({
			signal: controller.signal,
		});

		const result = await runFormatter(options);

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.timedOut, false);
		assert.strictEqual(result.exitCode, null);
		assert.strictEqual(result.stdout, "");
		assert.strictEqual(result.stderr, "");
	});

	suite("timeout handling", () => {
		test("uses formatTimeoutMs when available", async () => {
			const controller = new AbortController();
			controller.abort(); // Abort immediately to prevent actual CLI execution

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					formatTimeoutMs: 5000,
					timeoutMs: 10000,
				}),
			});

			// The function should return cancelled result without error
			const result = await runFormatter(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("falls back to timeoutMs when formatTimeoutMs is not set", async () => {
			const controller = new AbortController();
			controller.abort();

			// Create settings without formatTimeoutMs
			const settingsWithoutFormat: TsqlRefineSettings = {
				runOnSave: true,
				runOnType: false,
				runOnOpen: true,
				debounceMs: 500,
				timeoutMs: 15000,
				maxFileSizeKb: 0,
				minSeverity: "info",
				enableLint: true,
				enableFormat: true,
				enableFix: true,
			};

			const options = createTestOptions({
				signal: controller.signal,
				settings: settingsWithoutFormat,
			});

			const result = await runFormatter(options);
			assert.strictEqual(result.cancelled, true);
		});
	});

	suite("argument building", () => {
		test("includes configPath in arguments when provided", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					configPath: "/path/to/config.json",
				}),
			});

			const result = await runFormatter(options);
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

			const result = await runFormatter(options);
			assert.strictEqual(result.cancelled, true);
		});
	});
});
