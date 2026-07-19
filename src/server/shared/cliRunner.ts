import type { TsqlRefineSettings } from "../config/settings";
import { normalizeConfigPath } from "./normalize";
import { resolveCommand, runProcess } from "./processRunner";
import { type ProcessRunResult, createCancelledResult } from "./types";

export type CliOperation = "lint" | "format" | "fix";

export function buildCliArgs(
	settings: TsqlRefineSettings,
	options: {
		operation: CliOperation;
		includeSeverity?: boolean;
		outputJson?: boolean;
	},
): string[] {
	const args = [options.operation, "-q", "--utf8"];
	const configPath = normalizeConfigPath(settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	if (settings.allowPlugins) {
		args.push("--allow-plugins");
	}
	if (options.includeSeverity) {
		args.push("--severity", settings.minSeverity);
	}
	if (options.outputJson) {
		args.push("--output", "json");
	}
	args.push("--stdin");
	return args;
}

export async function runCliOperation(options: {
	cwd: string;
	settings: TsqlRefineSettings;
	signal: AbortSignal;
	stdin: string;
	args: string[];
	timeoutMs: number;
}): Promise<ProcessRunResult> {
	if (options.signal.aborted) {
		return createCancelledResult();
	}
	const command = await resolveCommand(options.settings, options.cwd);
	return runProcess({
		command,
		args: options.args,
		cwd: options.cwd,
		timeoutMs: options.timeoutMs,
		signal: options.signal,
		stdin: options.stdin,
	});
}
