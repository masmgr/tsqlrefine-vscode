import * as path from "node:path";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";

// New format: <filepath>:<line>:<column>: <severity>: <message> (<rule-id>)
// Windows paths start with drive letter (e.g., C:\path), so we handle that specially
const pattern =
	/^(?<file>(?:[A-Za-z]:)?[^:]+):(?<line>\d+):(?<col>\d+): (?<severity>Error|Warning|Information|Hint): (?<message>.+) \((?<rule>[^)]+)\)$/i;

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
	switch (normalized) {
		case "error":
			return DiagnosticSeverity.Error;
		case "warning":
			return DiagnosticSeverity.Warning;
		case "hint":
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Information;
	}
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
					severity: string;
					message: string;
					rule: string;
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
		const rawSeverity = groups.severity;
		const rawMessage = groups.message;
		const rawRule = groups.rule;
		if (!rawLine || !rawCol || !rawSeverity || !rawMessage || !rawRule) {
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
