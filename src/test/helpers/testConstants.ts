/**
 * Centralized test constants for timeouts, delays, and configuration values.
 * Using constants instead of magic numbers improves maintainability and consistency.
 */

/**
 * Timeout values for various test operations.
 * All values are in milliseconds.
 */
export const TEST_TIMEOUTS = {
	/** Mocha test timeout for E2E tests */
	MOCHA_TEST: 20000,
	/** Timeout when waiting for diagnostics to appear */
	DIAGNOSTICS_WAIT: 10000,
	/** Default timeout for waitForDiagnostics function */
	DIAGNOSTICS_WAIT_DEFAULT: 5000,
	/** CLI execution timeout in tests */
	CLI_TIMEOUT: 2000,
} as const;

/**
 * Delay values for test operations.
 * All values are in milliseconds.
 */
export const TEST_DELAYS = {
	/** Sleep duration after cleanup operations */
	CLEANUP_SLEEP: 200,
	/** Short debounce delay for runOnType tests */
	DEBOUNCE_SHORT: 50,
	/** Delay for mock client ready simulation */
	CLIENT_READY: 10,
	/** Wait time for process cleanup */
	PROCESS_CLEANUP: 100,
} as const;

/**
 * Retry configuration for file system operations.
 */
export const RETRY_CONFIG = {
	/** Maximum number of retry attempts for file operations */
	MAX_RETRIES: 30,
	/** Delay between retry attempts in milliseconds */
	RETRY_DELAY: 100,
} as const;

/**
 * Fake CLI rule names used in tests.
 */
export const FAKE_CLI_RULES = {
	/** Generic fake rule for basic tests */
	FAKE_RULE: "FakeRule",
	/** Rule for manual run tests */
	MANUAL_RULE: "ManualRule",
	/** Rule for run-on-type tests */
	TYPE_RULE: "TypeRule",
	/** Rule for run-on-open tests */
	OPEN_RULE: "OpenRule",
} as const;

/**
 * Type exports for better IDE support and type safety.
 */
export type TestTimeoutKey = keyof typeof TEST_TIMEOUTS;
export type TestDelayKey = keyof typeof TEST_DELAYS;
export type RetryConfigKey = keyof typeof RETRY_CONFIG;
export type FakeCliRuleKey = keyof typeof FAKE_CLI_RULES;
