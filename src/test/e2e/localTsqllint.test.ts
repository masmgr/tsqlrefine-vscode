import * as assert from "node:assert";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { defaultSettings } from "../../server/config/settings";
import { parseOutput } from "../../server/lint/parseOutput";
import { runTsqllint } from "../../server/lint/runTsqllint";

suite("E2E (local): real tsqllint binary", () => {
	test("runs tsqllint and parses diagnostics", async function () {
		this.timeout(60000);

		const tsqllintPath = await locateTsqllint();
		if (!tsqllintPath) {
			this.skip();
		}

		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqllint-e2e-"));
		const filePath = path.join(tempDir, "query.sql");
		const fileText = "select from";
		await fs.writeFile(filePath, fileText, "utf8");

		try {
			const result = await runTsqllint({
				filePath,
				cwd: tempDir,
				settings: {
					...defaultSettings,
					path: tsqllintPath,
					timeoutMs: 20000,
				},
				signal: new AbortController().signal,
			});

			assert.strictEqual(result.timedOut, false);
			assert.strictEqual(result.cancelled, false);
			assert.ok(
				result.stdout.includes(filePath),
				`Expected stdout to include file path. stdout=${JSON.stringify(
					result.stdout,
				)}`,
			);

			const uri = URI.file(filePath).toString();
			const diagnostics = parseOutput({
				stdout: result.stdout,
				uri,
				cwd: tempDir,
				lines: fileText.split(/\r?\n/),
			});

			assert.ok(
				diagnostics.length > 0,
				`Expected diagnostics, got stdout=${JSON.stringify(result.stdout)}`,
			);
			assert.ok(
				diagnostics.some(
					(diag: { source?: string }) => diag.source === "tsqllint",
				),
				"Expected tsqllint as Diagnostic.source",
			);
		} finally {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});
});

async function locateTsqllint(): Promise<string | null> {
	const command = process.platform === "win32" ? "where.exe" : "which";
	const args = ["tsqllint"];
	const result = await runCommand(command, args, 3000);
	if (result.exitCode !== 0) {
		return null;
	}
	const first = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return first ?? null;
}

async function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	return await new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timer: NodeJS.Timeout | null = setTimeout(() => {
			timer = null;
			child.kill();
			resolve({ stdout, stderr, exitCode: null });
		}, timeoutMs);

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (data: string) => {
			stdout += data;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (data: string) => {
			stderr += data;
		});
		child.on("error", () => {
			if (timer) {
				clearTimeout(timer);
			}
			resolve({ stdout, stderr, exitCode: 1 });
		});
		child.on("close", (exitCode) => {
			if (timer) {
				clearTimeout(timer);
			}
			resolve({ stdout, stderr, exitCode });
		});
	});
}
