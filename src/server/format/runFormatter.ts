import type { TsqlRefineSettings } from "../config/settings";
import { buildCliArgs, runCliOperation } from "../shared/cliRunner";
import type { ProcessRunResult } from "../shared/types";

export type RunFormatterOptions = {
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Build command-line arguments for tsqlrefine format operation.
 */
export function buildArgs(settings: TsqlRefineSettings): string[] {
	return buildCliArgs(settings, { operation: "format" });
}

/**
 * Run tsqlrefine format on stdin content.
 */
export async function runFormatter(
	options: RunFormatterOptions,
): Promise<ProcessRunResult> {
	const args = buildArgs(options.settings);
	const timeoutMs =
		options.settings.formatTimeoutMs ?? options.settings.timeoutMs;

	return runCliOperation({
		settings: options.settings,
		args,
		cwd: options.cwd,
		timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
