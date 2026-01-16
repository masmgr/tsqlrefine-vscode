// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { createLanguageClient } from "./client/client";
import type { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient | undefined;
export let clientReady: Promise<void> = Promise.resolve();

// Status bar item for displaying lint status
let statusBarItem: vscode.StatusBarItem | undefined;

export type TsqllintLiteApi = {
	clientReady: Promise<void>;
};

export function activate(context: vscode.ExtensionContext): TsqllintLiteApi {
	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
	statusBarItem.command = "workbench.action.showProblems";
	context.subscriptions.push(statusBarItem);

	client = createLanguageClient(context);
	const startPromise = client.start();
	const maybeReady = (client as { onReady?: () => Promise<void> }).onReady;
	clientReady = typeof maybeReady === "function" ? maybeReady() : startPromise;
	context.subscriptions.push({
		dispose: () => {
			void client?.stop();
		},
	});

	// Listen for diagnostic count notifications from server
	void clientReady.then(() => {
		client?.onNotification('tsqllint/diagnosticsCount', (params: {
			uri: string;
			errorCount: number;
			warningCount: number;
		}) => {
			updateStatusBar(params.uri, params.errorCount, params.warningCount);
		});
	});

	const lintCommand = vscode.commands.registerCommand(
		"tsqllint-lite.run",
		async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			if (clientReady) {
				await clientReady;
			}
			await client?.sendRequest("tsqllint/lintDocument", {
				uri: activeEditor.document.uri.toString(),
			});
		},
	);
	context.subscriptions.push(lintCommand);
	const fixCommand = vscode.commands.registerCommand(
		"tsqllint-lite.fix",
		async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			if (clientReady) {
				await clientReady;
			}
			await client?.sendRequest("tsqllint/fixDocument", {
				uri: activeEditor.document.uri.toString(),
			});
		},
	);
	context.subscriptions.push(fixCommand);

	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles(async (event) => {
			if (!client) {
				return;
			}
			if (clientReady) {
				await clientReady;
			}
			const uris = event.files.map((file) => file.toString());
			client.sendNotification("tsqllint/clearDiagnostics", { uris });
		}),
		vscode.workspace.onDidRenameFiles(async (event) => {
			if (!client) {
				return;
			}
			if (clientReady) {
				await clientReady;
			}
			const uris = event.files.map((file) => file.oldUri.toString());
			client.sendNotification("tsqllint/clearDiagnostics", { uris });
		}),
	);

	// Update status bar when active editor changes
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			if (!editor || editor.document.languageId !== 'sql') {
				statusBarItem?.hide();
			} else {
				// Status bar will be updated by next diagnostic notification
				// For now, just show a default state
				updateStatusBarForActiveEditor();
			}
		})
	);

	// Initialize status bar for current active editor
	updateStatusBarForActiveEditor();

	return { clientReady };
}

export async function deactivate() {
	if (client) {
		await client.stop();
	}
	clientReady = Promise.resolve();
}

function updateStatusBar(uri: string, errorCount: number, warningCount: number): void {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor || activeEditor.document.uri.toString() !== uri) {
		// Only update status bar for active document
		return;
	}

	if (!statusBarItem) {
		return;
	}

	if (errorCount === 0 && warningCount === 0) {
		statusBarItem.text = "$(check) TSQLLint";
		statusBarItem.tooltip = "No issues found";
		statusBarItem.backgroundColor = undefined;
	} else if (errorCount > 0) {
		if (warningCount > 0) {
			statusBarItem.text = `$(error) TSQLLint: ${errorCount} $(warning) ${warningCount}`;
			statusBarItem.tooltip = `${errorCount} error(s), ${warningCount} warning(s)`;
		} else {
			statusBarItem.text = `$(error) TSQLLint: ${errorCount}`;
			statusBarItem.tooltip = `${errorCount} error(s)`;
		}
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
	} else {
		statusBarItem.text = `$(warning) TSQLLint: ${warningCount}`;
		statusBarItem.tooltip = `${warningCount} warning(s)`;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}

	statusBarItem.show();
}

function updateStatusBarForActiveEditor(): void {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor || activeEditor.document.languageId !== 'sql') {
		statusBarItem?.hide();
		return;
	}

	// Show default state until we get diagnostics
	if (statusBarItem) {
		statusBarItem.text = "$(check) TSQLLint";
		statusBarItem.tooltip = "TSQLLint";
		statusBarItem.backgroundColor = undefined;
		statusBarItem.show();
	}
}
