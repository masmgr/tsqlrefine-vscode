import * as assert from "node:assert";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { createFullDocumentEdit } from "../../server/shared/documentEdit";

/**
 * Creates a mock TextDocument for testing.
 */
function createMockTextDocument(text: string, lineCount: number): TextDocument {
	const lines = text.split("\n");

	return {
		uri: "file:///test.sql",
		languageId: "sql",
		version: 1,
		getText: (range?: {
			start: { line: number; character: number };
			end: { line: number; character: number };
		}) => {
			if (!range) return text;
			// Return the specified line
			const line = lines[range.start.line];
			if (line === undefined) return "";
			return line;
		},
		lineCount,
		positionAt: (offset: number) => ({ line: 0, character: offset }),
		offsetAt: (position: { line: number; character: number }) =>
			position.character,
	} as TextDocument;
}

suite("documentEdit", () => {
	suite("createFullDocumentEdit", () => {
		test("creates edit for single line document", () => {
			const document = createMockTextDocument("SELECT 1;", 1);
			const newText = "SELECT 2;";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 0);
			assert.strictEqual(edit.range.end.character, 9); // "SELECT 1;".length
			assert.strictEqual(edit.newText, newText);
		});

		test("creates edit for multiline document", () => {
			const text = "SELECT 1;\nSELECT 2;\nSELECT 3;";
			const document = createMockTextDocument(text, 3);
			const newText = "SELECT A;\nSELECT B;";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 2);
			assert.strictEqual(edit.range.end.character, 9); // "SELECT 3;".length
			assert.strictEqual(edit.newText, newText);
		});

		test("creates edit for empty document", () => {
			const document = createMockTextDocument("", 1);
			const newText = "SELECT 1;";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 0);
			assert.strictEqual(edit.range.end.character, 0);
			assert.strictEqual(edit.newText, newText);
		});

		test("creates edit with empty newText", () => {
			const document = createMockTextDocument("SELECT 1;", 1);
			const newText = "";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.character, 9);
			assert.strictEqual(edit.newText, "");
		});

		test("handles document with trailing newline", () => {
			const text = "SELECT 1;\n";
			const document = createMockTextDocument(text, 2);
			const newText = "SELECT 2;";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 1);
			// Last line is empty after the newline
			assert.strictEqual(edit.range.end.character, 0);
		});

		test("handles document with CRLF line endings", () => {
			const text = "SELECT 1;\r\nSELECT 2;";
			const lines = text.split("\n");
			const document = {
				uri: "file:///test.sql",
				languageId: "sql",
				version: 1,
				getText: (range?: {
					start: { line: number; character: number };
					end: { line: number; character: number };
				}) => {
					if (!range) return text;
					const line = lines[range.start.line];
					return line ?? "";
				},
				lineCount: 2,
				positionAt: (offset: number) => ({ line: 0, character: offset }),
				offsetAt: (position: { line: number; character: number }) =>
					position.character,
			} as TextDocument;

			const newText = "SELECT A;\r\nSELECT B;";
			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.line, 1);
			assert.strictEqual(edit.newText, newText);
		});

		test("handles document with unicode characters", () => {
			const text = "SELECT '日本語';";
			const document = createMockTextDocument(text, 1);
			const newText = "SELECT '한국어';";

			const edit = createFullDocumentEdit(document, newText);

			assert.deepStrictEqual(edit.range.start, { line: 0, character: 0 });
			assert.strictEqual(edit.range.end.character, text.length);
			assert.strictEqual(edit.newText, newText);
		});
	});
});
