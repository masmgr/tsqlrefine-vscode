import * as assert from "node:assert";
import * as fc from "fast-check";
import {
	decodeCliOutput,
	normalizeLineEndings,
} from "../../server/lint/decodeOutput";
import { utf8BufferWithOptionalBom } from "../helpers/arbitraries";

suite("decodeOutput", () => {
	suite("UTF-8 decoding", () => {
		test("returns UTF-8 string for clean UTF-8 buffer", () => {
			const input = "SELECT * FROM テーブル";
			const buffer = Buffer.from(input, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("returns empty string for zero-length buffer", () => {
			const buffer = Buffer.alloc(0);

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, "");
		});

		test("handles ASCII-only content", () => {
			const input = "SELECT * FROM users WHERE id = 1";
			const buffer = Buffer.from(input, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("handles mixed ASCII and Japanese (UTF-8)", () => {
			const input = "SELECT * FROM テーブル WHERE カラム = 'value'";
			const buffer = Buffer.from(input, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});
	});

	suite("BOM handling", () => {
		test("removes UTF-8 BOM from start of buffer", () => {
			const content = "Test content";
			const buffer = Buffer.concat([
				Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
				Buffer.from(content, "utf8"),
			]);

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, content);
			assert.ok(!result.startsWith("\ufeff"));
		});

		test("handles buffer with only BOM", () => {
			const buffer = Buffer.from([0xef, 0xbb, 0xbf]);

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, "");
		});

		test("does not remove BOM-like bytes in middle of content", () => {
			const buffer = Buffer.concat([
				Buffer.from("Hello", "utf8"),
				Buffer.from([0xef, 0xbb, 0xbf]),
				Buffer.from("World", "utf8"),
			]);

			const result = decodeCliOutput(buffer);

			assert.ok(result.includes("Hello"));
			assert.ok(result.includes("World"));
			// BOM in middle should remain as the BOM character
			assert.ok(result.includes("\ufeff"));
		});

		test("handles Japanese content with BOM", () => {
			const content = "SELECT * FROM テーブル";
			const buffer = Buffer.concat([
				Buffer.from([0xef, 0xbb, 0xbf]),
				Buffer.from(content, "utf8"),
			]);

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, content);
		});
	});

	suite("Real-world scenarios", () => {
		test("handles tsqlrefine error output (UTF-8)", () => {
			const output = "file.sql(10,5): error rule-name : Invalid syntax";
			const buffer = Buffer.from(output, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, output);
		});

		test("handles empty lines and whitespace", () => {
			const output = "\n\n  \n";
			const buffer = Buffer.from(output, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, output);
		});

		test("handles very long output", () => {
			const longText = "SELECT * FROM users;\n".repeat(1000);
			const buffer = Buffer.from(longText, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, longText);
		});

		test("handles output with null bytes", () => {
			const buffer = Buffer.from([
				0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64,
			]); // "Hello\0World"

			const result = decodeCliOutput(buffer);

			assert.ok(result.includes("Hello"));
			assert.ok(result.includes("World"));
		});

		test("handles single-byte buffer", () => {
			const buffer = Buffer.from([0x41]); // 'A'

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, "A");
		});
	});

	suite("Property-based tests", () => {
		test("property: round-trip for clean UTF-8", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const buffer = Buffer.from(text, "utf8");
					const result = decodeCliOutput(buffer);
					return result === text;
				}),
			);
		});

		test("property: empty buffer returns empty string", () => {
			const buffer = Buffer.alloc(0);
			assert.strictEqual(decodeCliOutput(buffer), "");
		});

		test("property: no BOM at start of output", () => {
			fc.assert(
				fc.property(utf8BufferWithOptionalBom, (buffer) => {
					const result = decodeCliOutput(buffer);
					return !result.startsWith("\ufeff");
				}),
			);
		});

		test("property: length monotonicity", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const buffer = Buffer.from(text, "utf8");
					const result = decodeCliOutput(buffer);
					// Decoded string length should be <= buffer length (UTF-8 property)
					return result.length <= buffer.length;
				}),
			);
		});

		test("property: no exception on arbitrary buffers", () => {
			fc.assert(
				fc.property(fc.uint8Array(), (bytes) => {
					const buffer = Buffer.from(bytes);
					// Should not throw
					const result = decodeCliOutput(buffer);
					return typeof result === "string";
				}),
			);
		});
	});
});

