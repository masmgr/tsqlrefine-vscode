/**
 * Centralized constants for the server.
 * This file contains all magic numbers that were previously scattered across the codebase.
 */

/** Cache TTL for command availability checks (30 seconds) */
export const COMMAND_CACHE_TTL_MS = 30000;

/** Timeout for command availability checks (3 seconds) */
export const COMMAND_CHECK_TIMEOUT_MS = 3000;

/** Cache TTL for config file resolution (5 seconds) */
export const CONFIG_CACHE_TTL_MS = 5000;

/** Maximum entries in config path cache */
export const CONFIG_CACHE_MAX_SIZE = 100;

/** Maximum concurrent lint operations */
export const MAX_CONCURRENT_RUNS = 4;

/** Cooldown for missing tsqlrefine notification (5 minutes) */
export const MISSING_TSQLREFINE_NOTICE_COOLDOWN_MS = 5 * 60 * 1000;

/** Default executable name */
export const DEFAULT_COMMAND_NAME = "tsqlrefine";

/** Maximum combined stdout+stderr buffer size (10 MB) */
export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/** Human-readable descriptions for CLI exit codes >= 2 */
export const CLI_EXIT_CODE_DESCRIPTIONS: Record<number, string> = {
	2: "SQL parse error",
	3: "configuration error",
	4: "runtime exception",
};
