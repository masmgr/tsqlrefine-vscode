import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { createFakeCli } from "./helpers/fakeCli";

suite("Extension Test Suite", () => {
	test.skip("updates diagnostics after lint run", async function () {
		this.timeout(20000);
		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error FakeRule : Fake issue.\`);
`);
		const tempDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "tsqllint-workspace-"),
		);
		const filePath = path.join(tempDir, "query.sql");
		await fs.writeFile(filePath, "select 1;", "utf8");
		const documentUri = vscode.Uri.file(filePath);

		const config = vscode.workspace.getConfiguration("tsqllint");
		const previousPath = config.inspect<string>("path")?.workspaceValue;
		const previousRunOnSave =
			config.inspect<boolean>("runOnSave")?.workspaceValue;
		const previousFixOnSave =
			config.inspect<boolean>("fixOnSave")?.workspaceValue;

		try {
			await config.update(
				"path",
				fakeCli.commandPath,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"runOnSave",
				true,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"fixOnSave",
				false,
				vscode.ConfigurationTarget.Workspace,
			);
			await sleep(100);

			const document = await vscode.workspace.openTextDocument(documentUri);
			await vscode.languages.setTextDocumentLanguage(document, "sql");
			await vscode.window.showTextDocument(document);
			await document.save();

			const diagnostics = await waitForDiagnostics(document.uri, 1);
			const match = diagnostics.find(
				(diag) => diag.source === "tsqllint" && diag.code === "FakeRule",
			);
			assert.ok(match);
			assert.strictEqual(match.message, "Fake issue");
		} finally {
			await config.update(
				"path",
				previousPath,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"runOnSave",
				previousRunOnSave,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"fixOnSave",
				previousFixOnSave,
				vscode.ConfigurationTarget.Workspace,
			);
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await fs.rm(tempDir, {
				recursive: true,
				force: true,
				maxRetries: 30,
				retryDelay: 100,
			});
		}
	});
});

async function waitForDiagnostics(
	uri: vscode.Uri,
	expectedCount: number,
	timeoutMs = 5000,
): Promise<vscode.Diagnostic[]> {
	const existing = vscode.languages.getDiagnostics(uri);
	if (existing.length >= expectedCount) {
		return existing;
	}

	return await new Promise((resolve) => {
		let subscription: vscode.Disposable | null = null;
		const timeout = setTimeout(() => {
			subscription?.dispose();
			resolve(vscode.languages.getDiagnostics(uri));
		}, timeoutMs);

		subscription = vscode.languages.onDidChangeDiagnostics((event) => {
			if (
				!event.uris.some((changed) => changed.toString() === uri.toString())
			) {
				return;
			}
			const current = vscode.languages.getDiagnostics(uri);
			if (current.length < expectedCount) {
				return;
			}
			clearTimeout(timeout);
			subscription?.dispose();
			resolve(current);
		});
	});
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
