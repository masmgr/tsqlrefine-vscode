/**
 * Test fixtures and factories for creating test data.
 * Eliminates duplication by providing reusable test setup utilities.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

/**
 * Locates the tsqlrefine executable in the system PATH.
 *
 * @returns Path to tsqlrefine executable, or null if not found
 */
export async function locateTsqlrefine(): Promise<string | null> {
	const command = process.platform === "win32" ? "where.exe" : "which";
	const args = ["tsqlrefine"];
	const result = await runCommand(command, args, 3000);
	if (result.exitCode !== 0) {
		return null;
	}
	const first = result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0);
	return first ?? null;
}

async function runCommand(
	command: string,
	args: string[],
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
	return await new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timer: NodeJS.Timeout | null = setTimeout(() => {
			timer = null;
			child.kill();
			resolve({ stdout, stderr, exitCode: null });
		}, timeoutMs);

		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (data: string) => {
			stdout += data;
		});
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (data: string) => {
			stderr += data;
		});
		child.on("error", () => {
			if (timer) {
				clearTimeout(timer);
			}
			resolve({ stdout, stderr, exitCode: 1 });
		});
		child.on("close", (exitCode) => {
			if (timer) {
				clearTimeout(timer);
			}
			resolve({ stdout, stderr, exitCode });
		});
	});
}

/**
 * Creates a temporary workspace directory for testing.
 *
 * @param workspaceRoot - The workspace root URI
 * @returns Object with tempDir path and helper to create files
 *
 * @example
 * const { tempDir, createFile } = await createTestWorkspace(workspaceRoot);
 * const fileUri = await createFile('test.sql', 'SELECT 1');
 */
export async function createTestWorkspace(workspaceRoot: vscode.Uri): Promise<{
	tempDir: string;
	createFile: (filename: string, content: string) => Promise<vscode.Uri>;
}> {
	await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
	const tempDir = await fs.mkdtemp(
		path.join(workspaceRoot.fsPath, "tsqlrefine-workspace-"),
	);

	const createFile = async (
		filename: string,
		content: string,
	): Promise<vscode.Uri> => {
		const filePath = path.join(tempDir, filename);
		await fs.writeFile(filePath, content, "utf8");
		return vscode.Uri.file(filePath);
	};

	return { tempDir, createFile };
}

/**
 * Creates a SQL document in the workspace.
 *
 * @param uri - The URI where the document should be created
 * @param content - The content of the SQL file
 * @returns The opened TextDocument
 *
 * @example
 * const doc = await createSqlDocument(uri, 'SELECT * FROM users');
 */
export async function createSqlDocument(
	uri: vscode.Uri,
	content: string,
): Promise<vscode.TextDocument> {
	await fs.writeFile(uri.fsPath, content, "utf8");
	let document = await vscode.workspace.openTextDocument(uri);
	document = await vscode.languages.setTextDocumentLanguage(document, "sql");
	return document;
}

/**
 * Applies VS Code configuration updates and returns a snapshot for restoration.
 *
 * @param updates - Configuration key-value pairs to update
 * @returns Map of previous values for restoration
 *
 * @example
 * const snapshot = await applyTestConfig({ 'tsqlrefine.runOnSave': true });
 * // ... run tests ...
 * await restoreTestConfig(snapshot);
 */
export async function applyTestConfig(
	updates: Record<string, unknown>,
): Promise<Map<string, unknown | undefined>> {
	const config = vscode.workspace.getConfiguration("tsqlrefine");
	const snapshot = new Map<string, unknown | undefined>();

	for (const [key, value] of Object.entries(updates)) {
		const previous = config.inspect(key)?.workspaceValue;
		snapshot.set(key, previous);
		await config.update(key, value, vscode.ConfigurationTarget.Workspace);
	}

	return snapshot;
}

/**
 * Restores VS Code configuration from a snapshot.
 *
 * @param snapshot - Map of previous configuration values
 *
 * @example
 * const snapshot = await applyTestConfig({ 'tsqlrefine.runOnSave': true });
 * // ... run tests ...
 * await restoreTestConfig(snapshot);
 */
export async function restoreTestConfig(
	snapshot: Map<string, unknown | undefined>,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("tsqlrefine");

	for (const [key, value] of snapshot.entries()) {
		// VS Code requires null (not undefined) to clear workspace-level settings
		await config.update(
			key,
			value === undefined ? null : value,
			vscode.ConfigurationTarget.Workspace,
		);
	}
}
