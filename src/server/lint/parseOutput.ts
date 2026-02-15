import * as path from "node:path";
import {
	type Diagnostic,
	DiagnosticSeverity,
} from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import { normalizeForCompare } from "../shared/normalize";

/** CLI JSON output: top-level structure */
type CliJsonOutput = {
	tool: string;
	version: string;
	command: string;
	files: CliFileResult[];
};

/** CLI JSON output: per-file result */
type CliFileResult = {
	filePath: string;
	diagnostics: CliDiagnostic[];
};

/** CLI JSON output: single diagnostic */
type CliDiagnostic = {
	range: {
		start: { line: number; character: number };
		end: { line: number; character: number };
	};
	severity?: number;
	code?: string;
	source?: string;
	message: string;
	tags?: number[];
	data?: {
		ruleId?: string;
		category?: string;
		fixable?: boolean;
		codeDescriptionHref?: string;
	};
};

export type ParseOutputOptions = {
	stdout: string;
	uri: string;
	cwd: string | null;
	targetPaths?: string[];
	logger?: {
		log: (message: string) => void;
	};
};

function mapSeverity(severity: number | undefined): DiagnosticSeverity {
	switch (severity) {
		case 1:
			return DiagnosticSeverity.Error;
		case 2:
			return DiagnosticSeverity.Warning;
		case 4:
			return DiagnosticSeverity.Hint;
		default:
			return DiagnosticSeverity.Information;
	}
}

// Special stdin marker that should not be path-resolved
const STDIN_MARKER = "<stdin>";

export function parseOutput(options: ParseOutputOptions): Diagnostic[] {
	if (!options.stdout.trim()) {
		return [];
	}

	let parsed: CliJsonOutput;
	try {
		parsed = JSON.parse(options.stdout) as CliJsonOutput;
	} catch {
		options.logger?.log(`[parseOutput] Failed to parse JSON output`);
		return [];
	}

	if (!Array.isArray(parsed.files)) {
		options.logger?.log(`[parseOutput] No files array in JSON output`);
		return [];
	}

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

	const diagnostics: Diagnostic[] = [];

	for (const file of parsed.files) {
		const resolvedPath =
			file.filePath === STDIN_MARKER
				? targetPath
				: normalizeForCompare(path.resolve(cwd, file.filePath));

		options.logger?.log(
			`[parseOutput] File: ${file.filePath} -> Resolved: ${resolvedPath}`,
		);

		if (!targetPaths.has(resolvedPath)) {
			options.logger?.log(`[parseOutput] Path not in target paths, skipping`);
			continue;
		}

		if (!Array.isArray(file.diagnostics)) {
			continue;
		}

		for (const diag of file.diagnostics) {
			const diagnostic: Diagnostic = {
				message: diag.message,
				severity: mapSeverity(diag.severity),
				range: {
					start: {
						line: diag.range.start.line,
						character: diag.range.start.character,
					},
					end: {
						line: diag.range.end.line,
						character: diag.range.end.character,
					},
				},
				source: "tsqlrefine",
				data: { fixable: diag.data?.fixable ?? false },
			};
			if (diag.code != null) {
				diagnostic.code = diag.code;
				if (diag.data?.codeDescriptionHref) {
					diagnostic.codeDescription = {
						href: diag.data.codeDescriptionHref,
					};
				}
			}
			diagnostics.push(diagnostic);
		}
	}

	return diagnostics;
}
