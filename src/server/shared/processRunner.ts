import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import type { TsqllintSettings } from "../config/settings";
import {
	COMMAND_CACHE_TTL_MS,
	COMMAND_CHECK_TIMEOUT_MS,
	DEFAULT_COMMAND_NAME,
} from "../config/constants";
import { decodeCliOutput } from "../lint/decodeOutput";
import { normalizeExecutablePath } from "./normalize";
import type { BaseProcessOptions, ProcessRunResult } from "./types";

/**
 * Command availability cache (shared between lint and format operations).
 */
let cachedCommandAvailability: {
	command: string;
	available: boolean;
	checkedAt: number;
} | null = null;

/**
 * Resolve spawn command for Windows (wrap .cmd/.bat with cmd.exe /c).
 */
export function resolveSpawn(
	command: string,
	args: string[],
): { command: string; args: string[] } {
	if (process.platform !== "win32") {
		return { command, args };
	}
	const normalized = command.toLowerCase();
	if (normalized.endsWith(".cmd") || normalized.endsWith(".bat")) {
		const env = process.env as NodeJS.ProcessEnv & { ComSpec?: string };
		const comspec = env.ComSpec ?? "cmd.exe";
		return { command: comspec, args: ["/c", command, ...args] };
	}
	return { command, args };
}

/**
 * Assert that a file path exists and is a file.
 */
export async function assertPathExists(filePath: string): Promise<void> {
	try {
		const stat = await fs.stat(filePath);
		if (!stat.isFile()) {
			throw new Error(`tsqlrefine.path is not a file: ${filePath}`);
		}
	} catch (error) {
		// Re-throw if it's already our custom error message
		if (error instanceof Error && error.message.includes("not a file")) {
			throw error;
		}
		throw new Error(`tsqlrefine.path not found: ${filePath}`);
	}
}

/**
 * Check if a command is available in PATH.
 */
export async function checkCommandAvailable(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, ["--version"], {
			stdio: "ignore",
		});
		const timer = setTimeout(() => {
			child.kill();
			resolve(false);
		}, COMMAND_CHECK_TIMEOUT_MS);
		child.on("error", () => {
			clearTimeout(timer);
			resolve(false);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code === 0);
		});
	});
}

/**
 * Resolve the command to execute based on settings.
 * Uses caching to avoid repeated PATH lookups.
 */
export async function resolveCommand(
	settings: TsqllintSettings,
): Promise<string> {
	const configuredPath = normalizeExecutablePath(settings.path);
	if (configuredPath) {
		await assertPathExists(configuredPath);
		return configuredPath;
	}
	const command = DEFAULT_COMMAND_NAME;
	if (
		cachedCommandAvailability &&
		cachedCommandAvailability.command === command
	) {
		const isFresh =
			Date.now() - cachedCommandAvailability.checkedAt < COMMAND_CACHE_TTL_MS;
		if (!cachedCommandAvailability.available && isFresh) {
			throw new Error(
				"tsqlrefine not found. Set tsqlrefine.path or install tsqlrefine.",
			);
		}
		if (cachedCommandAvailability.available) {
			return command;
		}
	}
	const available = await checkCommandAvailable(command);
	cachedCommandAvailability = { command, available, checkedAt: Date.now() };
	if (!available) {
		throw new Error(
			"tsqlrefine not found. Set tsqlrefine.path or install tsqlrefine.",
		);
	}
	return command;
}

/**
 * Verify tsqlrefine installation (lightweight startup check).
 *
 * @param settings - The tsqlrefine settings to verify
 * @returns Object with available status and error message if not available
 */
export async function verifyInstallation(
	settings: TsqllintSettings,
): Promise<{ available: boolean; message?: string }> {
	try {
		await resolveCommand(settings);
		return { available: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { available: false, message };
	}
}

/**
 * Run a CLI process with timeout, cancellation, and output capture.
 */
export function runProcess(
	options: BaseProcessOptions,
): Promise<ProcessRunResult> {
	if (options.signal.aborted) {
		return Promise.resolve({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: false,
			cancelled: true,
		});
	}

	const spawnSpec = resolveSpawn(options.command, options.args);

	return new Promise((resolve, reject) => {
		let settled = false;
		let timedOut = false;
		let cancelled = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timer: NodeJS.Timeout | null = null;

		const child = spawn(spawnSpec.command, spawnSpec.args, {
			cwd: options.cwd,
			stdio: [options.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
		});

		// Write stdin content if provided (as UTF-8 encoded Buffer)
		if (options.stdin != null && child.stdin) {
			const stdinBuffer = Buffer.from(options.stdin, "utf8");
			child.stdin.write(stdinBuffer);
			child.stdin.end();
		}

		const decodeBuffers = (): { stdout: string; stderr: string } => {
			const stdoutBuffer = Buffer.concat(stdoutChunks);
			const stderrBuffer = Buffer.concat(stderrChunks);
			return {
				stdout: decodeCliOutput(stdoutBuffer),
				stderr: decodeCliOutput(stderrBuffer),
			};
		};

		const finish = (result: ProcessRunResult) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			resolve(result);
		};

		const fail = (error: Error) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			reject(error);
		};

		timer = setTimeout(() => {
			timedOut = true;
			child.kill();
			const { stdout, stderr } = decodeBuffers();
			finish({
				stdout,
				stderr,
				exitCode: null,
				timedOut,
				cancelled,
			});
		}, options.timeoutMs);

		options.signal.addEventListener(
			"abort",
			() => {
				cancelled = true;
				child.kill();
				const { stdout, stderr } = decodeBuffers();
				finish({
					stdout,
					stderr,
					exitCode: null,
					timedOut,
					cancelled,
				});
			},
			{ once: true },
		);

		child.stdout?.on("data", (data: Buffer) => {
			stdoutChunks.push(data);
		});
		child.stderr?.on("data", (data: Buffer) => {
			stderrChunks.push(data);
		});

		child.on("error", (error) => {
			fail(error);
		});

		child.on("close", (exitCode) => {
			const { stdout, stderr } = decodeBuffers();
			finish({
				stdout,
				stderr,
				exitCode,
				timedOut,
				cancelled,
			});
		});
	});
}
