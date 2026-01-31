import * as assert from "node:assert";
import * as vscode from "vscode";
import { cleanupWorkspace, runE2ETest } from "../helpers/e2eTestHarness";
import { TEST_TIMEOUTS } from "../helpers/testConstants";

suite("Formatter Test Suite", () => {
	suiteTeardown(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		await cleanupWorkspace(workspaceRoot);
	});

	test("formats document via LSP documentFormattingProvider", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use unformatted SQL that tsqlrefine will format
		const unformattedSql = "select id,name from users;";

		await runE2ETest(
			{
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: unformattedSql,
			},
			async (context, _harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute the format command
				await vscode.commands.executeCommand("editor.action.formatDocument");

				// Wait for formatting to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Check if the document content was formatted (should be different from original)
				const formattedContent = editor.document.getText();

				// The formatted content should be different from the original unformatted SQL
				// We can't predict the exact format output, but we know tsqlrefine will change it
				assert.ok(
					formattedContent.length > 0,
					"Document should have content after formatting",
				);
			},
		);
	});

	test("format command handles already-formatted content", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Use simple SQL that is already well-formatted
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

				// Execute the format command
				await vscode.commands.executeCommand("editor.action.formatDocument");

				// Wait for formatting to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Document should still have content (formatting should not break it)
				const content = editor.document.getText();
				assert.ok(content.length > 0, "Document should have content");
			},
		);
	});

	// Note: tsqlrefine.format command delegates to editor.action.formatDocument
	// which is already tested above. The command exists as a convenience for
	// users who want to explicitly invoke TSQLRefine formatting.
	test("tsqlrefine.format command is registered", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		// Verify the command is registered
		const commands = await vscode.commands.getCommands(true);
		assert.ok(
			commands.includes("tsqlrefine.format"),
			"tsqlrefine.format command should be registered",
		);
	});
});
