import * as assert from "node:assert";
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
	});
});
