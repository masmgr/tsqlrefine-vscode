import {
	createCancelledResult,
	type ProcessRunResult,
} from "../../server/shared/types";

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * A successful CLI run. `exitCode` defaults to 0 and `stderr` to empty so the
 * common case stays a one-argument call.
 */
export function cliResult(
	stdout: string,
	exitCode: number | null = 0,
	stderr = "",
): ProcessRunResult {
	return { stdout, stderr, exitCode, timedOut: false, cancelled: false };
}

/**
 * A run that `runProcess` abandoned after `timeoutMs` elapsed: the child was
 * killed, so there is no exit code.
 */
export function cliTimedOut(stderr = ""): ProcessRunResult {
	return {
		stdout: "",
		stderr,
		exitCode: null,
		timedOut: true,
		cancelled: false,
	};
}

/** A run that a superseding operation aborted. */
export function cliCancelled(): ProcessRunResult {
	return createCancelledResult();
}

export const diagnosticJson = JSON.stringify({
	files: [
		{
			filePath: "<stdin>",
			diagnostics: [
				{
					message: "Parse error near FROM",
					code: "parse-error",
					severity: 1,
					range: {
						start: { line: 0, character: 7 },
						end: { line: 0, character: 11 },
					},
				},
			],
		},
	],
});
