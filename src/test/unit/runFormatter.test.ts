import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { defaultSettings } from "../../server/config/settings";
import { runFormatter } from "../../server/format/runFormatter";
import { rmWithRetry } from "../helpers/cleanup";
import { createFakeCli } from "../helpers/fakeCli";

suite("runFormatter", () => {
	test("runs format command with stdin and captures formatted output", async () => {
		const formattedSql = "SELECT\n    id,\n    name\nFROM users;";
		const fakeCli = await createFakeCli(`
let stdinData = '';
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
	// Output the "formatted" SQL
	process.stdout.write(${JSON.stringify(formattedSql)});
});
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-format-test-"),
		);
		const configPath = path.join(tempDir, "tsqlrefine.json");
		await fs.writeFile(configPath, "{}", "utf8");
		const inputSql = "select id,name from users;";

		try {
			const result = await runFormatter({
				filePath: "query.sql",
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					configPath,
					timeoutMs: 2000,
				},
				signal: new AbortController().signal,
				stdin: inputSql,
			});

			assert.strictEqual(result.stdout, formattedSql);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.cancelled, false);
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("passes correct arguments to CLI", async () => {
		const fakeCli = await createFakeCli(`
let stdinData = '';
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
	const args = process.argv.slice(2);
	process.stdout.write(JSON.stringify({ args, stdin: stdinData }));
});
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-format-test-"),
		);
		const configPath = path.join(tempDir, "tsqlrefine.json");
		await fs.writeFile(configPath, "{}", "utf8");

		try {
			const result = await runFormatter({
				filePath: "query.sql",
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					configPath,
					timeoutMs: 2000,
				},
				signal: new AbortController().signal,
				stdin: "select 1;",
			});

			const output = JSON.parse(result.stdout);
			assert.deepStrictEqual(output.args, [
				"format",
				"-c",
				configPath,
				"--stdin",
				"--stdin-filepath",
				"query.sql",
			]);
			assert.strictEqual(output.stdin, "select 1;");
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("uses formatTimeoutMs when specified", async function () {
		this.timeout(5000);
		const fakeCli = await createFakeCli(`
setTimeout(() => {
	process.stdout.write("late output");
}, 2000);
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-format-test-"),
		);

		try {
			const result = await runFormatter({
				filePath: "query.sql",
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					timeoutMs: 5000,
					formatTimeoutMs: 200,
				},
				signal: new AbortController().signal,
				stdin: "select 1;",
			});

			assert.strictEqual(result.timedOut, true);
			assert.strictEqual(result.cancelled, false);
			assert.strictEqual(result.exitCode, null);
		} finally {
			await new Promise((r) => setTimeout(r, 100));
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("falls back to timeoutMs when formatTimeoutMs not set", async function () {
		this.timeout(5000);
		const fakeCli = await createFakeCli(`
setTimeout(() => {
	process.stdout.write("late output");
}, 2000);
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-format-test-"),
		);

		// Create settings without formatTimeoutMs
		const settingsWithoutFormatTimeout: import("../../server/config/settings").TsqllintSettings =
			{
				path: fakeCli.commandPath,
				runOnSave: defaultSettings.runOnSave,
				runOnType: defaultSettings.runOnType,
				runOnOpen: defaultSettings.runOnOpen,
				debounceMs: defaultSettings.debounceMs,
				timeoutMs: 200, // This should be used as fallback
				maxFileSizeKb: defaultSettings.maxFileSizeKb,
				rangeMode: "character",
			};

		try {
			const result = await runFormatter({
				filePath: "query.sql",
				cwd: tempDir,
				settings: settingsWithoutFormatTimeout,
				signal: new AbortController().signal,
				stdin: "select 1;",
			});

			assert.strictEqual(result.timedOut, true);
			assert.strictEqual(result.cancelled, false);
			assert.strictEqual(result.exitCode, null);
		} finally {
			await new Promise((r) => setTimeout(r, 100));
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("returns cancelled when aborted", async () => {
		const fakeCli = await createFakeCli(`
setTimeout(() => {
	process.stdout.write("late output");
}, 2000);
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-format-test-"),
		);
		const controller = new AbortController();

		try {
			const runPromise = runFormatter({
				filePath: "query.sql",
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					timeoutMs: 2000,
				},
				signal: controller.signal,
				stdin: "select 1;",
			});

			setTimeout(() => {
				controller.abort();
			}, 100);

			const result = await runPromise;
			assert.strictEqual(result.cancelled, true);
			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.exitCode, null);
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("returns immediately when already aborted", async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await runFormatter({
			filePath: "query.sql",
			cwd: process.cwd(),
			settings: defaultSettings,
			signal: controller.signal,
			stdin: "select 1;",
		});

		assert.strictEqual(result.cancelled, true);
		assert.strictEqual(result.stdout, "");
		assert.strictEqual(result.stderr, "");
	});

	suite("Error scenarios", () => {
		test("handles stderr output as part of result", async () => {
			const fakeCli = await createFakeCli(`
let stdinData = '';
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
	process.stderr.write("warning: deprecated option\\n");
	process.stdout.write("formatted sql");
});
`);
			const tempDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "tsqlrefine-format-test-"),
			);

			try {
				const result = await runFormatter({
					filePath: "query.sql",
					cwd: tempDir,
					settings: {
						...defaultSettings,
						path: fakeCli.commandPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
					stdin: "select 1;",
				});

				assert.ok(result.stderr.includes("warning"));
				assert.ok(result.stdout.includes("formatted sql"));
			} finally {
				await fakeCli.cleanup();
				await rmWithRetry(tempDir);
			}
		});

		test("handles CLI exit with non-zero code", async () => {
			const fakeCli = await createFakeCli(`
let stdinData = '';
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
	process.stderr.write("parse error");
	process.exit(2);
});
`);
			const tempDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "tsqlrefine-format-test-"),
			);

			try {
				const result = await runFormatter({
					filePath: "query.sql",
					cwd: tempDir,
					settings: {
						...defaultSettings,
						path: fakeCli.commandPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
					stdin: "select 1;",
				});

				assert.strictEqual(result.exitCode, 2);
				assert.ok(result.stderr.includes("parse error"));
			} finally {
				await fakeCli.cleanup();
				await rmWithRetry(tempDir);
			}
		});

		test("throws when executable path not found", async () => {
			const nonexistentPath = path.join(
				os.tmpdir(),
				"nonexistent-tsqlrefine-format-12345",
			);

			await assert.rejects(
				runFormatter({
					filePath: "query.sql",
					cwd: process.cwd(),
					settings: {
						...defaultSettings,
						path: nonexistentPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
					stdin: "select 1;",
				}),
				/not found/,
			);
		});
	});
});
