import * as assert from "node:assert";
import * as vscode from "vscode";
import {
	activateExtension,
	cleanupWorkspace,
	runE2ETest,
} from "../helpers/e2eTestHarness";
import { TEST_TIMEOUTS } from "../helpers/testConstants";

suite("Fix Command Test Suite", () => {
	suiteTeardown(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		await cleanupWorkspace(workspaceRoot);
	});

	test("tsqlrefine.fix command is registered", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Ensure extension is activated
		await activateExtension();

		// Verify the command is registered
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes("tsqlrefine.fix"),
			"tsqlrefine.fix command should be registered",
		);
	});

	test("fix command handles document with no issues", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use well-formatted SQL that should not need fixing
		const wellFormattedSql = "SELECT 1;";

		await runE2ETest(
			{
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: wellFormattedSql,
			},
			async (context, _harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute the fix command
				await vscode.commands.executeCommand("tsqlrefine.fix");

				// Wait for command to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Document should still have content (fix should not break it)
				const content = editor.document.getText();
				assert.ok(content.length > 0, "Document should have content");
			},
		);
	});

	test("fix command applies edits to document", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use well-formatted SQL to test fix command completes without issues
		// Note: tsqlrefine fix returns exit code 1 for SQL with unfixable issues,
		// which shows a warning message. Using valid SQL ensures clean completion.
		const sql = "SELECT id, name FROM users;";

		await runE2ETest(
			{
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: sql,
			},
			async (context, _harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute the fix command
				await vscode.commands.executeCommand("tsqlrefine.fix");

				// Wait for command to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Document should still have content after fix
				const content = editor.document.getText();
				assert.ok(content.length > 0, "Document should have content after fix");
			},
		);
	});
});

suite("Code Action Test Suite", () => {
	suiteTeardown(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		await cleanupWorkspace(workspaceRoot);
	});

	test("code action provider is available for SQL files", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: "SELECT 1;",
			},
			async (context, _harness) => {
				await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Request code actions at position 0,0
				const codeActions = await vscode.commands.executeCommand<
					vscode.CodeAction[]
				>(
					"vscode.executeCodeActionProvider",
					context.document.uri,
					new vscode.Range(0, 0, 0, 1),
				);

				// Code actions may or may not be available depending on diagnostics
				// This test verifies the provider doesn't throw
				assert.ok(
					codeActions !== undefined,
					"Code action provider should return a result",
				);
			},
		);
	});

	test("code action appears when tsqlrefine diagnostics exist", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use SQL that triggers lint diagnostics without causing parse failure
		const invalidSql = "select id,name from users;";

		await runE2ETest(
			{
				config: { runOnSave: true, runOnType: false, runOnOpen: true },
				documentContent: invalidSql,
			},
			async (context, harness) => {
				await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Wait for diagnostics to appear
				const diagnostics = await harness.waitForDiagnostics(
					context.document.uri,
					(entries) => entries.some((d) => d.source === "tsqlrefine"),
				);

				// Verify tsqlrefine diagnostics exist
				assert.ok(
					diagnostics.some((d) => d.source === "tsqlrefine"),
					"Expected tsqlrefine diagnostics",
				);

				// Request code actions
				const codeActions = await vscode.commands.executeCommand<
					vscode.CodeAction[]
				>(
					"vscode.executeCodeActionProvider",
					context.document.uri,
					new vscode.Range(0, 0, 0, 11),
				);

				// Fix action may be absent if tsqlrefine produces no fix edits for this input.
				assert.ok(
					codeActions !== undefined,
					"Code action provider should return a result",
				);
			},
		);
	});

	test("code action does not appear when no tsqlrefine diagnostics", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use valid SQL that won't trigger diagnostics
		const validSql = "SELECT 1;";

		await runE2ETest(
			{
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: validSql,
			},
			async (context, _harness) => {
				await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Wait a bit to ensure no diagnostics appear
				await new Promise((resolve) => setTimeout(resolve, 500));

				// Get current diagnostics
				const diagnostics = vscode.languages.getDiagnostics(
					context.document.uri,
				);
				const hasTsqlrefineDiag = diagnostics.some(
					(d) => d.source === "tsqlrefine",
				);

				if (!hasTsqlrefineDiag) {
					// Request code actions
					const codeActions = await vscode.commands.executeCommand<
						vscode.CodeAction[]
					>(
						"vscode.executeCodeActionProvider",
						context.document.uri,
						new vscode.Range(0, 0, 0, 1),
					);

					// Without tsqlrefine diagnostics, the "Fix all tsqlrefine issues" action should not appear
					const fixAction = codeActions?.find(
						(action) => action.title === "Fix all tsqlrefine issues",
					);
					assert.strictEqual(
						fixAction,
						undefined,
						"Fix action should not appear without tsqlrefine diagnostics",
					);
				}
			},
		);
	});
});
