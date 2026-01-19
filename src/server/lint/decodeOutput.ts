import * as chardet from "chardet";
import * as iconv from "iconv-lite";

/**
 * Decodes a Buffer containing CLI output into a UTF-16 string using a fallback chain:
 * 1. Try UTF-8 first
 * 2. If UTF-8 produces replacement characters, detect encoding using chardet
 * 3. Use detected encoding (normalized to iconv-lite supported names)
 * 4. Final fallback: CP932 on Windows JP, windows-1252 elsewhere
 *
 * This approach is language-agnostic and handles various CLI tools that may output
 * in different encodings (Shift_JIS/CP932, UTF-8, etc.) without mojibake.
 */
export function decodeCliOutput(buffer: Buffer): string {
	if (buffer.length === 0) {
		return "";
	}

	// First attempt: UTF-8
	const utf8Result = buffer.toString("utf8");
	const replacementCount = (utf8Result.match(/\uFFFD/g) || []).length;

	// If UTF-8 decoding is clean (no or minimal replacement characters), use it
	// Allow up to 1% replacement characters as tolerance for truly corrupted data
	if (replacementCount === 0 || replacementCount / utf8Result.length < 0.01) {
		return utf8Result;
	}

	// Second attempt: Detect encoding
	const detected = chardet.detect(buffer);
	if (detected) {
		const encoding = normalizeEncoding(detected);
		if (encoding && iconv.encodingExists(encoding)) {
			try {
				return iconv.decode(buffer, encoding);
			} catch {
				// Fall through to fallback
			}
		}
	}

	// Final fallback: Use locale-specific default
	const fallbackEncoding = getFallbackEncoding();
	try {
		return iconv.decode(buffer, fallbackEncoding);
	} catch {
		// Last resort: return the UTF-8 attempt even with replacement characters
		return utf8Result;
	}
}

/**
 * Normalizes encoding names from chardet to iconv-lite compatible names
 */
function normalizeEncoding(detected: string): string | null {
	const normalized = detected.toLowerCase();

	// Map common aliases to iconv-lite names
	const encodingMap: Record<string, string> = {
		shift_jis: "shift_jis",
		"shift-jis": "shift_jis",
		sjis: "shift_jis",
		"windows-31j": "shift_jis",
		cp932: "cp932",
		"windows-932": "cp932",
		"utf-8": "utf8",
		utf8: "utf8",
		"iso-8859-1": "latin1",
		"windows-1252": "windows-1252",
		cp1252: "windows-1252",
	};

	return encodingMap[normalized] || detected;
}

/**
 * Returns the appropriate fallback encoding based on the platform and locale
 */
function getFallbackEncoding(): string {
	if (process.platform !== "win32") {
		return "utf8";
	}

	// On Windows, check locale to determine appropriate fallback
	const env = process.env as NodeJS.ProcessEnv & {
		LANG?: string;
		LC_ALL?: string;
	};
	const locale = env.LANG || env.LC_ALL || "";

	// Japanese locale
	if (
		locale.toLowerCase().includes("ja") ||
		locale.toLowerCase().includes("jp")
	) {
		return "cp932";
	}

	// Default Windows fallback
	return "windows-1252";
}
