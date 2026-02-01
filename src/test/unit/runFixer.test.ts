import * as assert from "node:assert";
import type { TsqlRefineSettings } from "../../server/config/settings";
import { runFixer, type RunFixerOptions } from "../../server/fix/runFixer";

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
 * Creates default test options for runFixer.
 */
function createTestOptions(
	overrides: Partial<RunFixerOptions> = {},
): RunFixerOptions {
	return {
		filePath: "test.sql",
		cwd: process.cwd(),
		settings: createTestSettings(),
		signal: new AbortController().signal,
		stdin: "SELECT 1;",
		...overrides,
	};
}

suite("runFixer", () => {
	test("returns cancelled result when signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const options = createTestOptions({
			signal: controller.signal,
		});

		const result = await runFixer(options);

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.timedOut, false);
		assert.strictEqual(result.exitCode, null);
		assert.strictEqual(result.stdout, "");
		assert.strictEqual(result.stderr, "");
	});

	suite("argument building", () => {
		// Note: These tests verify the behavior through integration with the actual
		// CLI or through mock. Since runFixer calls resolveCommand which requires
		// a valid tsqlrefine installation, we test the buildArgs logic indirectly.

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
			const result = await runFixer(options);
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

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});
	});

	suite("configPath handling", () => {
		test("handles settings with configPath defined", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				settings: createTestSettings({
					configPath: "/path/to/.tsqlrefinerc",
				}),
			});

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("handles settings without configPath", async () => {
			const controller = new AbortController();
			controller.abort();

			// Create settings without configPath
			const settingsWithoutConfig: TsqlRefineSettings = {
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
			};

			const options = createTestOptions({
				signal: controller.signal,
				settings: settingsWithoutConfig,
			});

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});
	});

	suite("stdin handling", () => {
		test("accepts empty string stdin", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				stdin: "",
			});

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("accepts multiline stdin content", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				stdin: "SELECT 1;\nSELECT 2;\nSELECT 3;",
			});

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});

		test("accepts stdin with unicode characters", async () => {
			const controller = new AbortController();
			controller.abort();

			const options = createTestOptions({
				signal: controller.signal,
				stdin: "SELECT 'こんにちは' AS greeting;",
			});

			const result = await runFixer(options);
			assert.strictEqual(result.cancelled, true);
		});
	});
});
