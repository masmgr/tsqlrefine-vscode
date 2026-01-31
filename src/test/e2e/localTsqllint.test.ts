import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { defaultSettings } from "../../server/config/settings";
import { parseOutput } from "../../server/lint/parseOutput";
import { runTsqllint } from "../../server/lint/runTsqllint";
import { locateTsqlrefine } from "../helpers/testFixtures";

suite("E2E (local): real tsqlrefine binary", () => {
	test("runs tsqlrefine and parses diagnostics", async function () {
		this.timeout(60000);

		const tsqlrefinePath = await locateTsqlrefine();
		if (!tsqlrefinePath) {
			this.skip();
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-e2e-"));
		const filePath = path.join(tempDir, "query.sql");
		const fileText = "select from";
		await fs.writeFile(filePath, fileText, "utf8");

		try {
			const result = await runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: tsqlrefinePath,
					timeoutMs: 20000,
				},
				signal: new AbortController().signal,
				stdin: fileText,
			});

			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.cancelled, false);

			const uri = URI.file(filePath).toString();
			const diagnostics = parseOutput({
				stdout: result.stdout,
				uri,
				cwd: tempDir,
				lines: fileText.split(/\r?\n/),
				targetPaths: [filePath, "<stdin>"], // tsqlrefine outputs <stdin> when reading from stdin
			});

			assert.ok(
				diagnostics.length > 0,
				`Expected diagnostics, got stdout=${JSON.stringify(result.stdout)}`,
			);
			assert.ok(
				diagnostics.some(
					(diag: { source?: string }) => diag.source === "tsqlrefine",
				),
				"Expected tsqlrefine as Diagnostic.source",
			);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});
