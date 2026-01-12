import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { defaultSettings } from "../server/config/settings";
import { runTsqllint } from "../server/lint/runTsqllint";
import { createFakeCli } from "./helpers/fakeCli";

suite("runTsqllint", () => {
	test("runs configured executable and captures output", async () => {
		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
process.stdout.write(JSON.stringify(args));
`);
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-test-"));
		const filePath = path.join(tempDir, "query.sql");
		const configPath = path.join(tempDir, "tsqllint.json");
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
				fix: true,
			});

			const args = JSON.parse(result.stdout);
			assert.deepStrictEqual(args, ["--fix", "-c", configPath, filePath]);
			assert.strictEqual(result.exitCode, 0);
			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.cancelled, false);
		} finally {
			await fakeCli.cleanup();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
