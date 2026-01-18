import type * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";

/**
 * Handles file deletion events by clearing diagnostics for the deleted files.
 * This is extracted as a testable function separate from the event listener registration.
 *
 * @param event - The file deletion event from VS Code
 * @param client - The language client to send notifications to
 * @param clientReady - Promise that resolves when the client is ready
 */
export async function handleDidDeleteFiles(
	event: vscode.FileDeleteEvent,
	client: LanguageClient | undefined,
	clientReady: Promise<void>,
): Promise<void> {
	if (!client) {
		return;
	}
	if (clientReady) {
		await clientReady;
	}
	const uris = event.files.map((file) => file.toString());
	client.sendNotification("tsqllint/clearDiagnostics", { uris });
}

/**
 * Handles file rename events by clearing diagnostics for the old file paths.
 * This is extracted as a testable function separate from the event listener registration.
 *
 * @param event - The file rename event from VS Code
 * @param client - The language client to send notifications to
 * @param clientReady - Promise that resolves when the client is ready
 */
export async function handleDidRenameFiles(
	event: vscode.FileRenameEvent,
	client: LanguageClient | undefined,
	clientReady: Promise<void>,
): Promise<void> {
	if (!client) {
		return;
	}
	if (clientReady) {
		await clientReady;
	}
	const uris = event.files.map((file) => file.oldUri.toString());
	client.sendNotification("tsqllint/clearDiagnostics", { uris });
}
