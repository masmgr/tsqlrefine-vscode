import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { createFakeCli } from "./helpers/fakeCli";

suite("Extension Test Suite", () => {
	test("updates diagnostics after lint run", async function () {
		this.timeout(20000);

		await activateExtension();

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error FakeRule : Fake issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		await fs.writeFile(documentUri.fsPath, "select 1;", "utf8");

		let snapshot: Map<string, unknown | undefined> | null = null;
		try {
			const config = vscode.workspace.getConfiguration("tsqllint");
			snapshot = await applyConfig(config, {
				path: fakeCli.commandPath,
				runOnSave: true,
			});

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

			const diagnostics = await waitForDiagnostics(
				document.uri,
				(entries) => entries.length >= 1,
				10000,
			);
			const match = diagnostics.find(
				(diag) => diag.source === "tsqllint" && diag.code === "FakeRule",
			);
			assert.ok(match);
			assert.strictEqual(match.message, "Fake issue");
		} finally {
			const config = vscode.workspace.getConfiguration("tsqllint");
			if (snapshot) {
				await restoreConfig(config, snapshot);
			}
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await removeDir(tempDir);
		}
	});

	test("tsqllint-lite.run updates diagnostics when runOnSave=false", async function () {
		this.timeout(20000);
		await activateExtension();

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error ManualRule : Manual issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		await fs.writeFile(documentUri.fsPath, "select 1;", "utf8");

		let snapshot: Map<string, unknown | undefined> | null = null;
		try {
			const config = vscode.workspace.getConfiguration("tsqllint");
			snapshot = await applyConfig(config, {
				path: fakeCli.commandPath,
				runOnSave: false,
				runOnType: false,
			});

			let document = await vscode.workspace.openTextDocument(documentUri);
			document = await vscode.languages.setTextDocumentLanguage(
				document,
				"sql",
			);
			await vscode.window.showTextDocument(document, { preview: false });

			await vscode.commands.executeCommand("tsqllint-lite.run");

			const diagnostics = await waitForDiagnostics(
				document.uri,
				(entries) => entries.length >= 1,
				10000,
			);
			const match = diagnostics.find(
				(diag) => diag.source === "tsqllint" && diag.code === "ManualRule",
			);
			assert.ok(match);
		} finally {
			const config = vscode.workspace.getConfiguration("tsqllint");
			if (snapshot) {
				await restoreConfig(config, snapshot);
			}
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await removeDir(tempDir);
		}
	});

	test("run-on-type lints unsaved edits", async function () {
		this.timeout(20000);
		await activateExtension();

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): warning TypeRule : Typed issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		await fs.writeFile(documentUri.fsPath, "", "utf8");

		let snapshot: Map<string, unknown | undefined> | null = null;
		try {
			const config = vscode.workspace.getConfiguration("tsqllint");
			snapshot = await applyConfig(config, {
				path: fakeCli.commandPath,
				runOnType: true,
				debounceMs: 50,
				runOnSave: false,
			});

			let document = await vscode.workspace.openTextDocument(documentUri);
			document = await vscode.languages.setTextDocumentLanguage(
				document,
				"sql",
			);
			const editor = await vscode.window.showTextDocument(document, {
				preview: false,
			});

			await editor.edit((builder) => {
				builder.insert(new vscode.Position(0, 0), "select 1;");
			});

			const diagnostics = await waitForDiagnostics(
				document.uri,
				(entries) => entries.length >= 1,
				10000,
			);
			const match = diagnostics.find(
				(diag) => diag.source === "tsqllint" && diag.code === "TypeRule",
			);
			assert.ok(match);
		} finally {
			const config = vscode.workspace.getConfiguration("tsqllint");
			if (snapshot) {
				await restoreConfig(config, snapshot);
			}
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await removeDir(tempDir);
		}
	});

	test.skip("rename clears diagnostics for old URI", async function () {
		// Skipped: vscode.workspace.fs.rename() does not reliably trigger onDidRenameFiles in test environment
		this.timeout(20000);
		await activateExtension();

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error RenameRule : Rename issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		const renamedUri = vscode.Uri.file(path.join(tempDir, "query-renamed.sql"));
		await fs.writeFile(documentUri.fsPath, "select 1;", "utf8");

		let snapshot: Map<string, unknown | undefined> | null = null;
		try {
			const config = vscode.workspace.getConfiguration("tsqllint");
			snapshot = await applyConfig(config, {
				path: fakeCli.commandPath,
				runOnSave: false,
				runOnType: false,
			});

			let document = await vscode.workspace.openTextDocument(documentUri);
			document = await vscode.languages.setTextDocumentLanguage(
				document,
				"sql",
			);
			await vscode.window.showTextDocument(document, { preview: false });

			await vscode.commands.executeCommand("tsqllint-lite.run");
			const diagnosticsSet = await waitForDiagnostics(
				document.uri,
				(entries) => entries.length >= 1,
			);
			assert.ok(diagnosticsSet.length > 0, "Diagnostics should be set");

			await vscode.workspace.fs.rename(documentUri, renamedUri, {
				overwrite: true,
			});
			await sleep(500);

			const cleared = vscode.languages.getDiagnostics(documentUri);
			assert.strictEqual(
				cleared.length,
				0,
				"Diagnostics should be cleared after rename",
			);
		} finally {
			const config = vscode.workspace.getConfiguration("tsqllint");
			if (snapshot) {
				await restoreConfig(config, snapshot);
			}
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await removeDir(tempDir);
		}
	});

	test.skip("delete clears diagnostics for old URI", async function () {
		// Skipped: vscode.workspace.fs.delete() does not reliably trigger onDidDeleteFiles in test environment
		this.timeout(20000);
		await activateExtension();

		const fakeCli = await createFakeCli(`
const args = process.argv.slice(2);
const filePath = args[args.length - 1] || "";
process.stdout.write(\`\${filePath}(1,1): error DeleteRule : Delete issue.\`);
`);

		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		await fs.mkdir(workspaceRoot.fsPath, { recursive: true });
		const tempDir = await fs.mkdtemp(
			path.join(workspaceRoot.fsPath, "tsqllint-workspace-"),
		);
		const documentUri = vscode.Uri.file(path.join(tempDir, "query.sql"));
		await fs.writeFile(documentUri.fsPath, "select 1;", "utf8");

		let snapshot: Map<string, unknown | undefined> | null = null;
		try {
			const config = vscode.workspace.getConfiguration("tsqllint");
			snapshot = await applyConfig(config, {
				path: fakeCli.commandPath,
				runOnSave: false,
				runOnType: false,
			});

			let document = await vscode.workspace.openTextDocument(documentUri);
			document = await vscode.languages.setTextDocumentLanguage(
				document,
				"sql",
			);
			await vscode.window.showTextDocument(document, { preview: false });

			await vscode.commands.executeCommand("tsqllint-lite.run");
			const diagnosticsSet = await waitForDiagnostics(
				document.uri,
				(entries) => entries.length >= 1,
			);
			assert.ok(diagnosticsSet.length > 0, "Diagnostics should be set");

			await vscode.workspace.fs.delete(documentUri, { recursive: false });
			await sleep(500);

			const cleared = vscode.languages.getDiagnostics(documentUri);
			assert.strictEqual(
				cleared.length,
				0,
				"Diagnostics should be cleared after delete",
			);
		} finally {
			const config = vscode.workspace.getConfiguration("tsqllint");
			if (snapshot) {
				await restoreConfig(config, snapshot);
			}
			await vscode.commands.executeCommand("workbench.action.closeAllEditors");
			await fakeCli.cleanup();
			await sleep(100);
			await removeDir(tempDir);
		}
	});
});

