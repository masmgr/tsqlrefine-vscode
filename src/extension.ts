// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { createLanguageClient } from "./client/client";
import { handleDidDeleteFiles, handleDidRenameFiles } from "./client/handlers";
import { StatusBarManager } from "./client/statusBar";

let client: LanguageClient | undefined;
export let clientReady: Promise<void> = Promise.resolve();

export type TsqlRefineLiteApi = {
	clientReady: Promise<void>;
};

const installGuideUrl =
	"https://github.com/masmgr/tsqlrefine-vscode#installing-tsqlrefine";

export function activate(context: vscode.ExtensionContext): TsqlRefineLiteApi {
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

	// Status bar integration
	const statusBarManager = new StatusBarManager();
	statusBarManager.initialize(context);

	const config = vscode.workspace.getConfiguration("tsqlrefine");
	statusBarManager.setDisabled(!config.get<boolean>("enableLint", true));

	client.onNotification(
		"tsqlrefine/operationState",
		(params: { state: "started" | "completed" }) => {
			statusBarManager.setOperationState(params.state);
		},
	);

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(() => {
			statusBarManager.updateDiagnostics();
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("tsqlrefine.enableLint")) {
				const updated = vscode.workspace.getConfiguration("tsqlrefine");
				statusBarManager.setDisabled(!updated.get<boolean>("enableLint", true));
			}
		}),
	);

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
			try {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					return;
				}
				await clientReady;
				if (!client) {
					console.error("tsqlrefine: Language client is not initialized");
					return;
				}
				await client.sendRequest("tsqlrefine/lintDocument", {
					uri: activeEditor.document.uri.toString(),
				});
			} catch (error) {
				console.error("tsqlrefine: lint command failed", error);
				void vscode.window.showErrorMessage(
					`TSQLRefine lint failed: ${String(error)}`,
				);
			}
		},
	);
	context.subscriptions.push(lintCommand);

	const formatCommand = vscode.commands.registerCommand(
		"tsqlrefine.format",
		async () => {
			try {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					return;
				}
				await clientReady;
				if (!client) {
					console.error("tsqlrefine: Language client is not initialized");
					return;
				}
				const result = await client.sendRequest<{
					ok: boolean;
					error?: string;
				}>("tsqlrefine/formatDocument", {
					uri: activeEditor.document.uri.toString(),
				});
				if (!result.ok) {
					throw new Error(result.error ?? "Format failed");
				}
			} catch (error) {
				console.error("tsqlrefine: format command failed", error);
				void vscode.window.showErrorMessage(
					`TSQLRefine format failed: ${String(error)}`,
				);
			}
		},
	);
	context.subscriptions.push(formatCommand);

	const fixCommand = vscode.commands.registerCommand(
		"tsqlrefine.fix",
		async () => {
			try {
				const activeEditor = vscode.window.activeTextEditor;
				if (!activeEditor) {
					return;
				}
				await clientReady;
				if (!client) {
					console.error("tsqlrefine: Language client is not initialized");
					return;
				}
				await client.sendRequest("tsqlrefine/fixDocument", {
					uri: activeEditor.document.uri.toString(),
				});
			} catch (error) {
				console.error("tsqlrefine: fix command failed", error);
				void vscode.window.showErrorMessage(
					`TSQLRefine fix failed: ${String(error)}`,
				);
			}
		},
	);
	context.subscriptions.push(fixCommand);

	const LANGUAGE_IDS = ["sql", "tsql", "mssql"] as const;
	const EXTENSION_ID = "masmgr.tsqlrefine";

	const setAsDefaultFormatterCommand = vscode.commands.registerCommand(
		"tsqlrefine.setAsDefaultFormatter",
		async () => {
			try {
				// Workspace settings override other extensions' configurationDefaults
				// (e.g. mssql); fall back to user settings when no workspace is open.
				const hasWorkspace =
					(vscode.workspace.workspaceFolders?.length ?? 0) > 0;
				const target = hasWorkspace
					? vscode.ConfigurationTarget.Workspace
					: vscode.ConfigurationTarget.Global;
				for (const languageId of LANGUAGE_IDS) {
					const config = vscode.workspace.getConfiguration("editor", {
						languageId,
					});
					await config.update("defaultFormatter", EXTENSION_ID, target, true);
				}
				await vscode.window.showInformationMessage(
					hasWorkspace
						? "TSQLRefine is now the default SQL formatter for this workspace."
						: "TSQLRefine is now the default SQL formatter in your user settings.",
				);
			} catch (error) {
				console.error("tsqlrefine: setAsDefaultFormatter failed", error);
				void vscode.window.showErrorMessage(
					`TSQLRefine: failed to set default formatter: ${String(error)}`,
				);
			}
		},
	);
	context.subscriptions.push(setAsDefaultFormatterCommand);

	void maybeSuggestDefaultFormatter(context);

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

const CONFLICTING_FORMATTER_EXTENSIONS = ["ms-mssql.mssql"] as const;
const SUPPRESS_FORMATTER_SUGGESTION_KEY =
	"tsqlrefine.suppressDefaultFormatterSuggestion";

async function maybeSuggestDefaultFormatter(
	context: vscode.ExtensionContext,
): Promise<void> {
	try {
		if (context.globalState.get<boolean>(SUPPRESS_FORMATTER_SUGGESTION_KEY)) {
			return;
		}
		const conflicting = CONFLICTING_FORMATTER_EXTENSIONS.filter((id) =>
			vscode.extensions.getExtension(id),
		);
		if (conflicting.length === 0) {
			return;
		}
		const config = vscode.workspace.getConfiguration("editor", {
			languageId: "sql",
		});
		if (config.get<string>("defaultFormatter")) {
			// The user (or another extension's defaults) already picked one.
			return;
		}
		const setAsDefault = "Set as Default";
		const dontAskAgain = "Don't Ask Again";
		const choice = await vscode.window.showInformationMessage(
			"Multiple SQL formatters are installed. Set TSQLRefine as the default formatter for SQL files?",
			setAsDefault,
			dontAskAgain,
		);
		if (choice === setAsDefault) {
			await vscode.commands.executeCommand("tsqlrefine.setAsDefaultFormatter");
		} else if (choice === dontAskAgain) {
			await context.globalState.update(SUPPRESS_FORMATTER_SUGGESTION_KEY, true);
		}
	} catch (error) {
		console.error("tsqlrefine: default formatter suggestion failed", error);
	}
}

export async function deactivate() {
	if (client) {
		await client.stop();
	}
	clientReady = Promise.resolve();
}
