import * as assert from "node:assert";
import { runProcess } from "../../server/shared/processRunner";
import { MAX_OUTPUT_BYTES } from "../../server/config/constants";

suite("runProcess", () => {
	suite("output limit", () => {
		test("kills process when stdout exceeds MAX_OUTPUT_BYTES", async () => {
			const controller = new AbortController();
			// Node script that writes more than MAX_OUTPUT_BYTES to stdout
			const overSize = MAX_OUTPUT_BYTES + 1024 * 1024;
			const result = await runProcess({
				command: process.execPath,
				args: ["-e", `process.stdout.write("x".repeat(${overSize}))`],
				cwd: process.cwd(),
				timeoutMs: 30000,
				signal: controller.signal,
			});

			assert.strictEqual(result.exitCode, null);
			assert.ok(
				result.stderr.includes("Output exceeded"),
				`stderr should contain output limit message, got: ${result.stderr}`,
			);
		});

		test("kills process when stderr exceeds MAX_OUTPUT_BYTES", async () => {
			const controller = new AbortController();
			const overSize = MAX_OUTPUT_BYTES + 1024 * 1024;
			const result = await runProcess({
				command: process.execPath,
				args: ["-e", `process.stderr.write("x".repeat(${overSize}))`],
				cwd: process.cwd(),
				timeoutMs: 30000,
				signal: controller.signal,
			});

			assert.strictEqual(result.exitCode, null);
			assert.ok(
				result.stderr.includes("Output exceeded"),
				`stderr should contain output limit message, got: ${result.stderr}`,
			);
		});

		test("kills process when combined stdout+stderr exceeds MAX_OUTPUT_BYTES", async () => {
			const controller = new AbortController();
			// Each stream outputs 60% of the limit, combined = 120% > limit
			const perStream = Math.ceil(MAX_OUTPUT_BYTES * 0.6);
			const result = await runProcess({
				command: process.execPath,
				args: [
					"-e",
					`process.stdout.write("o".repeat(${perStream})); process.stderr.write("e".repeat(${perStream}));`,
				],
				cwd: process.cwd(),
				timeoutMs: 30000,
				signal: controller.signal,
			});

			assert.strictEqual(result.exitCode, null);
			assert.ok(
				result.stderr.includes("Output exceeded"),
				`stderr should contain output limit message, got: ${result.stderr}`,
			);
		});

		test("allows output under MAX_OUTPUT_BYTES", async () => {
			const controller = new AbortController();
			const result = await runProcess({
				command: process.execPath,
				args: ["-e", 'process.stdout.write("hello")'],
				cwd: process.cwd(),
				timeoutMs: 10000,
				signal: controller.signal,
			});

			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.stdout, "hello");
			assert.ok(!result.stderr.includes("Output exceeded"));
		});
	});
});
