import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MAX_OUTPUT_BYTES } from "../../server/config/constants";
import { defaultSettings } from "../../server/config/settings";
import { MissingTsqlRefineError } from "../../server/shared/errors";
import {
	assertPathExists,
	clearCommandAvailabilityCache,
	resolveCommand,
	runProcess,
} from "../../server/shared/processRunner";

suite("assertPathExists", () => {
	test("throws MissingTsqlRefineError when the path does not exist", async () => {
		await assert.rejects(
			assertPathExists("path-that-does-not-exist/tsqlrefine"),
			MissingTsqlRefineError,
		);
	});

	test("throws MissingTsqlRefineError when the path is not a file", async () => {
		await assert.rejects(
			assertPathExists(process.cwd()),
			MissingTsqlRefineError,
		);
	});
});

suite("clearCommandAvailabilityCache", () => {
	const originalPath = process.env["PATH"];
	let tempRoot: string;

	setup(async () => {
		tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-cache-"));
		clearCommandAvailabilityCache();
	});

	teardown(async () => {
		process.env["PATH"] = originalPath;
		clearCommandAvailabilityCache();
		await fs.rm(tempRoot, { recursive: true, force: true });
	});

	/** Creates a directory holding a spawnable no-op `tsqlrefine`. */
	async function createStubCommandDir(): Promise<string> {
		const dir = path.join(tempRoot, "bin");
		await fs.mkdir(dir, { recursive: true });
		if (process.platform === "win32") {
			// Node's spawn resolves PATHEXT, so the stub must be a real executable.
			const target = path.join(dir, "tsqlrefine.exe");
			try {
				await fs.link(process.execPath, target);
			} catch {
				await fs.copyFile(process.execPath, target);
			}
		} else {
			const target = path.join(dir, "tsqlrefine");
			await fs.writeFile(target, "#!/bin/sh\nexit 0\n");
			await fs.chmod(target, 0o755);
		}
		return dir;
	}

	test("re-checks availability after a negative result is cleared", async function () {
		this.timeout(30000);
		const emptyDir = path.join(tempRoot, "empty");
		await fs.mkdir(emptyDir, { recursive: true });

		process.env["PATH"] = emptyDir;
		await assert.rejects(
			resolveCommand(defaultSettings, tempRoot),
			MissingTsqlRefineError,
		);

		// The negative verdict is cached, so making the command available is not
		// enough on its own.
		process.env["PATH"] = await createStubCommandDir();
		await assert.rejects(
			resolveCommand(defaultSettings, tempRoot),
			MissingTsqlRefineError,
		);

		clearCommandAvailabilityCache();
		assert.strictEqual(
			await resolveCommand(defaultSettings, tempRoot),
			"tsqlrefine",
		);
	});
});

suite("runProcess", () => {
	test("handles a child closing stdin before a large write completes", async () => {
		const result = await runProcess({
			command: process.execPath,
			args: ["-e", "process.exit(0)"],
			cwd: process.cwd(),
			timeoutMs: 5000,
			signal: new AbortController().signal,
			stdin: "x".repeat(4 * 1024 * 1024),
		});

		assert.strictEqual(result.exitCode, 0);
	});
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
