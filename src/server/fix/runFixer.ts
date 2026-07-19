import type { TsqlRefineSettings } from "../config/settings";
import { buildCliArgs, runCliOperation } from "../shared/cliRunner";
import type { ProcessRunResult } from "../shared/types";

export type RunFixerOptions = {
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Build command-line arguments for tsqlrefine fix operation.
 */
export function buildArgs(settings: TsqlRefineSettings): string[] {
	return buildCliArgs(settings, {
		operation: "fix",
		includeSeverity: true,
	});
}

/**
 * Run tsqlrefine fix on stdin content.
 */
export async function runFixer(
	options: RunFixerOptions,
): Promise<ProcessRunResult> {
	const args = buildArgs(options.settings);
	const timeoutMs = options.settings.fixTimeoutMs ?? options.settings.timeoutMs;

	return runCliOperation({
		settings: options.settings,
		args,
		cwd: options.cwd,
		timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
