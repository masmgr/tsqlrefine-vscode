import * as assert from "node:assert";
import * as path from "node:path";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { parseOutput } from "../../server/lint/parseOutput";

suite("parseOutput", () => {
	test("parses diagnostics for matching path", () => {
		const filePath = path.resolve("workspace", "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = `${filePath}:2:5: Error: Bad stuff (Rule-Name)`;
		const lines = ["select 1;", "select *"];

		const diagnostics = parseOutput({ stdout, uri, cwd: null, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.message, "Bad stuff");
		assert.strictEqual(diag.severity, DiagnosticSeverity.Error);
		assert.strictEqual(diag.source, "tsqlrefine");
		assert.strictEqual(diag.code, "Rule-Name");
		assert.deepStrictEqual(diag.range.start, { line: 1, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 1, character: 8 });
	});

	test("handles relative paths against cwd", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql:1:1: Warning: Heads up (RuleX)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 9 });
	});

	test("uses line ranges (fixed)", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql:1:99: Error: Heads up (RuleX)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({
			stdout,
			uri,
			cwd,
			lines,
		});

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 9 });
	});

	test("always uses full-line range regardless of column", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql:1:20: Warning: Heads up (RuleX)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 9 });
	});

	test("ignores output for different file paths", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "other.sql:1:1: Warning: Not for this file (RuleY)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 0);
	});

	test("ignores summary blocks and plain messages", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = [
			"Linted 1 files in 0.1 seconds",
			"",
			"1 Errors.",
			"0 Warnings.",
			"query.sql is not a valid file path.",
		].join("\n");
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 0);
	});

	test("maps diagnostics from targetPaths (temp file)", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const tempPath = path.join(cwd, "temp.sql");
		const uri = URI.file(filePath).toString();
		const stdout = `${tempPath}:1:2: Warning: Temp hit (RuleZ)`;
		const lines = ["select 1;"];

		const diagnostics = parseOutput({
			stdout,
			uri,
			cwd,
			lines,
			targetPaths: [tempPath],
		});

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.code, "RuleZ");
		assert.strictEqual(diag.message, "Temp hit");
	});

	test("handles Hint severity", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql:1:1: Hint: Consider using alias (style/alias)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Hint);
		assert.strictEqual(diag.code, "style/alias");
	});

	test("handles Information severity", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql:1:1: Information: FYI message (info-rule)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Information);
		assert.strictEqual(diag.code, "info-rule");
	});

	test("handles rule IDs with slashes", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout =
			"query.sql:1:1: Warning: Schema qualify tables (semantic/schema-qualify)";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.strictEqual(diag.code, "semantic/schema-qualify");
	});

	suite("Error scenarios", () => {
		test("handles empty stdout gracefully", () => {
			const filePath = path.resolve("workspace", "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = "";
			const lines = ["select 1;"];

			const diagnostics = parseOutput({ stdout, uri, cwd: null, lines });

			assert.strictEqual(diagnostics.length, 0);
		});

		test("handles malformed line (missing parentheses for rule)", () => {
			const filePath = path.resolve("workspace", "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = "query.sql:1:1: Error: Invalid format without rule";
			const lines = ["select 1;"];

			const diagnostics = parseOutput({
				stdout,
				uri,
				cwd: path.resolve("workspace"),
				lines,
			});

			// Malformed line should be ignored
			assert.strictEqual(diagnostics.length, 0);
		});

		test("handles unicode in error messages", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = "query.sql:1:1: Error: エラーメッセージ (RuleX)";
			const lines = ["select 1;"];

			const diagnostics = parseOutput({ stdout, uri, cwd, lines });

			assert.strictEqual(diagnostics.length, 1);
			assert.strictEqual(diagnostics[0]?.message, "エラーメッセージ");
		});

		test("handles path separators", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = `${filePath}:1:1: Error: Message (Rule)`;
			const lines = ["select 1;"];

			const diagnostics = parseOutput({ stdout, uri, cwd, lines });

			assert.strictEqual(diagnostics.length, 1);
		});
	});
});
