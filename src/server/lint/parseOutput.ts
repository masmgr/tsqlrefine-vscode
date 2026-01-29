import * as path from "node:path";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";

const pattern =
	/^(?<file>.+)\((?<line>\d+),(?<col>\d+)\): (?<details>.+) : (?<message>.+?)(?:\.)?$/i;

type ParseOutputOptions = {
	stdout: string;
	uri: string;
	cwd: string | null;
	lines: string[];
	targetPaths?: string[];
	logger?: {
		log: (message: string) => void;
	};
};

function normalizeForCompare(filePath: string): string {
	const normalized = path.normalize(filePath);
	if (process.platform === "win32") {
		return normalized.toLowerCase();
	}
	return normalized;
}

function mapSeverity(severity: string): DiagnosticSeverity {
	const normalized = severity.toLowerCase();
	if (normalized === "error") {
		return DiagnosticSeverity.Error;
	}
	if (normalized === "warning") {
		return DiagnosticSeverity.Warning;
	}
	return DiagnosticSeverity.Information;
}

export function parseOutput(options: ParseOutputOptions): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const targetPath = normalizeForCompare(URI.parse(options.uri).fsPath);
	const extraTargets = options.targetPaths ?? [];
	const targetPaths = new Set(
		[targetPath, ...extraTargets].map((filePath) =>
			normalizeForCompare(filePath),
		),
	);
	const cwd = options.cwd ?? path.dirname(targetPath);

	options.logger?.log(
		`[parseOutput] Target paths: ${JSON.stringify([...targetPaths])}`,
	);
	options.logger?.log(`[parseOutput] CWD: ${cwd}`);
	options.logger?.log(`[parseOutput] stdout:\n${options.stdout}`);

	for (const line of options.stdout.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}
		const match = pattern.exec(line);
		const groups = match?.groups as
			| {
					file: string;
					line: string;
					col: string;
					details: string;
					message: string;
			  }
			| undefined;
		if (!groups) {
			continue;
		}

		const rawPath = groups.file;
		if (!rawPath) {
			continue;
		}
		const resolvedPath = normalizeForCompare(path.resolve(cwd, rawPath));
		options.logger?.log(`[parseOutput] Line: ${line}`);
		options.logger?.log(
			`[parseOutput] Raw path: ${rawPath} -> Resolved: ${resolvedPath}`,
		);
		if (!targetPaths.has(resolvedPath)) {
			options.logger?.log(`[parseOutput] Path not in target paths, skipping`);
			continue;
		}

		const rawLine = groups.line;
		const rawCol = groups.col;
		const rawDetails = groups.details;
		const rawMessage = groups.message;
		if (!rawLine || !rawCol || !rawDetails || !rawMessage) {
			continue;
		}

		const parts = rawDetails.trim().split(/\s+/);
		if (parts.length < 2) {
			continue;
		}
		const rawSeverity = parts[0];
		const rawRule = parts[parts.length - 1];
		if (!rawSeverity || !rawRule) {
			continue;
		}

		const lineNumber = Math.max(0, Number(rawLine) - 1);
		const lineText = options.lines[lineNumber] ?? "";
		const lineLength = lineText.length;

		const start = { line: lineNumber, character: 0 };
		const end = { line: lineNumber, character: lineLength };

		diagnostics.push({
			message: rawMessage,
			severity: mapSeverity(rawSeverity),
			range: { start, end },
			code: rawRule,
			source: "tsqlrefine",
		});
	}

	return diagnostics;
}
