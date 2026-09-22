import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import { executeFormat } from "../../server/format/formatOperations";
import type { runFormatter } from "../../server/format/runFormatter";
import type { ProcessRunResult } from "../../server/shared/types";
import {
	createOperationDeps,
	createTestContext,
	createTestDocument,
	createTestSettings,
} from "../helpers/operationHarness";
import { cliResult } from "../helpers/processResults";

/**
 * `executeFormat` is a thin wrapper over `executeCliEditOperation`, so these
 * tests only cover the wiring it owns: which runner is used, what the runner is
 * handed, and that the operation is reported as "format". Every branch of the
 * shared execution path is covered by cliEditOperation.test.ts, and the
 * `enableFormat` gate belongs to server.ts (see server.test.ts).
 */

type RunnerCall = Parameters<typeof runFormatter>[0];

function setup(
	options: {
		text?: string;
		runner?: (call: RunnerCall) => Promise<ProcessRunResult>;
		/** Omit `deps.runner` entirely so the real runFormatter is used. */
		useRealRunner?: boolean;
		settings?: Parameters<typeof createTestSettings>[0];
	} = {},
) {
	const text = options.text ?? "SELECT 1;";
	const deps = createOperationDeps();
	const document = createTestDocument({ text });
	const context = createTestContext({
		uri: document.uri,
		documentText: text,
		effectiveSettings: createTestSettings(options.settings),
	});
	const calls: RunnerCall[] = [];
	const respond = options.runner ?? (async () => cliResult("SELECT 2;"));
	const runner = options.useRealRunner
		? undefined
		: async (call: RunnerCall): Promise<ProcessRunResult> => {
				calls.push(call);
				return await respond(call);
			};

	return {
		deps,
		context,
		document,
		calls,
		run: () =>
			executeFormat(context, document, {
				connection: deps.connection,
				notificationManager: deps.notificationManager,
				control: deps.control,
				...(runner ? { runner } : {}),
			}),
	};
}

suite("executeFormat", () => {
	test("passes the document context through to the injected runner", async () => {
		const harness = setup();
		await harness.run();

		assert.strictEqual(harness.calls.length, 1);
		const call = harness.calls[0];
		assert.ok(call);
		assert.strictEqual(call.cwd, harness.context.cwd);
		assert.strictEqual(call.settings, harness.context.effectiveSettings);
		assert.strictEqual(call.signal, harness.deps.control.signal);
		assert.strictEqual(call.stdin, harness.context.documentText);
	});

	test("returns a full-document edit when the CLI changes the text", async () => {
		const result = await setup().run();

		assert.ok(result);
		assert.strictEqual(result.length, 1);
		assert.deepStrictEqual(result[0]?.range.start, { line: 0, character: 0 });
		assert.strictEqual(result[0]?.newText, "SELECT 2;");
	});

	test("returns an empty edit list when the CLI output matches the document", async () => {
		const harness = setup({ runner: async () => cliResult("SELECT 1;") });

		assert.deepStrictEqual(await harness.run(), []);
	});

	test('reports the operation as "format" when the CLI returns empty output', async () => {
		const harness = setup({ runner: async () => cliResult("") });

		assert.strictEqual(await harness.run(), null);
		assert.strictEqual(
			harness.deps.warnings[0],
			"tsqlrefine: format failed - empty output for a non-empty document",
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

	test("falls back to runFormatter when no runner is injected", async () => {
		// No runner override: the real runFormatter resolves the executable and
		// fails on a path that cannot exist, which exercises the fallback without
		// needing the tsqlrefine CLI.
		const missing = path.join(os.tmpdir(), `missing-tsqlrefine-${Date.now()}`);
		const harness = setup({
			useRealRunner: true,
			settings: { path: missing },
		});

		assert.strictEqual(await harness.run(), null);
		assert.ok(
			harness.deps.console.warn.some(
				(message) =>
					message.includes("tsqlrefine: format failed") &&
					message.includes("not found"),
			),
			`unexpected console.warn: ${JSON.stringify(harness.deps.console.warn)}`,
		);
	});
});
