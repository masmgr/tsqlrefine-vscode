import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { defaultSettings } from "../../server/config/settings";
import {
	clearCommandAvailabilityCache,
	resolveCommand,
	runProcess,
} from "../../server/shared/processRunner";
import { createCancelledResult } from "../../server/shared/types";
import { rmWithRetry, sleep } from "../helpers/cleanup";
import { createStubCommandDir } from "../helpers/stubCommand";

/**
 * Failure paths of `runProcess`: timeout, cancellation, spawn errors and the
 * guards that stop a settled promise from resolving twice.
 *
 * These tests spawn real children with short real timeouts. Fake timers are
 * deliberately not used here: replacing `setTimeout` decouples the timeout from
 * the child's actual I/O events, which makes the races these tests target
 * non-deterministic.
 */

/** A child that outlives any timeout in this file. */
const sleepForever = ["-e", "setTimeout(() => {}, 10000)"];

function options(overrides: {
	args: string[];
	timeoutMs: number;
	signal: AbortSignal;
	command?: string;
}) {
	return {
		command: overrides.command ?? process.execPath,
		args: overrides.args,
		cwd: process.cwd(),
		timeoutMs: overrides.timeoutMs,
		signal: overrides.signal,
	};
}

/** Collect unhandled rejections raised while `body` runs. */
async function withUnhandledRejections(
	body: () => Promise<void>,
): Promise<unknown[]> {
	const seen: unknown[] = [];
	const onUnhandled = (reason: unknown) => seen.push(reason);
	process.on("unhandledRejection", onUnhandled);
	try {
		await body();
	} finally {
		process.off("unhandledRejection", onUnhandled);
	}
	return seen;
}

suite("runProcess failure paths", () => {
	test("resolves with a cancelled result when the signal is already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await runProcess(
			options({
				args: ["-e", 'process.stdout.write("should not run")'],
				timeoutMs: 5000,
				signal: controller.signal,
			}),
		);

		assert.deepStrictEqual(result, createCancelledResult());
	});

	test("resolves with timedOut when the child outlives timeoutMs", async () => {
		const result = await runProcess(
			options({
				args: sleepForever,
				timeoutMs: 100,
				signal: new AbortController().signal,
			}),
		);

		assert.strictEqual(result.timedOut, true);
		assert.strictEqual(result.cancelled, false);
		assert.strictEqual(result.exitCode, null);
	});

	test("does not resolve twice when the child closes after a timeout", async function () {
		this.timeout(10000);

		const rejections = await withUnhandledRejections(async () => {
			const result = await runProcess(
				options({
					args: sleepForever,
					timeoutMs: 100,
					signal: new AbortController().signal,
				}),
			);
			assert.strictEqual(result.timedOut, true);
			// The child's `close` event arrives after the promise already settled;
			// the settled guard must swallow it.
			await sleep(500);
		});

		assert.deepStrictEqual(rejections, []);
	});

	test("resolves with cancelled when the signal aborts mid-run", async function () {
		this.timeout(10000);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 100);

		const result = await runProcess(
			options({
				args: sleepForever,
				timeoutMs: 9000,
				signal: controller.signal,
			}),
		);

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.timedOut, false);
		assert.strictEqual(result.exitCode, null);
	});

	test("captures output produced before the abort", async function () {
		this.timeout(10000);
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 300);

		const result = await runProcess(
			options({
				args: [
					"-e",
					'process.stdout.write("partial"); setTimeout(() => {}, 10000);',
				],
				timeoutMs: 9000,
				signal: controller.signal,
			}),
		);

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.stdout, "partial");
	});

	test("rejects when the command cannot be spawned", async () => {
		const missing = path.join(os.tmpdir(), `missing-command-${Date.now()}`);

		await assert.rejects(
			runProcess(
				options({
					command: missing,
					args: [],
					timeoutMs: 5000,
					signal: new AbortController().signal,
				}),
			),
			/ENOENT/,
		);
	});

	test("clears the timeout timer when the spawn fails", async function () {
		this.timeout(10000);
		const missing = path.join(os.tmpdir(), `missing-command-${Date.now()}`);

		const rejections = await withUnhandledRejections(async () => {
			await assert.rejects(
				runProcess(
					options({
						command: missing,
						args: [],
						timeoutMs: 50,
						signal: new AbortController().signal,
					}),
				),
			);
			// If the timer had survived the rejection it would fire here and try to
			// settle an already-rejected promise.
			await sleep(300);
		});

		assert.deepStrictEqual(rejections, []);
	});

	// The SIGKILL escalation is guarded by `process.platform !== "win32"`, where
	// signals do not exist, so the test is only registered off Windows.
	if (process.platform !== "win32") {
		test("escalates to SIGKILL when the child ignores SIGTERM", async function () {
			this.timeout(15000);

			const rejections = await withUnhandledRejections(async () => {
				const result = await runProcess(
					options({
						args: [
							"-e",
							"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
						],
						timeoutMs: 100,
						signal: new AbortController().signal,
					}),
				);
				assert.strictEqual(result.timedOut, true);
				// The force-kill timer fires 1s after the initial kill attempt.
				await sleep(2000);
			});

			assert.deepStrictEqual(rejections, []);
		});
	}
});

suite("resolveCommand caching", () => {
	const originalPath = process.env["PATH"];
	let tempRoot: string;

	setup(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-resolve-"));
		clearCommandAvailabilityCache();
	});

	teardown(async () => {
		process.env["PATH"] = originalPath;
		clearCommandAvailabilityCache();
		await rmWithRetry(tempRoot);
	});

	test("returns the cached positive verdict without re-probing PATH", async function () {
		this.timeout(30000);
		process.env["PATH"] = await createStubCommandDir(tempRoot);

		assert.strictEqual(
			await resolveCommand(defaultSettings, tempRoot),
			"tsqlrefine",
		);

		// Second call takes the cache-hit branch: the command is gone from PATH but
		// the fresh positive verdict still stands.
		process.env["PATH"] = path.join(tempRoot, "empty");
		assert.strictEqual(
			await resolveCommand(defaultSettings, tempRoot),
			"tsqlrefine",
		);
	});
});
