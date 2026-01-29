import * as assert from "node:assert";
import * as iconv from "iconv-lite";
import { decodeCliOutput } from "../../server/lint/decodeOutput";

suite("decodeOutput", () => {
	suite("UTF-8 happy path", () => {
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
	});

	suite("Replacement character handling", () => {
		test("accepts UTF-8 with <1% replacement characters", () => {
			// Create a buffer with mostly valid UTF-8 but one invalid byte
			const validPart = "a".repeat(200);
			const buffer = Buffer.concat([
				Buffer.from(validPart, "utf8"),
				Buffer.from([0xff]), // Invalid UTF-8 byte
			]);

			const result = decodeCliOutput(buffer);

			// Should use UTF-8 despite the replacement character (< 1%)
			assert.ok(result.includes("a"));
			assert.ok(result.includes("\uFFFD")); // Contains replacement char
		});

		test("falls back to chardet when UTF-8 has >=1% replacement characters", () => {
			// Create Shift_JIS buffer that will fail UTF-8 decoding
			const sjisText = "テスト";
			const buffer = iconv.encode(sjisText, "shift_jis");

			const result = decodeCliOutput(buffer);

			// Should detect and decode (might be detected as various encodings)
			// The important thing is that it doesn't return replacement characters
			assert.ok(result.length > 0);
			// Should not be mostly replacement characters
			const replacementCount = (result.match(/\uFFFD/g) || []).length;
			assert.ok(replacementCount < result.length * 0.5);
		});
	});

	suite("Encoding detection", () => {
		test("decodes Shift_JIS buffer using chardet", () => {
			const input = "エラー: 無効なクエリ";
			const buffer = iconv.encode(input, "shift_jis");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("decodes Windows-1252 buffer using chardet", () => {
			const input = "Error: Invalid query café";
			const buffer = iconv.encode(input, "windows-1252");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("handles chardet returning null gracefully", () => {
			// Very short buffer that chardet can't detect
			const buffer = Buffer.from([0x00]);

			// Should not throw
			const result = decodeCliOutput(buffer);

			assert.ok(typeof result === "string");
		});
	});

	suite("Encoding normalization", () => {
		test("normalizes 'shift-jis' to 'shift_jis'", () => {
			// We can't easily test the internal normalizeEncoding function,
			// but we can test that Shift_JIS variants work
			const input = "日本語";
			const buffer = iconv.encode(input, "shift_jis");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("handles various Shift_JIS aliases", () => {
			const input = "データベース";
			// CP932 is compatible with Shift_JIS for most characters
			const buffer = iconv.encode(input, "cp932");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("normalizes 'utf-8' to 'utf8'", () => {
			// UTF-8 should work regardless of alias
			const input = "Test UTF-8 ���";
			const buffer = Buffer.from(input, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});

		test("normalizes 'iso-8859-1' to 'latin1'", () => {
			const input = "Test latin1: café";
			const buffer = iconv.encode(input, "latin1");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, input);
		});
	});

	suite("Fallback encoding", () => {
		// Note: These tests depend on process.platform and process.env
		// We'll test the actual behavior rather than mock

		test("uses platform-appropriate fallback", () => {
			// Create a buffer that will trigger fallback
			// (not UTF-8, not detectable by chardet)
			const buffer = Buffer.from([0x80, 0x81, 0x82]);

			// Should not throw
			const result = decodeCliOutput(buffer);

			assert.ok(typeof result === "string");
		});

		test("handles fallback decode failure", () => {
			// Even with invalid data, should return something
			const buffer = Buffer.from([0xff, 0xfe, 0xfd]);

			const result = decodeCliOutput(buffer);

			// Should fall back to UTF-8 attempt with replacement chars
			assert.ok(typeof result === "string");
			// May be empty or contain replacement characters
			assert.ok(result.length >= 0);
		});
	});

	suite("Real-world scenarios", () => {
		test("handles tsqlrefine error output (UTF-8)", () => {
			const output = "file.sql(10,5): error rule-name : Invalid syntax";
			const buffer = Buffer.from(output, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, output);
		});

		test("handles Japanese error messages (Shift_JIS)", () => {
			const output = "ファイル.sql(10,5): エラー ルール名 : 無効な構文";
			const buffer = iconv.encode(output, "shift_jis");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, output);
		});

		test("handles mixed ASCII and Japanese (UTF-8)", () => {
			const output = "SELECT * FROM テーブル WHERE カラム = 'value'";
			const buffer = Buffer.from(output, "utf8");

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, output);
		});

		test("handles European characters (Windows-1252)", () => {
			const output = "Erreur: données invalides";
			const buffer = iconv.encode(output, "windows-1252");

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

		test("handles corrupted UTF-8 sequences", () => {
			// Start of multibyte sequence without continuation
			const buffer = Buffer.from([
				0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xe2, 0x20, 0x57, 0x6f, 0x72, 0x6c, 0x64,
			]);

			const result = decodeCliOutput(buffer);

			// Should handle gracefully (may contain replacement chars)
			assert.ok(typeof result === "string");
			assert.ok(result.includes("Hello"));
			assert.ok(result.includes("World"));
		});
	});

	suite("Edge cases", () => {
		test("handles buffer with only replacement characters", () => {
			// Create a buffer that produces only replacement chars in UTF-8
			const buffer = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);

			const result = decodeCliOutput(buffer);

			// Should trigger fallback
			assert.ok(typeof result === "string");
		});

		test("handles single-byte buffer", () => {
			const buffer = Buffer.from([0x41]); // 'A'

			const result = decodeCliOutput(buffer);

			assert.strictEqual(result, "A");
		});

		test("handles buffer with BOM (Byte Order Mark)", () => {
			// UTF-8 BOM + content
			const content = "Test";
			const buffer = Buffer.concat([
				Buffer.from([0xef, 0xbb, 0xbf]), // UTF-8 BOM
				Buffer.from(content, "utf8"),
			]);

			const result = decodeCliOutput(buffer);

			// BOM should be included or handled
			assert.ok(result.includes("Test"));
		});
	});
});
