import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CONFIG_CACHE_MAX_SIZE, CONFIG_CACHE_TTL_MS } from "./constants";
import { normalizeForCompare } from "../shared/normalize";

const defaultConfigFileNames = [".tsqlrefinerc"];

type CacheEntry = {
	value: string | null;
	checkedAtMs: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * Evict expired entries and limit cache size to prevent memory leaks.
 */
function evictStaleEntries(): void {
	const now = Date.now();

	// Remove expired entries
	for (const [key, entry] of cache) {
		if (now - entry.checkedAtMs >= CONFIG_CACHE_TTL_MS) {
			cache.delete(key);
		}
	}

	// If still over limit, remove oldest entries
	if (cache.size > CONFIG_CACHE_MAX_SIZE) {
		const entries = Array.from(cache.entries());
		entries.sort((a, b) => a[1].checkedAtMs - b[1].checkedAtMs);
		const toRemove = entries.slice(0, cache.size - CONFIG_CACHE_MAX_SIZE);
		for (const [key] of toRemove) {
			cache.delete(key);
		}
	}
}

export type ResolveConfigPathOptions = {
	configuredConfigPath: string | undefined;
	filePath: string | null;
	workspaceRoot: string | null;
};

export async function resolveConfigPath(
	options: ResolveConfigPathOptions,
): Promise<string | undefined> {
	const configured = normalizeConfiguredConfigPath(
		options.configuredConfigPath,
	);
	const baseDir = resolveBaseDir(options.filePath, options.workspaceRoot);

	if (configured) {
		return expandPlaceholders(configured, options.filePath, baseDir);
	}

	if (!options.filePath || !baseDir) {
		return undefined;
	}

	return (
		(await findNearestConfigFile({
			startDir: path.dirname(options.filePath),
			stopDir: baseDir,
		})) ?? undefined
	);
}

function normalizeConfiguredConfigPath(
	value: string | undefined,
): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	return trimmed;
}

function resolveBaseDir(
	filePath: string | null,
	workspaceRoot: string | null,
): string | null {
	if (workspaceRoot) {
		return path.resolve(workspaceRoot);
	}
	if (!filePath) {
		return null;
	}
	return path.dirname(filePath);
}

function expandPlaceholders(
	value: string,
	filePath: string | null,
	workspaceRootOrFileDir: string | null,
): string {
	const workspaceFolder = workspaceRootOrFileDir ?? "";
	const fileDirname = filePath ? path.dirname(filePath) : "";
	const expanded = value
		.replaceAll(`\${workspaceFolder}`, workspaceFolder)
		.replaceAll(`\${workspaceRoot}`, workspaceFolder)
		.replaceAll(`\${file}`, filePath ?? "")
		.replaceAll(`\${fileDirname}`, fileDirname);

	return expanded;
}

type FindNearestConfigFileOptions = {
	startDir: string;
	stopDir: string;
	fileNames?: string[];
};

async function findNearestConfigFile(
	options: FindNearestConfigFileOptions,
): Promise<string | null> {
	const startDir = path.resolve(options.startDir);
	const stopDir = path.resolve(options.stopDir);
	const fileNames = options.fileNames ?? defaultConfigFileNames;
	const key = `${startDir}|${stopDir}|${fileNames.join(",")}`;

	const existing = cache.get(key);
	if (existing && Date.now() - existing.checkedAtMs < CONFIG_CACHE_TTL_MS) {
		return existing.value;
	}

	// Evict stale entries before adding new ones
	evictStaleEntries();

	const resolved = await findNearestConfigFileUncached({
		startDir,
		stopDir,
		fileNames,
	});
	cache.set(key, { value: resolved, checkedAtMs: Date.now() });
	return resolved;
}

async function findNearestConfigFileUncached(
	options: Required<FindNearestConfigFileOptions>,
): Promise<string | null> {
	let current = options.startDir;
	const stopDir = options.stopDir;
	const normalizedStopDir = normalizeForCompare(stopDir);

	while (true) {
		for (const fileName of options.fileNames) {
			const candidate = path.join(current, fileName);
			if (await isFile(candidate)) {
				return candidate;
			}
		}

		if (normalizeForCompare(current) === normalizedStopDir) {
			return null;
		}

		const parent = path.dirname(current);
		if (parent === current) {
			return null;
		}

		if (!isWithinOrEqual(parent, stopDir)) {
			if (isWithinOrEqual(current, stopDir)) {
				current = stopDir;
				continue;
			}
			return null;
		}

		current = parent;
	}
}

function isWithinOrEqual(candidatePath: string, parentPath: string): boolean {
	const candidate = normalizeForCompare(candidatePath);
	const parent = normalizeForCompare(parentPath);
	if (candidate === parent) {
		return true;
	}
	const relative = path.relative(parent, candidate);
	return (
		relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
	);
}

async function isFile(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile();
	} catch {
		return false;
	}
}
