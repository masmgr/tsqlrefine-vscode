import * as assert from "node:assert";
import * as vscode from "vscode";
import { cleanupWorkspace, runE2ETest } from "../helpers/e2eTestHarness";
import {
	FAKE_CLI_RULES,
	TEST_DELAYS,
	TEST_TIMEOUTS,
} from "../helpers/testConstants";

suite("Extension Test Suite", () => {
	suiteTeardown(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		await cleanupWorkspace(workspaceRoot);
	});

	test("updates diagnostics after lint run", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.FAKE_RULE,
				fakeCliSeverity: "error",
				config: { runOnSave: true },
				documentContent: "select 1;",
			},
			async (context, harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});
				await editor.edit((builder) => {
					builder.insert(new vscode.Position(0, 0), "-- test\n");
				});
				await context.document.save();

				const diagnostics = await harness.waitForDiagnostics(
					context.document.uri,
					(entries) => entries.length >= 1,
				);
				const match = diagnostics.find(
					(diag) =>
						diag.source === "tsqllint" &&
						diag.code === FAKE_CLI_RULES.FAKE_RULE,
				);
				assert.ok(match);
				assert.strictEqual(match.message, "Fake issue");
			},
		);
	});

	test("tsqllint-lite.run updates diagnostics when runOnSave=false", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.MANUAL_RULE,
				fakeCliSeverity: "error",
				config: { runOnSave: false, runOnType: false },
				documentContent: "select 1;",
			},
			async (context, harness) => {
				await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				await vscode.commands.executeCommand("tsqllint-lite.run");

				const diagnostics = await harness.waitForDiagnostics(
					context.document.uri,
					(entries) => entries.length >= 1,
				);
				const match = diagnostics.find(
					(diag) =>
						diag.source === "tsqllint" &&
						diag.code === FAKE_CLI_RULES.MANUAL_RULE,
				);
				assert.ok(match);
			},
		);
	});

	test("run-on-type lints unsaved edits", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.TYPE_RULE,
				fakeCliSeverity: "warning",
				config: {
					runOnType: true,
					debounceMs: TEST_DELAYS.DEBOUNCE_SHORT,
					runOnSave: false,
				},
				documentContent: "",
			},
			async (context, harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				await editor.edit((builder) => {
					builder.insert(new vscode.Position(0, 0), "select 1;");
				});

				const diagnostics = await harness.waitForDiagnostics(
					context.document.uri,
					(entries) => entries.length >= 1,
				);
				const match = diagnostics.find(
					(diag) =>
						diag.source === "tsqllint" &&
						diag.code === FAKE_CLI_RULES.TYPE_RULE,
				);
				assert.ok(match);
			},
		);
	});

	test("runOnOpen lints when document is opened", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.OPEN_RULE,
				fakeCliSeverity: "error",
				config: {
					runOnOpen: true,
					runOnSave: false,
					runOnType: false,
				},
				documentContent: "select 1;",
			},
			async (context, harness) => {
				// Create a new SQL document after config is applied
				// This ensures runOnOpen triggers on the open event
				const newUri = vscode.Uri.joinPath(
					context.workspaceRoot,
					"test_open_2.sql",
				);
				await vscode.workspace.fs.writeFile(
					newUri,
					new TextEncoder().encode("select 2;"),
				);
				const newDocument = await vscode.workspace.openTextDocument(newUri);
				await vscode.languages.setTextDocumentLanguage(newDocument, "sql");

				const diagnostics = await harness.waitForDiagnostics(
					newDocument.uri,
					(entries) => entries.length >= 1,
				);
				const match = diagnostics.find(
					(diag) =>
						diag.source === "tsqllint" &&
						diag.code === FAKE_CLI_RULES.OPEN_RULE,
				);
				assert.ok(match);

				// Clean up
				await vscode.commands.executeCommand(
					"workbench.action.closeAllEditors",
				);
			},
		);
	});

	test("runOnOpen=false does not lint on open", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.OPEN_RULE,
				config: {
					runOnOpen: false,
					runOnSave: false,
					runOnType: false,
				},
				documentContent: "select 1;",
			},
			async (context, _harness) => {
				// Wait a short time to ensure no linting happens
				await new Promise((resolve) =>
					setTimeout(resolve, TEST_DELAYS.DEBOUNCE_SHORT * 2),
				);

				const diagnostics = vscode.languages.getDiagnostics(
					context.document.uri,
				);
				assert.strictEqual(
					diagnostics.length,
					0,
					"No diagnostics should appear when runOnOpen is disabled",
				);
			},
		);
	});

	// Note: File rename/delete event handling is tested in unit tests
	// (handlers.test.ts) which directly test handleDidRenameFiles() and
	// handleDidDeleteFiles() without depending on VS Code file system events.
	// E2E tests for these scenarios are unreliable due to test environment
	// limitations with file watchers.
});
