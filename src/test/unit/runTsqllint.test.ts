import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { defaultSettings } from "../../server/config/settings";
import {
	runTsqllint,
	verifyTsqllintInstallation,
} from "../../server/lint/runTsqllint";
import { rmWithRetry } from "../helpers/cleanup";
import { createFakeCli } from "../helpers/fakeCli";

suite("runTsqllint", () => {
	test("runs configured executable and captures output", async () => {
		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify(args));
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		const filePath = path.join(tempDir, "query.sql");
		const configPath = path.join(tempDir, "tsqlrefine.json");
		await fs.writeFile(filePath, "select 1;", "utf8");
		await fs.writeFile(configPath, "{}", "utf8");

		try {
			const result = await runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					configPath,
					timeoutMs: 2000,
				},
				signal: new AbortController().signal,
			});

			const args = JSON.parse(result.stdout);
			assert.deepStrictEqual(args, ["lint", "-c", configPath, filePath]);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.cancelled, false);
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("passes content via stdin when stdin option is provided", async () => {
		const fakeCli = await createFakeCli(`
let stdinData = '';
process.stdin.on('data', chunk => { stdinData += chunk; });
process.stdin.on('end', () => {
	const args = process.argv.slice(2);
	process.stdout.write(JSON.stringify({ args, stdin: stdinData }));
});
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		const configPath = path.join(tempDir, "tsqlrefine.json");
		await fs.writeFile(configPath, "{}", "utf8");
		const stdinContent = "SELECT * FROM users;";

		try {
			const result = await runTsqllint({
				filePath: "untitled.sql",
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					configPath,
					timeoutMs: 2000,
				},
				signal: new AbortController().signal,
				stdin: stdinContent,
			});

			const output = JSON.parse(result.stdout);
			assert.deepStrictEqual(output.args, [
				"lint",
				"-c",
				configPath,
				"--stdin",
			]);
			assert.strictEqual(output.stdin, stdinContent);
			assert.strictEqual(result.exitCode, 0);
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("reads from file when stdin is null", async () => {
		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify(args));
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		const filePath = path.join(tempDir, "query.sql");
		await fs.writeFile(filePath, "select 1;", "utf8");

		try {
			const result = await runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					timeoutMs: 2000,
				},
				signal: new AbortController().signal,
				stdin: null,
			});

			const args = JSON.parse(result.stdout);
			assert.deepStrictEqual(args, ["lint", filePath]);
			assert.strictEqual(result.exitCode, 0);
		} finally {
			await fakeCli.cleanup();
			await rmWithRetry(tempDir);
		}
	});

	test("returns timedOut when process exceeds timeout", async function () {
		this.timeout(5000);
		const fakeCli = await createFakeCli(`
setTimeout(() => {
	process.stdout.write("late output");
}, 2000);
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		const filePath = path.join(tempDir, "query.sql");
		await fs.writeFile(filePath, "select 1;", "utf8");

		try {
			const result = await runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					timeoutMs: 200,
				},
				signal: new AbortController().signal,
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
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		const filePath = path.join(tempDir, "query.sql");
		await fs.writeFile(filePath, "select 1;", "utf8");
		const controller = new AbortController();

		try {
			const runPromise = runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: fakeCli.commandPath,
					timeoutMs: 2000,
				},
				signal: controller.signal,
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

	suite("Error scenarios", () => {
		test("handles stderr output as part of result", async () => {
			const fakeCli = await createFakeCli(`
process.stderr.write("warning: deprecated option\\n");
process.stdout.write("file.sql(1,1): error rule : message");
`);
			const tempDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "tsqlrefine-test-"),
			);
			const filePath = path.join(tempDir, "query.sql");
			await fs.writeFile(filePath, "select 1;", "utf8");

			try {
				const result = await runTsqllint({
					filePath,
					cwd: tempDir,
					settings: {
						...defaultSettings,
						path: fakeCli.commandPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
				});

				assert.ok(result.stderr.includes("warning"));
				assert.ok(result.stdout.includes("error"));
			} finally {
				await fakeCli.cleanup();
				await rmWithRetry(tempDir);
			}
		});

		test("handles CLI exit with non-zero code", async () => {
			const fakeCli = await createFakeCli(`
process.stdout.write("error occurred");
process.exit(1);
`);
			const tempDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "tsqlrefine-test-"),
			);
			const filePath = path.join(tempDir, "query.sql");
			await fs.writeFile(filePath, "select 1;", "utf8");

			try {
				const result = await runTsqllint({
					filePath,
					cwd: tempDir,
					settings: {
						...defaultSettings,
						path: fakeCli.commandPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
				});

				assert.strictEqual(result.exitCode, 1);
				assert.ok(result.stdout.includes("error occurred"));
			} finally {
				await fakeCli.cleanup();
				await rmWithRetry(tempDir);
			}
		});

		test("handles empty stdout and stderr", async () => {
			const fakeCli = await createFakeCli(`
// Exit immediately with no output
process.exit(0);
`);
			const tempDir = await fs.mkdtemp(
				path.join(os.tmpdir(), "tsqlrefine-test-"),
			);
			const filePath = path.join(tempDir, "query.sql");
			await fs.writeFile(filePath, "select 1;", "utf8");

			try {
				const result = await runTsqllint({
					filePath,
					cwd: tempDir,
					settings: {
						...defaultSettings,
						path: fakeCli.commandPath,
						timeoutMs: 2000,
					},
					signal: new AbortController().signal,
				});

				assert.strictEqual(result.stdout, "");
				assert.strictEqual(result.stderr, "");
				assert.strictEqual(result.exitCode, 0);
			} finally {
				await fakeCli.cleanup();
				await rmWithRetry(tempDir);
			}
		});
	});
});

