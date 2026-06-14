import type { TsqlRefineSettings } from "../config/settings";
import { normalizeConfigPath } from "../shared/normalize";
import { resolveCommand, runProcess } from "../shared/processRunner";
import { type ProcessRunResult, createCancelledResult } from "../shared/types";

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
	const args: string[] = ["fix", "-q", "--utf8"];
	const configPath = normalizeConfigPath(settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	if (settings.allowPlugins) {
		args.push("--allow-plugins");
	}
	// Add severity threshold
	args.push("--severity", settings.minSeverity);
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
	const args = buildArgs(options.settings);
	const timeoutMs = options.settings.fixTimeoutMs ?? options.settings.timeoutMs;

	return runProcess({
		command,
		args,
		cwd: options.cwd,
		timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
