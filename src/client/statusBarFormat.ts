export type DiagnosticCounts = {
	errors: number;
	warnings: number;
	infos: number;
	hints: number;
};

export function emptyDiagnosticCounts(): DiagnosticCounts {
	return { errors: 0, warnings: 0, infos: 0, hints: 0 };
}

export function isEmptyDiagnosticCounts(counts: DiagnosticCounts): boolean {
	return (
		counts.errors === 0 &&
		counts.warnings === 0 &&
		counts.infos === 0 &&
		counts.hints === 0
	);
}

/**
 * Add `delta` into `target` in place. Pass `sign: -1` to subtract, which is how
 * a per-file tally is removed from the running totals before being replaced.
 */
export function accumulateDiagnosticCounts(
	target: DiagnosticCounts,
	delta: DiagnosticCounts,
	sign: 1 | -1 = 1,
): void {
	target.errors += delta.errors * sign;
	target.warnings += delta.warnings * sign;
	target.infos += delta.infos * sign;
	target.hints += delta.hints * sign;
}

export function formatStatusBarText(
	counts: DiagnosticCounts,
	isRunning: boolean,
	isDisabled: boolean,
): string {
	if (isDisabled) {
		return "$(circle-slash) TSQLRefine: Off";
	}
	if (isRunning) {
		return "$(sync~spin) TSQLRefine";
	}
	if (counts.errors === 0 && counts.warnings === 0) {
		return "$(check) TSQLRefine";
	}

	const parts: string[] = [];
	if (counts.errors > 0) {
		parts.push(`${counts.errors}E`);
	}
	if (counts.warnings > 0) {
		parts.push(`${counts.warnings}W`);
	}
	return `$(warning) TSQLRefine: ${parts.join(" ")}`;
}

export function formatStatusBarTooltip(counts: DiagnosticCounts): string {
	const lines = [
		`Errors: ${counts.errors}`,
		`Warnings: ${counts.warnings}`,
		`Info: ${counts.infos}`,
		`Hints: ${counts.hints}`,
	];
	return `TSQLRefine\n${lines.join("\n")}`;
}
