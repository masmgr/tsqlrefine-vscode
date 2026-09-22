import * as vscode from "vscode";
import {
	accumulateDiagnosticCounts,
	type DiagnosticCounts,
	emptyDiagnosticCounts,
	formatStatusBarText,
	formatStatusBarTooltip,
	isEmptyDiagnosticCounts,
} from "./statusBarFormat";

function countTsqlRefineDiagnostics(
	diagnostics: readonly vscode.Diagnostic[],
): DiagnosticCounts {
	const counts = emptyDiagnosticCounts();
	for (const diag of diagnostics) {
		if (diag.source !== "tsqlrefine") {
			continue;
		}
		switch (diag.severity) {
			case vscode.DiagnosticSeverity.Error:
				counts.errors++;
				break;
			case vscode.DiagnosticSeverity.Warning:
				counts.warnings++;
				break;
			case vscode.DiagnosticSeverity.Information:
				counts.infos++;
				break;
			case vscode.DiagnosticSeverity.Hint:
				counts.hints++;
				break;
		}
	}
	return counts;
}

export class StatusBarManager {
	private statusBarItem: vscode.StatusBarItem | undefined;
	private runningCount = 0;
	private disabled = false;
	/**
	 * Per-file tsqlrefine tallies, so a diagnostics change only re-counts the
	 * files it touched. `onDidChangeDiagnostics` fires for every extension, and
	 * rescanning the whole workspace each time is expensive in large projects.
	 */
	private readonly countsByUri = new Map<string, DiagnosticCounts>();
	private readonly totals: DiagnosticCounts = emptyDiagnosticCounts();

	initialize(context: vscode.ExtensionContext): void {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.statusBarItem.command = "workbench.action.problems.focus";
		context.subscriptions.push(this.statusBarItem);
		this.recountAll();
		this.updateDisplay();
		this.statusBarItem.show();
	}

	updateDiagnostics(uris?: readonly vscode.Uri[]): void {
		if (uris) {
			for (const uri of uris) {
				this.applyCounts(
					uri.toString(),
					countTsqlRefineDiagnostics(vscode.languages.getDiagnostics(uri)),
				);
			}
		} else {
			this.recountAll();
		}
		this.updateDisplay();
	}

	private recountAll(): void {
		this.countsByUri.clear();
		accumulateDiagnosticCounts(this.totals, this.totals, -1);
		for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
			this.applyCounts(uri.toString(), countTsqlRefineDiagnostics(diagnostics));
		}
	}

	private applyCounts(key: string, next: DiagnosticCounts): void {
		const previous = this.countsByUri.get(key);
		if (previous) {
			accumulateDiagnosticCounts(this.totals, previous, -1);
		}
		if (isEmptyDiagnosticCounts(next)) {
			this.countsByUri.delete(key);
			return;
		}
		this.countsByUri.set(key, next);
		accumulateDiagnosticCounts(this.totals, next, 1);
	}

	setOperationState(state: "started" | "completed"): void {
		if (state === "started") {
			this.runningCount++;
		} else {
			this.runningCount = Math.max(0, this.runningCount - 1);
		}
		this.updateDisplay();
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.updateDisplay();
	}

	private updateDisplay(): void {
		if (!this.statusBarItem) {
			return;
		}
		const isRunning = this.runningCount > 0;
		this.statusBarItem.text = formatStatusBarText(
			this.totals,
			isRunning,
			this.disabled,
		);
		this.statusBarItem.tooltip = formatStatusBarTooltip(this.totals);
	}
}
