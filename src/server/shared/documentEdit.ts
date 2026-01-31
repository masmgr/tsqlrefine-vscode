import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";

/**
 * Create a TextEdit that replaces the entire document content.
 */
export function createFullDocumentEdit(
	document: TextDocument,
	newText: string,
): TextEdit {
	const lastLineIndex = document.lineCount - 1;
	const lastLine = document.getText({
		start: { line: lastLineIndex, character: 0 },
		end: { line: lastLineIndex, character: Number.MAX_SAFE_INTEGER },
	});

	return {
		range: {
			start: { line: 0, character: 0 },
			end: { line: lastLineIndex, character: lastLine.length },
		},
		newText,
	};
}
