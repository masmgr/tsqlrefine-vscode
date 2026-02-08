import * as assert from "node:assert";
import * as path from "node:path";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { parseOutput } from "../../server/lint/parseOutput";

/**
 * Helper to create a JSON stdout string matching the CLI JSON output format.
 */
function createJsonOutput(
	filePath: string,
	diagnostics: Array<{
		range: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		};
		severity?: number;
		code?: string;
		message: string;
		data?: { ruleId?: string; category?: string; fixable?: boolean };
	}>,
): string {
	return JSON.stringify({
		tool: "tsqlrefine",
		version: "1.0.0",
		command: "lint",
		files: [{ filePath, diagnostics }],
	});
}

suite("parseOutput", () => {
	test("parses diagnostics for matching path", () => {
		const filePath = path.resolve("workspace", "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput(filePath, [
			{
				range: {
					start: { line: 1, character: 0 },
					end: { line: 1, character: 8 },
				},
				severity: 1,
				code: "Rule-Name",
				message: "Bad stuff",
				data: { ruleId: "Rule-Name", fixable: false },
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd: null });

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
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 9 },
				},
				severity: 2,
				code: "RuleX",
				message: "Heads up",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 0 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 9 });
	});

	test("uses exact character ranges from JSON", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 7 },
					end: { line: 0, character: 8 },
				},
				severity: 1,
				code: "RuleX",
				message: "Heads up",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.range.start, { line: 0, character: 7 });
		assert.deepStrictEqual(diag.range.end, { line: 0, character: 8 });
	});

	test("ignores output for different file paths", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("other.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 2,
				code: "RuleY",
				message: "Not for this file",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 0);
	});

	test("maps diagnostics from targetPaths (temp file)", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const tempPath = path.join(cwd, "temp.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput(tempPath, [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 2,
				code: "RuleZ",
				message: "Temp hit",
			},
		]);

		const diagnostics = parseOutput({
			stdout,
			uri,
			cwd,
			targetPaths: [tempPath],
		});

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.code, "RuleZ");
		assert.strictEqual(diag.message, "Temp hit");
	});

	test("maps stdin filePath to target URI", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("<stdin>", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 1,
				code: "parse-error",
				message: "Invalid syntax",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.code, "parse-error");
		assert.strictEqual(diag.message, "Invalid syntax");
	});

	test("handles Hint severity (4)", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 4,
				code: "style/alias",
				message: "Consider using alias",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Hint);
		assert.strictEqual(diag.code, "style/alias");
	});

	test("handles Information severity (3)", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 3,
				code: "info-rule",
				message: "FYI message",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

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
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 2,
				code: "semantic/schema-qualify",
				message: "Schema qualify tables",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.strictEqual(diag.severity, DiagnosticSeverity.Warning);
		assert.strictEqual(diag.code, "semantic/schema-qualify");
	});

	test("propagates fixable flag from data", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 2,
				code: "keyword-casing",
				message: "Use uppercase for SQL keywords",
				data: { ruleId: "keyword-casing", fixable: true },
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.data, { fixable: true });
	});

	test("defaults fixable to false when data is missing", () => {
		const cwd = path.resolve("workspace");
		const filePath = path.join(cwd, "query.sql");
		const uri = URI.file(filePath).toString();
		const stdout = createJsonOutput("query.sql", [
			{
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 2,
				code: "some-rule",
				message: "Some message",
			},
		]);

		const diagnostics = parseOutput({ stdout, uri, cwd });

		assert.strictEqual(diagnostics.length, 1);
		const diag = diagnostics[0];
		assert.ok(diag);
		assert.deepStrictEqual(diag.data, { fixable: false });
	});

	suite("Error scenarios", () => {
		test("handles empty stdout gracefully", () => {
			const filePath = path.resolve("workspace", "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = "";

			const diagnostics = parseOutput({ stdout, uri, cwd: null });

			assert.strictEqual(diagnostics.length, 0);
		});

		test("handles malformed JSON gracefully", () => {
			const filePath = path.resolve("workspace", "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = "this is not valid JSON";

			const diagnostics = parseOutput({
				stdout,
				uri,
				cwd: path.resolve("workspace"),
			});

			assert.strictEqual(diagnostics.length, 0);
		});

		test("handles JSON without files array gracefully", () => {
			const filePath = path.resolve("workspace", "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = JSON.stringify({ tool: "tsqlrefine", version: "1.0.0" });

			const diagnostics = parseOutput({
				stdout,
				uri,
				cwd: path.resolve("workspace"),
			});

			assert.strictEqual(diagnostics.length, 0);
		});

		test("handles unicode in error messages", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = createJsonOutput("query.sql", [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 5 },
					},
					severity: 1,
					code: "RuleX",
					message: "エラーメッセージ",
				},
			]);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 1);
			assert.strictEqual(diagnostics[0]?.message, "エラーメッセージ");
		});

		test("handles path separators", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = createJsonOutput(filePath, [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 5 },
					},
					severity: 1,
					code: "Rule",
					message: "Message",
				},
			]);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 1);
		});

		test("handles empty diagnostics array", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = createJsonOutput("query.sql", []);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 0);
		});
	});
});
