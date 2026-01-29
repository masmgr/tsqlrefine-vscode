// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { createLanguageClient } from "./client/client";
import { handleDidDeleteFiles, handleDidRenameFiles } from "./client/handlers";

let client: LanguageClient | undefined;
export let clientReady: Promise<void> = Promise.resolve();

export type TsqllintLiteApi = {
	clientReady: Promise<void>;
};

const installGuideUrl =
	"https://github.com/masmgr/tsqllint-vscode-lite#installing-tsqlrefine";

export function activate(context: vscode.ExtensionContext): TsqllintLiteApi {
	client = createLanguageClient(context);

	const openInstallGuideCommand = vscode.commands.registerCommand(
		"tsqlrefine.openInstallGuide",
		async () => {
			await vscode.env.openExternal(vscode.Uri.parse(installGuideUrl));
		},
	);
	context.subscriptions.push(openInstallGuideCommand);

	client.onNotification("tsqlrefine/openInstallGuide", () => {
		void vscode.commands.executeCommand("tsqlrefine.openInstallGuide");
	});

	const startPromise = client.start();
	const maybeReady = (client as { onReady?: () => Promise<void> }).onReady;
	clientReady = typeof maybeReady === "function" ? maybeReady() : startPromise;
	context.subscriptions.push({
		dispose: () => {
			void client?.stop();
		},
	});

	const lintCommand = vscode.commands.registerCommand(
		"tsqlrefine.run",
		async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (!activeEditor) {
				return;
			}
			if (clientReady) {
				await clientReady;
			}
			await client?.sendRequest("tsqlrefine/lintDocument", {
				uri: activeEditor.document.uri.toString(),
			});
		},
	);
	context.subscriptions.push(lintCommand);

	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles(async (event) => {
			await handleDidDeleteFiles(event, client, clientReady);
		}),
		vscode.workspace.onDidRenameFiles(async (event) => {
			await handleDidRenameFiles(event, client, clientReady);
		}),
	);

	return { clientReady };
}

export async function deactivate() {
	if (client) {
		await client.stop();
	}
	clientReady = Promise.resolve();
}
