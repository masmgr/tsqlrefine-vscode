import * as assert from "node:assert";
import * as fc from "fast-check";
import {
	firstLine,
	resolveTargetFilePath,
} from "../../server/shared/textUtils";

suite("textUtils", () => {
	suite("firstLine", () => {
		test("returns first line from multiline text", () => {
			const text = "First line\nSecond line\nThird line";
			assert.strictEqual(firstLine(text), "First line");
		});

		test("returns full text when no newline", () => {
			const text = "Single line text";
			assert.strictEqual(firstLine(text), "Single line text");
		});

		test("returns empty string for empty input", () => {
			assert.strictEqual(firstLine(""), "");
		});

		test("returns empty string when text starts with newline", () => {
			const text = "\nSecond line";
			assert.strictEqual(firstLine(text), "");
		});

		test("handles CRLF line endings", () => {
			const text = "First line\r\nSecond line";
			// firstLine uses indexOf("\n"), so it returns "First line\r"
			assert.strictEqual(firstLine(text), "First line\r");
		});

		test("handles text with only newline", () => {
			assert.strictEqual(firstLine("\n"), "");
		});

		test("handles long first line", () => {
			const longLine = "A".repeat(10000);
			const text = `${longLine}\nSecond line`;
			assert.strictEqual(firstLine(text), longLine);
		});

		test("handles unicode in first line", () => {
			const text = "日本語テスト\n英語テスト";
			assert.strictEqual(firstLine(text), "日本語テスト");
		});

		suite("Property-based tests", () => {
			test("property: result never contains newlines", () => {
				fc.assert(
					fc.property(fc.string(), (text) => {
						const result = firstLine(text);
						return !result.includes("\n");
					}),
				);
			});

			test("property: idempotence", () => {
				fc.assert(
					fc.property(fc.string(), (text) => {
						const result = firstLine(text);
						return firstLine(result) === result;
					}),
				);
			});

			test("property: prefix preservation", () => {
				fc.assert(
					fc.property(fc.string(), (text) => {
						const result = firstLine(text);
						return text.startsWith(result) || result === "";
					}),
				);
			});

			test("property: length constraint", () => {
				fc.assert(
					fc.property(fc.string(), (text) => {
						const result = firstLine(text);
						return result.length <= text.length;
					}),
				);
			});

			test("property: empty string handling", () => {
				assert.strictEqual(firstLine(""), "");
			});

			test("property: concatenation property", () => {
				fc.assert(
					fc.property(fc.string(), fc.string(), (a, b) => {
						const combined = `${a}\n${b}`;
						return firstLine(combined) === firstLine(a);
					}),
				);
			});

			test("property: unicode safety", () => {
				fc.assert(
					fc.property(fc.string(), (text) => {
						// Should not throw and should return valid result
						const result = firstLine(text);
						return typeof result === "string" && result.length >= 0;
					}),
				);
			});
		});
	});

	suite("resolveTargetFilePath", () => {
		test("returns filePath when provided", () => {
			assert.strictEqual(
				resolveTargetFilePath("/path/to/test.sql"),
				"/path/to/test.sql",
			);
		});

		test("returns untitled.sql for empty string", () => {
			assert.strictEqual(resolveTargetFilePath(""), "untitled.sql");
		});

		test("returns filePath for relative path", () => {
			assert.strictEqual(resolveTargetFilePath("test.sql"), "test.sql");
		});

		test("returns filePath for Windows path", () => {
			assert.strictEqual(
				resolveTargetFilePath("C:\\Users\\test\\file.sql"),
				"C:\\Users\\test\\file.sql",
			);
		});

		test("returns filePath for path with spaces", () => {
			assert.strictEqual(
				resolveTargetFilePath("/path/to/my file.sql"),
				"/path/to/my file.sql",
			);
		});

		test("returns filePath for path with unicode", () => {
			assert.strictEqual(
				resolveTargetFilePath("/パス/ファイル.sql"),
				"/パス/ファイル.sql",
			);
		});

		suite("Property-based tests", () => {
			test("property: identity for non-empty paths", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (path) => {
						return resolveTargetFilePath(path) === path;
					}),
				);
			});

			test("property: fallback for empty string", () => {
				assert.strictEqual(resolveTargetFilePath(""), "untitled.sql");
			});

			test("property: never returns empty string", () => {
				fc.assert(
					fc.property(fc.string(), (path) => {
						const result = resolveTargetFilePath(path);
						return result.length > 0;
					}),
				);
			});

			test("property: preserves length for non-empty", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (path) => {
						const result = resolveTargetFilePath(path);
						return result.length === path.length;
					}),
				);
			});
		});
	});
});
