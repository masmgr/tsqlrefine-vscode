import * as fs from "node:fs/promises";
import * as path from "node:path";

const defaultConfigFileNames = [".tsqlrefinerc"];
const cacheTtlMs = 5000;

type CacheEntry = {
	value: string | null;
	checkedAtMs: number;
};

const cache = new Map<string, CacheEntry>();

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
	if (existing && Date.now() - existing.checkedAtMs < cacheTtlMs) {
		return existing.value;
	}

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

function normalizeForCompare(filePath: string): string {
	const normalized = path.resolve(filePath);
	if (process.platform === "win32") {
		return normalized.toLowerCase();
	}
	return normalized;
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