suite("normalizeLineEndings", () => {
	suite("LF normalization", () => {
		test("keeps LF as LF", () => {
			const input = "line1\nline2\nline3";

			const result = normalizeLineEndings(input, "LF");

			assert.strictEqual(result, "line1\nline2\nline3");
		});

		test("converts CRLF to LF", () => {
			const input = "line1\r\nline2\r\nline3";

			const result = normalizeLineEndings(input, "LF");

			assert.strictEqual(result, "line1\nline2\nline3");
		});

		test("converts CR to LF", () => {
			const input = "line1\rline2\rline3";

			const result = normalizeLineEndings(input, "LF");

			assert.strictEqual(result, "line1\nline2\nline3");
		});

		test("handles mixed line endings", () => {
			const input = "line1\r\nline2\nline3\rline4";

			const result = normalizeLineEndings(input, "LF");

			assert.strictEqual(result, "line1\nline2\nline3\nline4");
		});
	});

	suite("CRLF normalization", () => {
		test("converts LF to CRLF", () => {
			const input = "line1\nline2\nline3";

			const result = normalizeLineEndings(input, "CRLF");

			assert.strictEqual(result, "line1\r\nline2\r\nline3");
		});

		test("keeps CRLF as CRLF", () => {
			const input = "line1\r\nline2\r\nline3";

			const result = normalizeLineEndings(input, "CRLF");

			assert.strictEqual(result, "line1\r\nline2\r\nline3");
		});

		test("converts CR to CRLF", () => {
			const input = "line1\rline2\rline3";

			const result = normalizeLineEndings(input, "CRLF");

			assert.strictEqual(result, "line1\r\nline2\r\nline3");
		});

		test("handles mixed line endings", () => {
			const input = "line1\r\nline2\nline3\rline4";

			const result = normalizeLineEndings(input, "CRLF");

			assert.strictEqual(result, "line1\r\nline2\r\nline3\r\nline4");
		});
	});

	suite("Edge cases", () => {
		test("handles empty string", () => {
			assert.strictEqual(normalizeLineEndings("", "LF"), "");
			assert.strictEqual(normalizeLineEndings("", "CRLF"), "");
		});

		test("handles string without line endings", () => {
			const input = "no line endings here";

			assert.strictEqual(normalizeLineEndings(input, "LF"), input);
			assert.strictEqual(normalizeLineEndings(input, "CRLF"), input);
		});

		test("handles string with only line endings", () => {
			assert.strictEqual(normalizeLineEndings("\n\n\n", "LF"), "\n\n\n");
			assert.strictEqual(
				normalizeLineEndings("\n\n\n", "CRLF"),
				"\r\n\r\n\r\n",
			);
			assert.strictEqual(normalizeLineEndings("\r\n\r\n", "LF"), "\n\n");
		});

		test("handles trailing line ending", () => {
			assert.strictEqual(normalizeLineEndings("text\n", "LF"), "text\n");
			assert.strictEqual(normalizeLineEndings("text\n", "CRLF"), "text\r\n");
			assert.strictEqual(normalizeLineEndings("text\r\n", "LF"), "text\n");
		});
	});

	suite("Property-based tests", () => {
		test("property: idempotence for LF", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const once = normalizeLineEndings(text, "LF");
					const twice = normalizeLineEndings(once, "LF");
					return once === twice;
				}),
			);
		});

		test("property: idempotence for CRLF", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const once = normalizeLineEndings(text, "CRLF");
					const twice = normalizeLineEndings(once, "CRLF");
					return once === twice;
				}),
			);
		});

		test("property: LF mode has no CR characters", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const result = normalizeLineEndings(text, "LF");
					return !result.includes("\r");
				}),
			);
		});

		test("property: CRLF mode has no lone LF", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const result = normalizeLineEndings(text, "CRLF");
					// Split by CRLF and check no part contains \n
					const parts = result.split("\r\n");
					return parts.every((part) => !part.includes("\n"));
				}),
			);
		});

		test("property: CRLF mode has no lone CR", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const result = normalizeLineEndings(text, "CRLF");
					// Split by CRLF and check no part contains \r
					const parts = result.split("\r\n");
					return parts.every((part) => !part.includes("\r"));
				}),
			);
		});

		test("property: content preservation (excluding line endings)", () => {
			fc.assert(
				fc.property(fc.string(), fc.constantFrom("LF", "CRLF"), (text, eol) => {
					const result = normalizeLineEndings(text, eol);
					// Remove all line ending variants and compare content
					const originalContent = text.replace(/\r\n|\r|\n/g, "");
					const resultContent = result.replace(/\r\n|\r|\n/g, "");
					return originalContent === resultContent;
				}),
			);
		});

		test("property: empty preservation", () => {
			assert.strictEqual(normalizeLineEndings("", "LF"), "");
			assert.strictEqual(normalizeLineEndings("", "CRLF"), "");
		});

		test("property: round-trip CRLF to LF to CRLF preserves line count", () => {
			fc.assert(
				fc.property(fc.string(), (text) => {
					const toCrlf = normalizeLineEndings(text, "CRLF");
					const toLf = normalizeLineEndings(toCrlf, "LF");
					const backToCrlf = normalizeLineEndings(toLf, "CRLF");

					// Line count should be preserved
					const crlfCount = (toCrlf.match(/\r\n/g) || []).length;
					const lfCount = (toLf.match(/\n/g) || []).length;
					const finalCrlfCount = (backToCrlf.match(/\r\n/g) || []).length;

					return crlfCount === lfCount && lfCount === finalCrlfCount;
				}),
			);
		});
	});
});
