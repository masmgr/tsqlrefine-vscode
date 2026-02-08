export type DiagnosticCounts = {
	errors: number;
	warnings: number;
	infos: number;
	hints: number;
};

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
