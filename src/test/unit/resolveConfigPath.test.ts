import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type Clock, install } from "@sinonjs/fake-timers";
import {
	CONFIG_CACHE_MAX_SIZE,
	CONFIG_CACHE_TTL_MS,
} from "../../server/config/constants";
import {
	clearConfigPathCache,
	resolveConfigPath,
} from "../../server/config/resolveConfigPath";
import { rmWithRetry } from "../helpers/cleanup";

suite("resolveConfigPath", () => {
	let tempDir: string;

	setup(async () => {
		clearConfigPathCache();
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-test-"));
	});

	teardown(async () => {
		clearConfigPathCache();
		await rmWithRetry(tempDir);
	});

	test("prefers configuredConfigPath and expands placeholders", async () => {
		const workspaceRoot = path.join(tempDir, "workspace");
		const filePath = path.join(workspaceRoot, "src", "query.sql");
		await fs.mkdir(path.dirname(filePath), { recursive: true });

		const resolved = await resolveConfigPath({
			configuredConfigPath: `\${workspaceFolder}/tsqlrefine.json`,
			filePath,
			workspaceRoot,
		});

		assert.ok(resolved);
		assert.strictEqual(
			path.normalize(resolved),
			path.normalize(path.join(workspaceRoot, "tsqlrefine.json")),
		);
	});

	test("expands placeholders to empty strings when no file or workspace is given", async () => {
		const resolved = await resolveConfigPath({
			configuredConfigPath: `\${workspaceFolder}|\${workspaceRoot}|\${file}|\${fileDirname}`,
			filePath: null,
			workspaceRoot: null,
		});

		assert.strictEqual(resolved, "|||");
	});

	test("finds nearest tsqlrefine.json when not configured", async () => {
		const workspaceRoot = path.join(tempDir, "workspace");
		const rootConfig = path.join(workspaceRoot, "tsqlrefine.json");
		const nestedDir = path.join(workspaceRoot, "src", "nested");
		const nestedConfig = path.join(nestedDir, "tsqlrefine.json");
		const filePath = path.join(nestedDir, "query.sql");

		await fs.mkdir(nestedDir, { recursive: true });
		await fs.writeFile(rootConfig, "{}", "utf8");
		await fs.writeFile(nestedConfig, "{}", "utf8");
		await fs.writeFile(filePath, "select 1;", "utf8");

		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			filePath,
			workspaceRoot,
		});

		assert.strictEqual(resolved, nestedConfig);
	});

	test("walks up to the workspace root when the start directory has no config", async () => {
		const workspaceRoot = path.join(tempDir, "workspace");
		const rootConfig = path.join(workspaceRoot, "tsqlrefine.json");
		const nestedDir = path.join(workspaceRoot, "a", "b", "c");

		await fs.mkdir(nestedDir, { recursive: true });
		await fs.writeFile(rootConfig, "{}", "utf8");

		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			filePath: path.join(nestedDir, "query.sql"),
			workspaceRoot,
		});

		assert.strictEqual(resolved, rootConfig);
	});

	test("returns undefined when filePath is missing and config not configured", async () => {
		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			filePath: null,
			workspaceRoot: null,
		});
		assert.strictEqual(resolved, undefined);
	});

	test("returns undefined when the file lives outside the workspace root", async () => {
		const workspaceRoot = path.join(tempDir, "workspace");
		const outsideDir = path.join(tempDir, "outside", "sub");
		await fs.mkdir(workspaceRoot, { recursive: true });
		await fs.mkdir(outsideDir, { recursive: true });

		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			filePath: path.join(outsideDir, "query.sql"),
			workspaceRoot,
		});

		assert.strictEqual(resolved, undefined);
	});

	test("stops at the filesystem root without looping", async function () {
		// A runaway walk-up would hang rather than fail, so cap the test.
		this.timeout(2000);
		const filesystemRoot = path.parse(tempDir).root;

		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			// startDir is the filesystem root, which is outside (above) stopDir.
			filePath: path.join(filesystemRoot, "query.sql"),
			workspaceRoot: tempDir,
		});

		assert.strictEqual(resolved, undefined);
	});

	suite("caching", () => {
		let clock: Clock & { uninstall: () => void };

		setup(() => {
			// Only Date is faked: cache expiry is driven purely by Date.now(), and
			// leaving the real timers and microtask queue alone keeps the real fs
			// calls in these tests working.
			clock = install({ now: Date.now(), toFake: ["Date"] });
		});

		teardown(() => {
			clock.uninstall();
		});

		test("returns the cached value within the TTL", async () => {
			const filePath = path.join(tempDir, "query.sql");
			assert.strictEqual(
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath,
					workspaceRoot: tempDir,
				}),
				undefined,
			);

			await fs.writeFile(path.join(tempDir, "tsqlrefine.json"), "{}", "utf8");
			clock.tick(CONFIG_CACHE_TTL_MS - 1);

			assert.strictEqual(
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath,
					workspaceRoot: tempDir,
				}),
				undefined,
			);
		});

		test("re-resolves after the cache TTL expires", async () => {
			const filePath = path.join(tempDir, "query.sql");
			await resolveConfigPath({
				configuredConfigPath: "",
				filePath,
				workspaceRoot: tempDir,
			});

			const configPath = path.join(tempDir, "tsqlrefine.json");
			await fs.writeFile(configPath, "{}", "utf8");
			clock.tick(CONFIG_CACHE_TTL_MS + 1);

			assert.strictEqual(
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath,
					workspaceRoot: tempDir,
				}),
				configPath,
			);
		});

		test("evicts the oldest entry once the cache exceeds CONFIG_CACHE_MAX_SIZE", async function () {
			this.timeout(20000);
			const workspaceRoot = path.join(tempDir, "ws");
			// Eviction only runs once the cache is already over the limit, so the
			// entry count has to exceed it before the next insertion triggers it.
			const dirCount = CONFIG_CACHE_MAX_SIZE + 2;
			await fs.mkdir(workspaceRoot, { recursive: true });
			for (let i = 0; i < dirCount; i++) {
				await fs.mkdir(path.join(workspaceRoot, `d${i}`), { recursive: true });
			}

			// One unique cache key per directory, each a millisecond apart so
			// "oldest" is decided by time rather than by sort stability.
			for (let i = 0; i < dirCount; i++) {
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath: path.join(workspaceRoot, `d${i}`, "query.sql"),
					workspaceRoot,
				});
				clock.tick(1);
			}

			// d0 was the oldest entry, so it was evicted despite still being inside
			// the TTL: its answer is recomputed and now finds the new config.
			const configPath = path.join(workspaceRoot, "d0", "tsqlrefine.json");
			await fs.writeFile(configPath, "{}", "utf8");

			assert.strictEqual(
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath: path.join(workspaceRoot, "d0", "query.sql"),
					workspaceRoot,
				}),
				configPath,
			);
		});

		test("clearConfigPathCache forces a re-resolution within the TTL", async () => {
			const filePath = path.join(tempDir, "query.sql");
			await resolveConfigPath({
				configuredConfigPath: "",
				filePath,
				workspaceRoot: tempDir,
			});

			const configPath = path.join(tempDir, "tsqlrefine.json");
			await fs.writeFile(configPath, "{}", "utf8");
			clearConfigPathCache();

			assert.strictEqual(
				await resolveConfigPath({
					configuredConfigPath: "",
					filePath,
					workspaceRoot: tempDir,
				}),
				configPath,
			);
		});
	});
});
