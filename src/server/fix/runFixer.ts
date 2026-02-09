import type { TsqlRefineSettings } from "../config/settings";
import { normalizeConfigPath } from "../shared/normalize";
import { resolveCommand, runProcess } from "../shared/processRunner";
import { type ProcessRunResult, createCancelledResult } from "../shared/types";

export type RunFixerOptions = {
	filePath: string;
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Build command-line arguments for tsqlrefine fix operation.
 */
function buildArgs(options: RunFixerOptions): string[] {
	const args: string[] = ["fix", "-q", "--utf8"];
	const configPath = normalizeConfigPath(options.settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	// Add severity threshold
	args.push("--severity", options.settings.minSeverity);
	// Use --stdin to read content from stdin
	args.push("--stdin");
	return args;
}

/**
 * Run tsqlrefine fix on stdin content.
 */
export async function runFixer(
	options: RunFixerOptions,
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
