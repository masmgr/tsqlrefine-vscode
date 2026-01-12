// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { createLanguageClient } from "./client/client";
import type { LanguageClient } from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let clientStart: Promise<void> | undefined;

export function activate(context: vscode.ExtensionContext) {
	client = createLanguageClient(context);
	clientStart = client.start();
	context.subscriptions.push({
		dispose: () => {
			void client?.stop();
		},
	});

	const lintCommand = vscode.commands.registerCommand(
		"tsqllint-lite.run",
		async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			if (clientStart) {
				await clientStart;
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
			if (clientStart) {
				await clientStart;
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
			if (clientStart) {
				await clientStart;
			}
			const uris = event.files.map((file) => file.toString());
			client.sendNotification("tsqllint/clearDiagnostics", { uris });
		}),
		vscode.workspace.onDidRenameFiles(async (event) => {
			if (!client) {
				return;
			}
			if (clientStart) {
				await clientStart;
			}
			const uris = event.files.map((file) => file.oldUri.toString());
			client.sendNotification("tsqllint/clearDiagnostics", { uris });
		}),
	);
}

export async function deactivate() {
	if (client) {
		await client.stop();
	}
}
