import * as assert from "node:assert";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { executeLint } from "../../server/lint/lintOperations";
import type { LintReason } from "../../server/lint/scheduler";
import { MissingTsqlRefineError } from "../../server/shared/errors";
import type { ProcessRunResult } from "../../server/shared/types";
import {
	createOperationDeps,
	createTestContext,
	createTestDocument,
	createTestSettings,
} from "../helpers/operationHarness";
import { cliResult } from "../helpers/processResults";

type RunnerCall = {
	cwd: string;
	settings: unknown;
	signal: AbortSignal;
	stdin: string;
};

function setup(
	options: {
		text?: string;
		version?: number;
		settings?: Parameters<typeof createTestSettings>[0];
		isCurrent?: () => boolean;
		runner?: (call: RunnerCall) => Promise<ProcessRunResult>;
	} = {},
) {
	const text = options.text ?? "SELECT 1;";
	const deps = createOperationDeps(
		options.isCurrent ? { isCurrent: options.isCurrent } : {},
	);
	const document = createTestDocument({
		text,
		...(options.version === undefined ? {} : { version: options.version }),
	});
	const context = createTestContext({
		uri: document.uri,
		documentText: text,
		effectiveSettings: createTestSettings(options.settings),
	});
	const calls: RunnerCall[] = [];
	const respond = options.runner ?? (async () => cliResult("", 0));
	const runner = async (call: RunnerCall): Promise<ProcessRunResult> => {
		calls.push(call);
		return await respond(call);
	};

	return {
		deps,
		context,
		document,
		calls,
		run: (reason: LintReason = "manual") =>
			executeLint(context, document, reason, {
				connection: deps.connection,
				notificationManager: deps.notificationManager,
				control: deps.control,
				runner,
			}),
	};
}

suite("executeLint", () => {
	test("returns early without invoking the runner when already stale", async () => {
		const harness = setup({ isCurrent: () => false });
		const result = await harness.run();

		assert.deepStrictEqual(result, { diagnosticsCount: -1, success: false });
		assert.strictEqual(harness.calls.length, 0);
		assert.strictEqual(harness.deps.diagnostics.length, 0);
	});

	test("treats a null exit code as failure without clearing diagnostics", async () => {
		const harness = setup({
			runner: async () => ({
				stdout: "{truncated",
				stderr: "output limit exceeded",
				exitCode: null,
				timedOut: false,
				cancelled: false,
			}),
		});
		const result = await harness.run();

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.diagnosticsCount, -1);
		assert.strictEqual(harness.deps.diagnostics.length, 0);
	});

	test("reports a typed missing executable error as a diagnostic", async () => {
		const harness = setup({
			runner: async () => {
				throw new MissingTsqlRefineError(
					"tsqlrefine executable is unavailable",
				);
			},
		});
		const result = await harness.run();

		assert.strictEqual(result.success, false);
		assert.strictEqual(harness.deps.diagnostics.length, 1);
		const diagnostic = harness.deps.diagnostics[0]?.diagnostics[0];
		// LSP 3.18 widened `message` to string | MarkupContent; the server only
		// ever produces plain strings.
		const message = diagnostic?.message;
		assert.ok(
			typeof message === "string" &&
				message.includes("tsqlrefine executable is unavailable"),
			`unexpected diagnostic message: ${JSON.stringify(message)}`,
		);
		assert.strictEqual(diagnostic?.code, "tsqlrefine-not-found");
		assert.strictEqual(diagnostic?.severity, DiagnosticSeverity.Error);
	});

	test("does not wait for the missing-executable popup to be dismissed", async () => {
		const harness = setup({
			runner: async () => {
				throw new MissingTsqlRefineError("tsqlrefine not found");
			},
		});
		// The real popup carries an action button and stays unresolved until the
		// user dismisses it; awaiting it would hold the scheduler slot open.
		harness.deps.setWarningResponse(() => new Promise(() => {}));

		const result = await harness.run();

		assert.strictEqual(result.success, false);
		assert.strictEqual(harness.deps.diagnostics.length, 1);
	});

	test("routes a generic runner failure through notifyRunFailure", async () => {
		const harness = setup({
			runner: async () => {
				throw new TypeError("nope");
			},
		});
		const result = await harness.run();

		assert.deepStrictEqual(result, { diagnosticsCount: -1, success: false });
		// A non-typed failure clears the document's diagnostics rather than
		// leaving stale ones behind.
		assert.strictEqual(harness.deps.diagnostics.length, 1);
		assert.deepStrictEqual(harness.deps.diagnostics[0]?.diagnostics, []);
		assert.ok(
			harness.deps.console.warn.some((message) =>
				message.includes("run failed"),
			),
			`unexpected console.warn: ${JSON.stringify(harness.deps.console.warn)}`,
		);
	});

	test("reports a runner rejection that is not an Error", async () => {
		const harness = setup({
			// A CLI wrapper can reject with a bare value rather than an Error.
			runner: () => Promise.reject("plain string failure"),
		});
		const result = await harness.run();

		assert.deepStrictEqual(result, { diagnosticsCount: -1, success: false });
		assert.ok(
			harness.deps.console.warn.some((message) =>
				message.includes("plain string failure"),
			),
			`unexpected console.warn: ${JSON.stringify(harness.deps.console.warn)}`,
		);
	});

	suite("maxFileSizeKb", () => {
		const largeText = "SELECT 1;\n".repeat(205); // ~2KB

		test("skips the lint and publishes a file-too-large diagnostic for automatic reasons", async () => {
			const harness = setup({
				text: largeText,
				version: 4,
				settings: { maxFileSizeKb: 1 },
			});
			const result = await harness.run("save");

			assert.deepStrictEqual(result, { diagnosticsCount: 0, success: true });
			assert.strictEqual(harness.calls.length, 0);

			const published = harness.deps.diagnostics[0];
			assert.ok(published);
			assert.strictEqual(published.version, 4);
			const diagnostic = published.diagnostics[0];
			assert.strictEqual(diagnostic?.code, "lint-skipped-file-too-large");
			assert.strictEqual(diagnostic?.severity, DiagnosticSeverity.Information);
			assert.strictEqual(diagnostic?.source, "tsqlrefine");
			assert.deepStrictEqual(diagnostic?.range, {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 0 },
			});
		});

		test('still lints a large file when the reason is "manual"', async () => {
			const harness = setup({
				text: largeText,
				settings: { maxFileSizeKb: 1 },
			});
			const result = await harness.run("manual");

			assert.strictEqual(result.success, true);
			assert.strictEqual(harness.calls.length, 1);
		});

		test("does not apply the size limit when maxFileSizeKb is 0", async () => {
			const harness = setup({
				text: largeText,
				settings: { maxFileSizeKb: 0 },
			});
			await harness.run("save");

			assert.strictEqual(harness.calls.length, 1);
		});

		test("ignores a non-finite maxFileSizeKb", async () => {
			const harness = setup({
				text: largeText,
				settings: { maxFileSizeKb: Number.NaN },
			});
			await harness.run("save");

			assert.strictEqual(harness.calls.length, 1);
		});

		test("measures the size in UTF-8 bytes, not characters", async () => {
			// 400 characters, but 1200 bytes once encoded.
			const harness = setup({
				text: "あ".repeat(400),
				settings: { maxFileSizeKb: 1 },
			});
			const result = await harness.run("save");

			assert.strictEqual(harness.calls.length, 0);
			assert.strictEqual(result.diagnosticsCount, 0);
		});
	});
});
