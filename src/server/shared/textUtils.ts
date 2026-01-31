/**
 * Extract the first line from a text string.
 * Returns the entire string if no newline is found.
 */
export function firstLine(text: string): string {
	const index = text.indexOf("\n");
	if (index === -1) {
		return text;
	}
	return text.slice(0, index);
}

/**
 * Resolve the target file path, using "untitled.sql" as fallback for empty paths.
 */
export function resolveTargetFilePath(filePath: string): string {
	return filePath || "untitled.sql";
}
