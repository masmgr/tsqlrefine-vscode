import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { resolveConfigPath } from "../../server/config/resolveConfigPath";
import { rmWithRetry } from "../helpers/cleanup";

suite("resolveConfigPath", () => {
	test("prefers configuredConfigPath and expands placeholders", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-test-"));
		try {
			const workspaceRoot = path.join(tempDir, "workspace");
			const filePath = path.join(workspaceRoot, "src", "query.sql");
			await fs.mkdir(path.dirname(filePath), { recursive: true });

			const resolved = await resolveConfigPath({
				configuredConfigPath: `\${workspaceFolder}/.tsqllintrc`,
				filePath,
				workspaceRoot,
			});

			assert.ok(resolved);
			assert.strictEqual(
				path.normalize(resolved),
				path.normalize(path.join(workspaceRoot, ".tsqllintrc")),
			);
		} finally {
			await rmWithRetry(tempDir);
		}
	});

	test("finds nearest .tsqllintrc when not configured", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-test-"));
		try {
			const workspaceRoot = path.join(tempDir, "workspace");
			const rootConfig = path.join(workspaceRoot, ".tsqllintrc");
			const nestedDir = path.join(workspaceRoot, "src", "nested");
			const nestedConfig = path.join(nestedDir, ".tsqllintrc");
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
		} finally {
			await rmWithRetry(tempDir);
		}
	});

	test("returns undefined when filePath is missing and config not configured", async () => {
		const resolved = await resolveConfigPath({
			configuredConfigPath: "",
			filePath: null,
			workspaceRoot: null,
		});
		assert.strictEqual(resolved, undefined);
	});
});
