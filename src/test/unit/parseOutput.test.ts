import * as assert from "node:assert";
import * as path from "node:path";
import * as fc from "fast-check";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { RULE_DOCS_BASE_URL } from "../../server/config/constants";
import { parseOutput } from "../../server/lint/parseOutput";
import { cliJsonOutput } from "../helpers/arbitraries";

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
		data?: {
			ruleId?: string;
			category?: string;
			fixable?: boolean;
			codeDescriptionHref?: string;
		};
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

	suite("codeDescription.href", () => {
		test("attaches codeDescription.href when code is present", () => {
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
					message: "Use uppercase keywords",
				},
			]);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 1);
			const diag = diagnostics[0];
			assert.ok(diag);
			assert.ok(diag.codeDescription);
			assert.strictEqual(
				diag.codeDescription.href,
				`${RULE_DOCS_BASE_URL}/keyword-casing.md`,
			);
		});

		test("uses CLI-provided codeDescriptionHref when available", () => {
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
					message: "Use uppercase keywords",
					data: {
						codeDescriptionHref: "https://custom.url/my-rule",
					},
				},
			]);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 1);
			const diag = diagnostics[0];
			assert.ok(diag);
			assert.strictEqual(
				diag.codeDescription?.href,
				"https://custom.url/my-rule",
			);
		});

		test("no codeDescription when code is absent", () => {
			const cwd = path.resolve("workspace");
			const filePath = path.join(cwd, "query.sql");
			const uri = URI.file(filePath).toString();
			const stdout = createJsonOutput("query.sql", [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 5 },
					},
					message: "No code diagnostic",
				},
			]);

			const diagnostics = parseOutput({ stdout, uri, cwd });

			assert.strictEqual(diagnostics.length, 1);
			const diag = diagnostics[0];
			assert.ok(diag);
			assert.strictEqual(diag.codeDescription, undefined);
		});

		test("URL-encodes rule codes with slashes", () => {
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
			assert.ok(diag.codeDescription);
			assert.strictEqual(
				diag.codeDescription.href,
				`${RULE_DOCS_BASE_URL}/${encodeURIComponent("semantic/schema-qualify")}.md`,
			);
		});
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

	suite("Property-based tests", () => {
		test("property: malformed JSON returns empty array", () => {
			fc.assert(
				fc.property(
					fc.string().filter((s) => {
						try {
							JSON.parse(s);
							return false; // Skip valid JSON
						} catch {
							return true; // Keep invalid JSON
						}
					}),
					(invalidJson) => {
						const filePath = path.resolve("test.sql");
						const uri = URI.file(filePath).toString();
						const diagnostics = parseOutput({
							stdout: invalidJson,
							uri,
							cwd: null,
						});
						return diagnostics.length === 0;
					},
				),
				{ numRuns: 200 },
			);
		});

		test("property: empty stdout returns empty array", () => {
			const filePath = path.resolve("test.sql");
			const uri = URI.file(filePath).toString();
			const diagnostics = parseOutput({ stdout: "", uri, cwd: null });
			assert.strictEqual(diagnostics.length, 0);
		});

		test("property: missing files array returns empty array", () => {
			fc.assert(
				fc.property(
					fc.record({ tool: fc.string(), version: fc.string() }),
					(invalidStructure) => {
						const stdout = JSON.stringify(invalidStructure);
						const filePath = path.resolve("test.sql");
						const uri = URI.file(filePath).toString();
						const diagnostics = parseOutput({ stdout, uri, cwd: null });
						return diagnostics.length === 0;
					},
				),
			);
		});

		test("property: all diagnostics have source tsqlrefine", () => {
			fc.assert(
				fc.property(cliJsonOutput, (jsonOutput) => {
					const stdout = JSON.stringify(jsonOutput);
					const cwd = path.resolve("workspace");
					// Use the first file path from the generated output
					const firstFilePath = jsonOutput.files[0]?.filePath ?? "test.sql";
					const resolvedPath =
						firstFilePath === "<stdin>"
							? path.join(cwd, "test.sql")
							: path.resolve(cwd, firstFilePath);
					const uri = URI.file(resolvedPath).toString();

					const diagnostics = parseOutput({ stdout, uri, cwd });

					return diagnostics.every((d) => d.source === "tsqlrefine");
				}),
				{ numRuns: 200 },
			);
		});

		test("property: severity defaults to Information for unknown values", () => {
			fc.assert(
				fc.property(
					fc.integer().filter((n) => n < 1 || n > 4),
					(invalidSeverity) => {
						const cwd = path.resolve("workspace");
						const filePath = path.join(cwd, "query.sql");
						const uri = URI.file(filePath).toString();
						const stdout = createJsonOutput("query.sql", [
							{
								range: {
									start: { line: 0, character: 0 },
									end: { line: 0, character: 5 },
								},
								severity: invalidSeverity,
								message: "Test",
							},
						]);

						const diagnostics = parseOutput({ stdout, uri, cwd });

						if (diagnostics.length > 0) {
							return (
								diagnostics[0]?.severity === DiagnosticSeverity.Information
							);
						}
						return true;
					},
				),
			);
		});

		test("property: stdin mapping to target URI", () => {
			fc.assert(
				fc.property(fc.array(fc.string(), { maxLength: 3 }), (messages) => {
					const cwd = path.resolve("workspace");
					const filePath = path.join(cwd, "query.sql");
					const uri = URI.file(filePath).toString();
					const stdout = createJsonOutput(
						"<stdin>",
						messages.map((msg, idx) => ({
							range: {
								start: { line: idx, character: 0 },
								end: { line: idx, character: 5 },
							},
							message: msg,
						})),
					);

					const diagnostics = parseOutput({ stdout, uri, cwd });

					// All diagnostics should be returned for <stdin>
					return diagnostics.length === messages.length;
				}),
			);
		});

		test("property: fixable defaults to false when missing", () => {
			fc.assert(
				fc.property(fc.string(), (message) => {
					const cwd = path.resolve("workspace");
					const filePath = path.join(cwd, "query.sql");
					const uri = URI.file(filePath).toString();
					const stdout = createJsonOutput("query.sql", [
						{
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 5 },
							},
							message,
							// No data object
						},
					]);

					const diagnostics = parseOutput({ stdout, uri, cwd });

					if (diagnostics.length > 0) {
						return diagnostics[0]?.data?.fixable === false;
					}
					return true;
				}),
			);
		});

		test("property: unicode handling in messages", () => {
			fc.assert(
				fc.property(fc.string(), (message) => {
					const cwd = path.resolve("workspace");
					const filePath = path.join(cwd, "query.sql");
					const uri = URI.file(filePath).toString();
					const stdout = createJsonOutput("query.sql", [
						{
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 5 },
							},
							message,
						},
					]);

					// Should not throw
					const diagnostics = parseOutput({ stdout, uri, cwd });

					if (diagnostics.length > 0) {
						return diagnostics[0]?.message === message;
					}
					return true;
				}),
			);
		});

		test("property: range coordinates are preserved from input", () => {
			fc.assert(
				fc.property(cliJsonOutput, (jsonOutput) => {
					const stdout = JSON.stringify(jsonOutput);
					const cwd = path.resolve("workspace");
					const firstFilePath = jsonOutput.files[0]?.filePath ?? "test.sql";
					const resolvedPath =
						firstFilePath === "<stdin>"
							? path.join(cwd, "test.sql")
							: path.resolve(cwd, firstFilePath);
					const uri = URI.file(resolvedPath).toString();

					const diagnostics = parseOutput({ stdout, uri, cwd });

					// Verify that parseOutput preserves the exact range coordinates from the input
					// (even if they're semantically invalid like end < start)
					const firstFile = jsonOutput.files[0];
					if (!firstFile || diagnostics.length === 0) {
						return true;
					}

					// Check that ranges are preserved exactly as input (0-based)
					return diagnostics.every((d, idx) => {
						const inputDiag = firstFile.diagnostics[idx];
						if (!inputDiag) return true;

						return (
							d.range.start.line === inputDiag.range.start.line &&
							d.range.start.character === inputDiag.range.start.character &&
							d.range.end.line === inputDiag.range.end.line &&
							d.range.end.character === inputDiag.range.end.character
						);
					});
				}),
				{ numRuns: 200 },
			);
		});

		test("property: diagnostics with code always have codeDescription.href", () => {
			fc.assert(
				fc.property(cliJsonOutput, (jsonOutput) => {
					const stdout = JSON.stringify(jsonOutput);
					const cwd = path.resolve("workspace");
					const firstFilePath = jsonOutput.files[0]?.filePath ?? "test.sql";
					const resolvedPath =
						firstFilePath === "<stdin>"
							? path.join(cwd, "test.sql")
							: path.resolve(cwd, firstFilePath);
					const uri = URI.file(resolvedPath).toString();

					const diagnostics = parseOutput({ stdout, uri, cwd });

					return diagnostics.every((d) => {
						if (d.code != null) {
							return (
								typeof d.codeDescription?.href === "string" &&
								d.codeDescription.href.length > 0
							);
						}
						return d.codeDescription === undefined;
					});
				}),
				{ numRuns: 200 },
			);
		});

		test("property: path filtering works correctly", () => {
			fc.assert(
				fc.property(
					fc.stringMatching(/^[a-zA-Z0-9_.-]+\.sql$/),
					fc.stringMatching(/^[a-zA-Z0-9_.-]+\.sql$/),
					(targetFile, otherFile) => {
						fc.pre(targetFile !== otherFile); // Ensure different files

						const cwd = path.resolve("workspace");
						const targetPath = path.join(cwd, targetFile);
						const uri = URI.file(targetPath).toString();

						const stdout = JSON.stringify({
							tool: "tsqlrefine",
							version: "1.0.0",
							command: "lint",
							files: [
								{
									filePath: targetFile,
									diagnostics: [
										{
											range: {
												start: { line: 0, character: 0 },
												end: { line: 0, character: 5 },
											},
											message: "Target diagnostic",
										},
									],
								},
								{
									filePath: otherFile,
									diagnostics: [
										{
											range: {
												start: { line: 0, character: 0 },
												end: { line: 0, character: 5 },
											},
											message: "Other diagnostic",
										},
									],
								},
							],
						});

						const diagnostics = parseOutput({ stdout, uri, cwd });

						// Should only return diagnostics for the target file
						return (
							diagnostics.length === 1 &&
							diagnostics[0]?.message === "Target diagnostic"
						);
					},
				),
			);
		});
	});
});
