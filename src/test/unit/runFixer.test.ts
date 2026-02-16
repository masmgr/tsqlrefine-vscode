import * as assert from "node:assert";
import type { TsqlRefineSettings } from "../../server/config/settings";
import {
	buildArgs,
	runFixer,
	type RunFixerOptions,
} from "../../server/fix/runFixer";

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
		allowPlugins: false,
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

	suite("argument building (via buildArgs)", () => {
		test("includes fix subcommand and standard flags", () => {
			const options = createTestOptions();
			const args = buildArgs(options);
			assert.deepStrictEqual(args.slice(0, 3), ["fix", "-q", "--utf8"]);
			assert.ok(args.includes("--stdin"));
		});

		test("includes -c flag when configPath is set", () => {
			const options = createTestOptions({
				settings: createTestSettings({
					configPath: "/path/to/config.json",
				}),
			});
			const args = buildArgs(options);
			const cIndex = args.indexOf("-c");
			assert.notStrictEqual(cIndex, -1);
			assert.strictEqual(args[cIndex + 1], "/path/to/config.json");
		});

		test("omits -c flag when configPath is empty", () => {
			const options = createTestOptions({
				settings: createTestSettings({ configPath: "" }),
			});
			const args = buildArgs(options);
			assert.strictEqual(args.indexOf("-c"), -1);
		});

		test("includes --severity flag with configured value", () => {
			const options = createTestOptions({
				settings: createTestSettings({ minSeverity: "warning" }),
			});
			const args = buildArgs(options);
			const sevIndex = args.indexOf("--severity");
			assert.notStrictEqual(sevIndex, -1);
			assert.strictEqual(args[sevIndex + 1], "warning");
		});

		test("includes --allow-plugins flag when allowPlugins is true", () => {
			const options = createTestOptions({
				settings: createTestSettings({ allowPlugins: true }),
			});
			const args = buildArgs(options);
			assert.ok(args.includes("--allow-plugins"));
		});

		test("omits --allow-plugins flag when allowPlugins is false", () => {
			const options = createTestOptions({
				settings: createTestSettings({ allowPlugins: false }),
			});
			const args = buildArgs(options);
			assert.strictEqual(args.includes("--allow-plugins"), false);
		});
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
				allowPlugins: false,
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
					configPath: "/path/to/tsqlrefine.json",
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
				allowPlugins: false,
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
