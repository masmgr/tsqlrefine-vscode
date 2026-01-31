import type { TsqllintSettings } from "../config/settings";
import { normalizeConfigPath } from "../shared/normalize";
import { resolveCommand, runProcess } from "../shared/processRunner";
import { type ProcessRunResult, createCancelledResult } from "../shared/types";

export type RunFormatterOptions = {
	filePath: string;
	cwd: string;
	settings: TsqllintSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Build command-line arguments for tsqlrefine format operation.
 */
function buildArgs(options: RunFormatterOptions): string[] {
	const args: string[] = ["format"];
	const configPath = normalizeConfigPath(options.settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	// Use --stdin to read content from stdin
	args.push("--stdin");
	return args;
}

/**
 * Run tsqlrefine format on stdin content.
 */
export async function runFormatter(
	options: RunFormatterOptions,
): Promise<ProcessRunResult> {
	if (options.signal.aborted) {
		return createCancelledResult();
	}

	const command = await resolveCommand(options.settings);
	const args = buildArgs(options);
	const timeoutMs =
		options.settings.formatTimeoutMs ?? options.settings.timeoutMs;

	return runProcess({
		command,
		args,
		cwd: options.cwd,
		timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
