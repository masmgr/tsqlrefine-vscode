import type { TsqlRefineSettings } from "../config/settings";
import { normalizeConfigPath } from "../shared/normalize";
import {
	resolveCommand,
	runProcess,
	verifyInstallation,
} from "../shared/processRunner";
import { type ProcessRunResult, createCancelledResult } from "../shared/types";

export type RunLinterOptions = {
	filePath: string;
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Verify that tsqlrefine is available for the given settings.
 * This is a lightweight check used at startup and when settings change.
 *
 * @param settings - The tsqlrefine settings to verify
 * @returns Object with available status and error message if not available
 */
export async function verifyTsqlRefineInstallation(
	settings: TsqlRefineSettings,
): Promise<{ available: boolean; message?: string }> {
	return verifyInstallation(settings);
}

/**
 * Build command-line arguments for tsqlrefine lint operation.
 */
function buildArgs(options: RunLinterOptions): string[] {
	const args: string[] = ["lint", "-q"];
	const configPath = normalizeConfigPath(options.settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	// Add severity threshold
	args.push("--severity", options.settings.minSeverity);
	// Use JSON output for structured diagnostics
	args.push("--output", "json");
	// Use --stdin to read content from stdin
	args.push("--stdin");
	return args;
}

/**
 * Run tsqlrefine lint on a file or stdin content.
 */
export async function runLinter(
	options: RunLinterOptions,
): Promise<ProcessRunResult> {
	if (options.signal.aborted) {
		return createCancelledResult();
	}

	const command = await resolveCommand(options.settings);
	const args = buildArgs(options);

	return runProcess({
		command,
		args,
		cwd: options.cwd,
		timeoutMs: options.settings.timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
