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
 *
 * Note: This function trims both before and after resolution to ensure idempotence.
 * path.resolve() can preserve trailing whitespace in some edge cases (e.g., "! /"),
 * so we trim again to guarantee consistent results.
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
	// Trim after resolve to handle edge cases like "! /" where resolve preserves trailing space
	return path.resolve(trimmed).trim();
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
