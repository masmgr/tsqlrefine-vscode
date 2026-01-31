import * as path from "node:path";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { normalizeForCompare } from "../shared/normalize";

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

// Special stdin marker that should not be path-resolved
const STDIN_MARKER = "<stdin>";

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
		const groups = match?.groups;
		if (!groups) {
			continue;
		}

		// Type guard: verify all required properties exist and are strings
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawPath = groups["file"];
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawLine = groups["line"];
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawCol = groups["col"];
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawSeverity = groups["severity"];
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawMessage = groups["message"];
		// biome-ignore lint/complexity/useLiteralKeys: TypeScript requires bracket notation for index signatures
		const rawRule = groups["rule"];

		if (
			typeof rawPath !== "string" ||
			typeof rawLine !== "string" ||
			typeof rawCol !== "string" ||
			typeof rawSeverity !== "string" ||
			typeof rawMessage !== "string" ||
			typeof rawRule !== "string"
		) {
			continue;
		}

		if (!rawPath) {
			continue;
		}
		// Map stdin marker to the target file path for comparison
		const resolvedPath =
			rawPath === STDIN_MARKER
				? targetPath
				: normalizeForCompare(path.resolve(cwd, rawPath));
		options.logger?.log(`[parseOutput] Line: ${line}`);
		options.logger?.log(
			`[parseOutput] Raw path: ${rawPath} -> Resolved: ${resolvedPath}`,
		);
		if (!targetPaths.has(resolvedPath)) {
			options.logger?.log(`[parseOutput] Path not in target paths, skipping`);
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
