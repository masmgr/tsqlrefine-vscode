import * as assert from "node:assert";
import type { TsqlRefineSettings } from "../../server/config/settings";
import {
	buildArgs,
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
		allowPlugins: false,
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

	suite("argument building (via buildArgs)", () => {
		test("includes lint subcommand and standard flags", () => {
			const options = createTestOptions();
			const args = buildArgs(options);
			assert.deepStrictEqual(args.slice(0, 3), ["lint", "-q", "--utf8"]);
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

		test("includes --output json flag", () => {
			const options = createTestOptions();
			const args = buildArgs(options);
			const outputIndex = args.indexOf("--output");
			assert.notStrictEqual(outputIndex, -1);
			assert.strictEqual(args[outputIndex + 1], "json");
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
