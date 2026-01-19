import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { TsqllintSettings } from "../config/settings";
import { decodeCliOutput } from "./decodeOutput";
import type { LintRunResult } from "./types";

export type RunTsqllintOptions = {
	filePath: string;
	cwd: string;
	settings: TsqllintSettings;
	signal: AbortSignal;
};

export async function runTsqllint(
	options: RunTsqllintOptions,
): Promise<LintRunResult> {
	if (options.signal.aborted) {
		return {
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: false,
			cancelled: true,
		};
	}

	const command = await resolveCommand(options.settings);
	const args = buildArgs(options);
	const spawnSpec = resolveSpawn(command, args);

	return new Promise((resolve, reject) => {
		let settled = false;
		let timedOut = false;
		let cancelled = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let timer: NodeJS.Timeout | null = null;

		const child = spawn(spawnSpec.command, spawnSpec.args, {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const finish = (result: LintRunResult) => {
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

		const decodeBuffers = (): { stdout: string; stderr: string } => {
			const stdoutBuffer = Buffer.concat(stdoutChunks);
			const stderrBuffer = Buffer.concat(stderrChunks);
			return {
				stdout: decodeCliOutput(stdoutBuffer),
				stderr: decodeCliOutput(stderrBuffer),
			};
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
		}, options.settings.timeoutMs);

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

		child.stdout.on("data", (data: Buffer) => {
			stdoutChunks.push(data);
		});
		child.stderr.on("data", (data: Buffer) => {
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

const commandCacheTtlMs = 30000;
let cachedCommandAvailability: {
	command: string;
	available: boolean;
	checkedAt: number;
} | null = null;

function resolveSpawn(
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

function buildArgs(options: RunTsqllintOptions): string[] {
	const args: string[] = [];
	const configPath = normalizeConfigPath(options.settings.configPath);
	if (configPath) {
		args.push("-c", configPath);
	}
	args.push(options.filePath);
	return args;
}

async function resolveCommand(settings: TsqllintSettings): Promise<string> {
	const configuredPath = normalizeExecutablePath(settings.path);
	if (configuredPath) {
		await assertPathExists(configuredPath);
		return configuredPath;
	}
	const command = "tsqllint";
	if (
		cachedCommandAvailability &&
		cachedCommandAvailability.command === command
	) {
		const isFresh =
			Date.now() - cachedCommandAvailability.checkedAt < commandCacheTtlMs;
		if (!cachedCommandAvailability.available && isFresh) {
			throw new Error(
				"tsqllint not found. Set tsqllint.path or install tsqllint.",
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
			"tsqllint not found. Set tsqllint.path or install tsqllint.",
		);
	}
	return command;
}

async function assertPathExists(filePath: string): Promise<void> {
	try {
		const stat = await fs.stat(filePath);
		if (!stat.isFile()) {
			throw new Error(`tsqllint.path is not a file: ${filePath}`);
		}
	} catch (_error) {
		throw new Error(`tsqllint.path not found: ${filePath}`);
	}
}

async function checkCommandAvailable(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, ["--version"], {
			stdio: "ignore",
		});
		const timer = setTimeout(() => {
			child.kill();
			resolve(false);
		}, 3000);
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

function normalizeExecutablePath(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return path.resolve(trimmed);
}

function normalizeConfigPath(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed;
}
