/**
 * Test fixtures and factories for creating test data.
 * Eliminates duplication by providing reusable test setup utilities.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { createFakeCli, type FakeCli } from "./fakeCli";

/**
 * Creates a standard fake CLI that outputs a diagnostic for the linted file.
 *
 * @param ruleName - The rule name to include in the diagnostic
 * @param severity - The severity level (default: "error")
 * @param message - Custom message (default: derived from ruleName)
 * @returns FakeCli instance with cleanup method
 *
 * @example
 * const cli = await createStandardFakeCli('MyRule', 'warning', 'My custom message');
 */
export async function createStandardFakeCli(
	ruleName: string,
	severity: "error" | "warning" = "error",
	message?: string,
): Promise<FakeCli> {
	const msg = message ?? `${ruleName.replace("Rule", "")} issue`;
	const scriptBody = `
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): ${severity} ${ruleName} : ${msg}.\`);
`;
	return createFakeCli(scriptBody);
}

/**
 * Creates a fake CLI with custom script body.
 * Use this for non-standard test cases that need specific behavior.
 *
 * @param scriptBody - JavaScript code to execute in the fake CLI
 * @returns FakeCli instance with cleanup method
 *
 * @example
 * const cli = await createCustomFakeCli('process.stdout.write("custom output");');
 */
export async function createCustomFakeCli(
	scriptBody: string,
): Promise<FakeCli> {
	return createFakeCli(scriptBody);
}

/**
 * Creates a fake CLI that times out after the specified delay.
 * Useful for testing timeout handling.
 *
 * @param delayMs - Milliseconds to delay before producing output
 * @returns FakeCli instance with cleanup method
 *
 * @example
 * const cli = await createTimeoutFakeCli(2000);
 */
export async function createTimeoutFakeCli(delayMs: number): Promise<FakeCli> {
	const scriptBody = `
setTimeout(() => {
	process.stdout.write("late output");
}, ${delayMs});
`;
	return createFakeCli(scriptBody);
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
		path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
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
 * const snapshot = await applyTestConfig({ 'tsqllint.runOnSave': true });
 * // ... run tests ...
 * await restoreTestConfig(snapshot);
 */
export async function applyTestConfig(
	updates: Record<string, unknown>,
): Promise<Map<string, unknown | undefined>> {
	const config = vscode.workspace.getConfiguration("tsqllint");
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
 * const snapshot = await applyTestConfig({ 'tsqllint.runOnSave': true });
 * // ... run tests ...
 * await restoreTestConfig(snapshot);
 */
export async function restoreTestConfig(
	snapshot: Map<string, unknown | undefined>,
): Promise<void> {
	const config = vscode.workspace.getConfiguration("tsqllint");

	for (const [key, value] of snapshot.entries()) {
		// VS Code requires null (not undefined) to clear workspace-level settings
		await config.update(
			key,
			value === undefined ? null : value,
			vscode.ConfigurationTarget.Workspace,
		);
	}
}