suite("verifyTsqllintInstallation", () => {
	test("returns available=true when tsqlrefine is found", async () => {
		const fakeCli = await createFakeCli(`process.exit(0);`);
		try {
			const result = await verifyTsqllintInstallation({
				...defaultSettings,
				path: fakeCli.commandPath,
			});
			assert.strictEqual(result.available, true);
			assert.strictEqual(result.message, undefined);
		} finally {
			await fakeCli.cleanup();
		}
	});

	test("returns available=false with message when custom path not found", async () => {
		const nonexistentPath = path.join(
			os.tmpdir(),
			"nonexistent-tsqlrefine-12345",
		);
		const result = await verifyTsqllintInstallation({
			...defaultSettings,
			path: nonexistentPath,
		});
		assert.strictEqual(result.available, false);
		assert.ok(result.message);
		assert.ok(result.message.includes("not found"));
	});

	test("returns available=false with message when path is not a file", async () => {
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqlrefine-test-"),
		);
		try {
			const result = await verifyTsqllintInstallation({
				...defaultSettings,
				path: tempDir,
			});
			assert.strictEqual(result.available, false);
			assert.ok(result.message);
			assert.ok(result.message.includes("not a file"));
		} finally {
			await rmWithRetry(tempDir);
		}
	});

	test("returns available=false when command not in PATH", async () => {
		const result = await verifyTsqllintInstallation(defaultSettings);
		// Result depends on actual system PATH, but should not throw
		assert.ok(typeof result.available === "boolean");
		if (!result.available) {
			assert.ok(result.message);
			assert.ok(result.message.includes("tsqlrefine not found"));
		}
	});

	test("does not throw errors when verification fails", async () => {
		const nonexistentPath = path.join(
			os.tmpdir(),
			"nonexistent-tsqlrefine-67890",
		);
		// Should not throw, just return available=false
		const result = await verifyTsqllintInstallation({
			...defaultSettings,
			path: nonexistentPath,
		});
		assert.strictEqual(result.available, false);
	});
});
