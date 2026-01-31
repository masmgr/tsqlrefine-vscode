/**
 * Decodes a Buffer containing CLI output into a UTF-8 string.
 * Removes UTF-8 BOM if present.
 */
export function decodeCliOutput(buffer: Buffer): string {
	if (buffer.length === 0) {
		return "";
	}

	// UTF-8 BOM: 0xEF 0xBB 0xBF
	const hasBom =
		buffer.length >= 3 &&
		buffer[0] === 0xef &&
		buffer[1] === 0xbb &&
		buffer[2] === 0xbf;

	return buffer.toString("utf8", hasBom ? 3 : 0);
}

export type EndOfLine = "LF" | "CRLF";

/**
 * Normalizes line endings in the given text to match the specified EOL style.
 */
export function normalizeLineEndings(text: string, eol: EndOfLine): string {
	// First normalize to LF, then convert to target EOL
	const lfText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	return eol === "CRLF" ? lfText.replace(/\n/g, "\r\n") : lfText;
}
