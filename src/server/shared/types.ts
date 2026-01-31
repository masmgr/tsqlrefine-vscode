/**
 * Result from a CLI process execution.
 * Used by both lint and format operations.
 */
export type ProcessRunResult = {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
	cancelled: boolean;
};

/**
 * Create a ProcessRunResult representing a cancelled operation.
 */
export function createCancelledResult(): ProcessRunResult {
	return {
		stdout: "",
		stderr: "",
		exitCode: null,
		timedOut: false,
		cancelled: true,
	};
}

/**
 * Base options for running any CLI process.
 */
export type BaseProcessOptions = {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	signal: AbortSignal;
	stdin?: string | null | undefined;
};
