import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { defaultSettings } from "../../server/config/settings";
import { runFormatter } from "../../server/format/runFormatter";
import { parseOutput } from "../../server/lint/parseOutput";
import { runLinter } from "../../server/lint/runLinter";
import { locateTsqlrefine } from "../helpers/testFixtures";

suite("E2E (local): real tsqlrefine binary", () => {
	let tsqlrefinePath: string | null;
	let tempDir: string;

	setup(async function () {
		tsqlrefinePath = await locateTsqlrefine();
		if (!tsqlrefinePath) {
			this.skip();
		}
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tsqlrefine-e2e-"));
	});

	teardown(async () => {
		if (tempDir) {
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	test("runs tsqlrefine and parses diagnostics", async function () {
		this.timeout(60000);
		assert.ok(tsqlrefinePath, "tsqlrefine not found");

		const filePath = path.join(tempDir, "query.sql");
		const fileText = "select from";
		await fs.writeFile(filePath, fileText, "utf8");

		const result = await runLinter({
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
	});

	test("lints Japanese/UTF-8 content without corruption", async function () {
		this.timeout(60000);
		assert.ok(tsqlrefinePath, "tsqlrefine not found");

		const filePath = path.join(tempDir, "japanese_query.sql");
		const fileText = "-- 日本語コメント: テーブルからデータを取得\nselect from";
		await fs.writeFile(filePath, fileText, "utf8");

		const result = await runLinter({
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
		assert.ok(
			!result.stderr.includes("�"),
			`stderr should not contain replacement characters: ${result.stderr}`,
		);

		const uri = URI.file(filePath).toString();
		const diagnostics = parseOutput({
			stdout: result.stdout,
			uri,
			cwd: tempDir,
			targetPaths: [filePath, "<stdin>"],
		});

		assert.ok(
			diagnostics.length > 0,
			`Expected diagnostics for invalid SQL with Japanese comments, got stdout=${JSON.stringify(result.stdout)}`,
		);
		assert.ok(
			diagnostics.some(
				(diag: { source?: string }) => diag.source === "tsqlrefine",
			),
			"Expected tsqlrefine as Diagnostic.source",
		);
	});

	test("formats Japanese/UTF-8 content without corruption", async function () {
		this.timeout(60000);
		assert.ok(tsqlrefinePath, "tsqlrefine not found");

		const filePath = path.join(tempDir, "japanese_format.sql");
		const fileText =
			"-- 日本語コメント: ユーザー一覧\nselect id,name from users;";
		await fs.writeFile(filePath, fileText, "utf8");

		const result = await runFormatter({
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
		assert.strictEqual(result.exitCode, 0, "Format should succeed");

		// Formatted output should preserve the Japanese comment
		assert.ok(
			result.stdout.includes("日本語コメント"),
			`Formatted output should preserve Japanese text, got: ${result.stdout}`,
		);
		assert.ok(
			result.stdout.includes("ユーザー一覧"),
			`Formatted output should preserve Japanese text, got: ${result.stdout}`,
		);
		assert.ok(
			!result.stdout.includes("�"),
			`Formatted output should not contain replacement characters: ${result.stdout}`,
		);
	});
});
