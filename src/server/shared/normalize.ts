import * as path from "node:path";

/**
 * Normalize a file path for comparison.
 * Resolves to absolute path and handles Windows case-insensitivity.
 */
export function normalizeForCompare(filePath: string): string {
	const normalized = path.resolve(filePath);
	if (process.platform === "win32") {
		return normalized.toLowerCase();
	}
	return normalized;
}

/**
 * Normalize an executable path setting (trim and resolve).
 * Returns null if the value is empty or undefined.
 */
export function normalizeExecutablePath(
	value: string | undefined,
): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return path.resolve(trimmed);
}

/**
 * Normalize a config path setting (trim only, no resolution).
 * Returns null if the value is empty or undefined.
 */
export function normalizeConfigPath(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed;
}
