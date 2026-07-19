import type { TsqlRefineSettings } from "../config/settings";
import { buildCliArgs, runCliOperation } from "../shared/cliRunner";
export { verifyInstallation as verifyTsqlRefineInstallation } from "../shared/processRunner";
import type { ProcessRunResult } from "../shared/types";

export type RunLinterOptions = {
	filePath: string;
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	/** Document content to pass via stdin. */
	stdin: string;
};

/**
 * Build command-line arguments for tsqlrefine lint operation.
 */
export function buildArgs(options: RunLinterOptions): string[] {
	return buildCliArgs(options.settings, {
		operation: "lint",
		includeSeverity: true,
		outputJson: true,
	});
}

/**
 * Run tsqlrefine lint on a file or stdin content.
 */
export async function runLinter(
	options: RunLinterOptions,
): Promise<ProcessRunResult> {
	const args = buildArgs(options);

	return runCliOperation({
		settings: options.settings,
		args,
		cwd: options.cwd,
		timeoutMs: options.settings.timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