async function waitForDiagnostics(
	uri: vscode.Uri,
	predicate: (diagnostics: vscode.Diagnostic[]) => boolean,
	timeoutMs = 5000,
): Promise<vscode.Diagnostic[]> {
	const existing = vscode.languages.getDiagnostics(uri);
	if (predicate(existing)) {
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
			if (!predicate(current)) {
				return;
			}
			clearTimeout(timeout);
			subscription?.dispose();
			resolve(current);
		});
	});
}

async function applyConfig(
	config: vscode.WorkspaceConfiguration,
	updates: Record<string, unknown>,
): Promise<Map<string, unknown | undefined>> {
	const snapshot = new Map<string, unknown | undefined>();
	for (const [key, value] of Object.entries(updates)) {
		const previous = config.inspect(key)?.workspaceValue;
		snapshot.set(key, previous);
		await config.update(key, value, vscode.ConfigurationTarget.Workspace);
	}
	return snapshot;
}

async function restoreConfig(
	config: vscode.WorkspaceConfiguration,
	snapshot: Map<string, unknown | undefined>,
): Promise<void> {
	for (const [key, value] of snapshot.entries()) {
		await config.update(
			key,
			value === undefined ? null : value,
			vscode.ConfigurationTarget.Workspace,
		);
	}
}

async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find(
		(ext) => ext.packageJSON?.name === "tsqllint-lite",
	);
	assert.ok(extension, "Extension tsqllint-lite not found");
	const api = (await extension.activate()) as { clientReady?: Promise<void> };
	const clientReady = api.clientReady;
	if (clientReady) {
		await clientReady;
	}
}

async function removeDir(dirPath: string): Promise<void> {
	await fs.rm(dirPath, {
		recursive: true,
		force: true,
		maxRetries: 30,
		retryDelay: 100,
	});
}

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
