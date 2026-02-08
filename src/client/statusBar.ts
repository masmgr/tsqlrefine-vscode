import * as vscode from "vscode";
import {
	type DiagnosticCounts,
	formatStatusBarText,
	formatStatusBarTooltip,
} from "./statusBarFormat";

function countDiagnostics(): DiagnosticCounts {
	const counts: DiagnosticCounts = {
		errors: 0,
		warnings: 0,
		infos: 0,
		hints: 0,
	};
	for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
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
	}
	return counts;
}

export class StatusBarManager {
	private statusBarItem: vscode.StatusBarItem | undefined;
	private runningCount = 0;
	private disabled = false;

	initialize(context: vscode.ExtensionContext): void {
		this.statusBarItem = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Left,
			100,
		);
		this.statusBarItem.command = "workbench.action.problems.focus";
		context.subscriptions.push(this.statusBarItem);
		this.updateDisplay();
		this.statusBarItem.show();
	}

	updateDiagnostics(): void {
		this.updateDisplay();
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
		const counts = countDiagnostics();
		const isRunning = this.runningCount > 0;
		this.statusBarItem.text = formatStatusBarText(
			counts,
			isRunning,
			this.disabled,
		);
		this.statusBarItem.tooltip = formatStatusBarTooltip(counts);
	}
}
