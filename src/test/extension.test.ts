import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { createFakeCli } from "./helpers/fakeCli";

suite("Extension Test Suite", () => {
	test("updates diagnostics after lint run", async function () {
		this.timeout(20000);

		const extension = vscode.extensions.all.find(
			(ext) => ext.packageJSON?.name === "tsqllint-lite",
		);
		assert.ok(extension, "Extension tsqllint-lite not found");
		const api = (await extension.activate()) as { clientReady?: Promise<void> };
		const clientReady = api.clientReady;
		if (clientReady) {
			await clientReady;
		}

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error FakeRule : Fake issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		await fs.writeFile(documentUri.fsPath, "select 1;", "utf8");

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

			let document = await vscode.workspace.openTextDocument(documentUri);
			document = await vscode.languages.setTextDocumentLanguage(
				document,
				"sql",
			);
			const editor = await vscode.window.showTextDocument(document, {
				preview: false,
			});
			await editor.edit((builder) => {
				builder.insert(new vscode.Position(0, 0), "-- test\n");
			});
			await document.save();

			const diagnostics = await waitForDiagnostics(document.uri, 1, 10000);
			const match = diagnostics.find(
				(diag) => diag.source === "tsqllint" && diag.code === "FakeRule",
			);
			assert.ok(match);
			assert.strictEqual(match.message, "Fake issue");
		} finally {
			await config.update(
				"path",
				previousPath ?? null,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"runOnSave",
				previousRunOnSave ?? null,
				vscode.ConfigurationTarget.Workspace,
			);
			await config.update(
				"fixOnSave",
				previousFixOnSave ?? null,
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
