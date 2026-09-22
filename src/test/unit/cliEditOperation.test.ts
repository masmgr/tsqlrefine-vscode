import * as assert from "node:assert";
import * as fc from "fast-check";
import type { TextEdit } from "vscode-languageserver/node";
import {
	detectEndOfLine,
	normalizeLineEndings,
} from "../../server/lint/decodeOutput";
import { executeCliEditOperation } from "../../server/shared/cliEditOperation";
import type { ProcessRunResult } from "../../server/shared/types";
import { textWithLineEndings } from "../helpers/arbitraries";
import {
	createOperationDeps,
	createTestContext,
	createTestDocument,
} from "../helpers/operationHarness";
import {
	cliCancelled,
	cliResult,
	cliTimedOut,
} from "../helpers/processResults";

type RunnerCall = {
	cwd: string;
	settings: unknown;
	signal: AbortSignal;
	stdin: string;
};

/**
 * Wire up `executeCliEditOperation` against a recording connection, a real
 * document and a scripted runner. `isCurrent` is a function so a test can let
 * the operation pass the first staleness gate and fail a later one.
 */
function setup(
	options: {
		text?: string;
		operationName?: "format" | "fix";
		isCurrent?: () => boolean;
		runner?: (call: RunnerCall) => Promise<ProcessRunResult>;
	} = {},
) {
	const text = options.text ?? "SELECT 1;";
	const deps = createOperationDeps(
		options.isCurrent ? { isCurrent: options.isCurrent } : {},
	);
	const document = createTestDocument({ uri: "untitled:test", text });
	const context = createTestContext({
		uri: document.uri,
		filePath: "",
		workspaceRoot: null,
		documentText: text,
		isSavedFile: false,
	});
	const calls: RunnerCall[] = [];
	const runner = async (call: RunnerCall): Promise<ProcessRunResult> => {
		calls.push(call);
		return options.runner
			? await options.runner(call)
			: cliResult("SELECT 1;\n");
	};

	const run = (): Promise<TextEdit[] | null> =>
		executeCliEditOperation(context, document, deps, {
			operationName: options.operationName ?? "format",
			runner,
		});

	return { deps, context, document, calls, run };
}

