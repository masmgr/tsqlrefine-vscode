import * as assert from "node:assert";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { parseOutput } from "../server/lint/parseOutput";

suite("parseOutput", () => {
	test("parses diagnostics for matching path", () => {
		const filePath = path.resolve("workspace", "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = `${filePath}(2,5): error Rule-Name : Bad stuff.`;
		const lines = ["select 1;", "select *"];

		const diagnostics = parseOutput({ stdout, uri, cwd: null, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.message, "Bad stuff");
		assert.strictEqual(diag.severity, DiagnosticSeverity.Error);
		assert.strictEqual(diag.source, "tsqllint");
		assert.strictEqual(diag.code, "Rule-Name");
		assert.deepStrictEqual(diag.range.start, { line: 1, character: 4 });
		assert.deepStrictEqual(diag.range.end, { line: 1, character: 5 });
	});

	test("handles relative paths against cwd", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql(1,1): warning RuleX : Heads up.";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 1 });
	});

	test("uses line ranges when configured", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql(1,99): error RuleX : Heads up.";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({
			stdout,
			uri,
			cwd,
			lines,
			rangeMode: "line",
		});

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 9 });
	});

	test("falls back to full-line range when column exceeds length", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql(1,20): warning RuleX : Heads up.";
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
		const stdout = "other.sql(1,1): warning RuleY : Not for this file.";
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
		const stdout = `${tempPath}(1,2): warning RuleZ : Temp hit.`;
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

	test("allows missing trailing period and extra severity tokens", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = "query.sql(1,1): warning style RuleX : Heads up";
		const lines = ["select 1;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.strictEqual(diag.code, "RuleX");
	});

	test("handles file paths with parentheses", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query(1).sql");
		const uri = URI.file(filePath).toString();
		const stdout = `${filePath}(3,2): error RuleP : Paren path.`;
		const lines = ["select 1;", "select 2;", "select 3;"];

		const diagnostics = parseOutput({ stdout, uri, cwd, lines });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Error);
		assert.strictEqual(diag.code, "RuleP");
	});
});
