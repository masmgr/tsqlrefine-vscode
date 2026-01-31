import type { TsqllintSettings } from "../config/settings";
import { normalizeConfigPath } from "../shared/normalize";
import {
	resolveCommand,
	runProcess,
	verifyInstallation,
} from "../shared/processRunner";
import { type ProcessRunResult, createCancelledResult } from "../shared/types";

export type RunTsqllintOptions = {
	filePath: string;
	cwd: string;
	settings: TsqllintSettings;
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
export async function verifyTsqllintInstallation(
	settings: TsqllintSettings,
): Promise<{ available: boolean; message?: string }> {
	return verifyInstallation(settings);
}

/**
 * Build command-line arguments for tsqlrefine lint operation.
 */
function buildArgs(options: RunTsqllintOptions): string[] {
	const args: string[] = ["lint"];
	const configPath = normalizeConfigPath(options.settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	// Use --stdin to read content from stdin
	args.push("--stdin");
	return args;
}

/**
 * Run tsqlrefine lint on a file or stdin content.
 */
export async function runTsqllint(
	options: RunTsqllintOptions,
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