suite("executeCliEditOperation", () => {
	test("rejects empty output for a non-empty document", async () => {
		const harness = setup({ runner: async () => cliResult("") });
		const result = await harness.run();

		assert.strictEqual(result, null);
		assert.ok(harness.deps.warnings[0]?.includes("empty output"));
	});

	test("allows empty output for an empty document", async () => {
		const harness = setup({
			text: "",
			operationName: "fix",
			runner: async () => cliResult(""),
		});

		assert.deepStrictEqual(await harness.run(), []);
	});

	test("returns a full-document edit when the CLI changes the text", async () => {
		const harness = setup({ runner: async () => cliResult("SELECT 2;") });
		const result = await harness.run();

		assert.ok(result);
		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0]?.range.start, { line: 0, character: 0 });
		assert.strictEqual(result[0]?.newText, "SELECT 2;");
	});

	test("returns an empty edit list when the CLI output matches the document", async () => {
		const harness = setup({ runner: async () => cliResult("SELECT 1;") });

		assert.deepStrictEqual(await harness.run(), []);
	});

	test("returns null without invoking the runner when the operation is already stale", async () => {
		const harness = setup({ isCurrent: () => false });

		assert.strictEqual(await harness.run(), null);
		assert.strictEqual(harness.calls.length, 0);
		assert.deepStrictEqual(harness.deps.warnings, []);
	});

	test("reports a runner rejection through handleOperationError", async () => {
		const harness = setup({
			runner: async () => {
				throw new Error("boom");
			},
		});

		assert.strictEqual(await harness.run(), null);
		assert.ok(
			harness.deps.console.warn.some((message) =>
				message.includes("tsqlrefine: format failed (boom)"),
			),
			`unexpected console.warn: ${JSON.stringify(harness.deps.console.warn)}`,
		);
	});

	test("swallows a runner rejection that arrives after cancellation", async () => {
		let calls = 0;
		const harness = setup({
			// Open for the entry gate, closed by the time the rejection is handled.
			isCurrent: () => ++calls < 2,
			runner: async () => {
				throw new Error("boom");
			},
		});

		assert.strictEqual(await harness.run(), null);
		assert.deepStrictEqual(harness.deps.warnings, []);
		assert.deepStrictEqual(harness.deps.console.warn, []);
	});

	test("returns null after the runner resolves if the operation went stale", async () => {
		let calls = 0;
		const harness = setup({
			isCurrent: () => ++calls < 2,
			runner: async () => cliResult("SELECT 2;"),
		});

		assert.strictEqual(await harness.run(), null);
		assert.strictEqual(harness.calls.length, 1);
		assert.deepStrictEqual(harness.deps.warnings, []);
	});

	test("returns null on timeout", async () => {
		const harness = setup({ runner: async () => cliTimedOut() });

		assert.strictEqual(await harness.run(), null);
		assert.ok(harness.deps.warnings[0]?.includes("format timed out"));
	});

	test("returns null on a cancelled result without a warning", async () => {
		const harness = setup({ runner: async () => cliCancelled() });

		assert.strictEqual(await harness.run(), null);
		assert.deepStrictEqual(harness.deps.warnings, []);
	});

	test("returns null for a non-zero exit code", async () => {
		const harness = setup({
			runner: async () => cliResult("whatever", 3, "cfg bad"),
		});

		assert.strictEqual(await harness.run(), null);
		assert.ok(
			harness.deps.warnings.some((message) =>
				message.includes("format failed - configuration error (cfg bad)"),
			),
			`unexpected warnings: ${JSON.stringify(harness.deps.warnings)}`,
		);
	});

	test("treats exit code 1 as a failure", async () => {
		const harness = setup({ runner: async () => cliResult("SELECT 2;", 1) });

		assert.strictEqual(await harness.run(), null);
		assert.ok(
			harness.deps.warnings.some((message) =>
				message.includes("format failed - exit code 1"),
			),
			`unexpected warnings: ${JSON.stringify(harness.deps.warnings)}`,
		);
	});

	test("passes the document context through to the runner", async () => {
		const harness = setup();
		await harness.run();

		const call = harness.calls[0];
		assert.ok(call);
		assert.strictEqual(call.cwd, harness.context.cwd);
		assert.strictEqual(call.settings, harness.context.effectiveSettings);
		assert.strictEqual(call.signal, harness.deps.control.signal);
		assert.strictEqual(call.stdin, harness.context.documentText);
	});

	test("normalizes CRLF output to the document's line endings", async () => {
		const harness = setup({
			text: "SELECT 1;\r\nSELECT 2;",
			runner: async () => cliResult("SELECT 1;\nSELECT 2;"),
		});

		// Same content, different line endings: not a change.
		assert.deepStrictEqual(await harness.run(), []);
	});

	test("normalizes LF output to CRLF when the document uses CRLF", async () => {
		const harness = setup({
			text: "SELECT 1;\r\nSELECT 2;",
			runner: async () => cliResult("SELECT 1;\nSELECT 2;\nSELECT 3;"),
		});
		const result = await harness.run();

		assert.ok(result);
		assert.strictEqual(
			result[0]?.newText,
			"SELECT 1;\r\nSELECT 2;\r\nSELECT 3;",
		);
	});

	suite("Property-based tests", () => {
		test("property: echoing the document text never produces an edit", async () => {
			await fc.assert(
				fc.asyncProperty(
					textWithLineEndings,
					fc.constantFrom("\n", "\r\n"),
					async (text, echoEnding) => {
						fc.pre(text.length > 0);
						// Only documents whose own line endings are already consistent
						// can round-trip: normalization maps a lone CR to LF, so a
						// CR-separated document would legitimately produce an edit.
						fc.pre(normalizeLineEndings(text, detectEndOfLine(text)) === text);
						// The runner echoes the same content with its own line endings;
						// normalization must map it back onto the document's.
						const echoed = text
							.replace(/\r\n|\r|\n/g, "\n")
							.replace(/\n/g, echoEnding);
						const harness = setup({
							text,
							runner: async () => cliResult(echoed),
						});

						assert.deepStrictEqual(await harness.run(), []);
					},
				),
			);
		});
	});
});
