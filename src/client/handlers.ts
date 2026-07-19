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
	await clearDiagnostics(
		event.files.map((file) => file.toString()),
		"delete",
		client,
		clientReady,
	);
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
	await clearDiagnostics(
		event.files.map((file) => file.oldUri.toString()),
		"rename",
		client,
		clientReady,
	);
}

async function clearDiagnostics(
	uris: string[],
	eventName: "delete" | "rename",
	client: LanguageClient | undefined,
	clientReady: Promise<void>,
): Promise<void> {
	if (!client) {
		return;
	}
	await clientReady;
	try {
		client.sendNotification("tsqlrefine/clearDiagnostics", { uris });
	} catch (error) {
		console.error(
			`tsqlrefine: failed to send clearDiagnostics on ${eventName}`,
			error,
		);
	}
}
