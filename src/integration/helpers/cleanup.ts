/**
 * Cleanup utilities for VS Code integration tests.
 * Re-exports unit test utilities and adds VS Code-specific functionality.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

// Re-export unit test utilities (VS Code-free)
export {
	rmWithRetry,
	removeDirectory,
	sleep,
	type RemovalOptions,
} from "../../test/helpers/unit/cleanup.unit";

/**
 * Cleans up VS Code workspace test artifacts.
 * Removes .vscode directory and tsqllint-workspace-* temporary directories.
 *
 * @param workspaceRoot - The workspace root URI, or undefined if no workspace
 * @param options - Cleanup options
 */
export async function cleanupWorkspace(
	workspaceRoot: vscode.Uri | undefined,
	options: { throwOnFailure?: boolean } = {},
): Promise<void> {
	if (!workspaceRoot) {
		return;
	}

	const workspacePath = workspaceRoot.fsPath;

	// Clean up .vscode directory
	const vscodeDir = vscode.Uri.joinPath(workspaceRoot, ".vscode");
	try {
		await vscode.workspace.fs.delete(vscodeDir, { recursive: true });
	} catch {
		// Ignore errors if directory doesn't exist
	}

	// Clean up any remaining tsqllint-workspace-* directories
	try {
		const entries = await fs.readdir(workspacePath);
		for (const entry of entries) {
			if (entry.startsWith("tsqllint-workspace-")) {
				const fullPath = path.join(workspacePath, entry);
				try {
					await fs.rm(fullPath, { recursive: true, force: true });
				} catch (error) {
					if (options.throwOnFailure) {
						throw error;
					}
					console.error(`Failed to remove ${fullPath}:`, error);
				}
			}
		}
	} catch {
		// Ignore errors if workspace root doesn't exist
	}
}
