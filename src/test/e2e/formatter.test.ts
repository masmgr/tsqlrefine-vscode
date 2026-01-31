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

		// Create a custom fake CLI that outputs formatted SQL
		const formattedSqlLf = "SELECT\n    id,\n    name\nFROM users;";
		const customCliScript = `
const args = process.argv.slice(2);
const isFormatCommand = args.includes('format');

if (isFormatCommand) {
	// For format command, read stdin and output formatted SQL
	let stdinData = '';
	process.stdin.on('data', chunk => { stdinData += chunk; });
	process.stdin.on('end', () => {
		// Output the formatted SQL
		process.stdout.write(${JSON.stringify(formattedSqlLf)});
	});
} else {
	// For lint command, output no diagnostics
	const lastArg = args[args.length - 1] || "";
	if (lastArg === "-") {
		let stdinData = '';
		process.stdin.on('data', chunk => { stdinData += chunk; });
		process.stdin.on('end', () => {
			// No output for lint (no diagnostics)
		});
	}
}
`;

		await runE2ETest(
			{
				customCliScript,
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: "select id,name from users;",
			},
			async (context, _harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute the format command
				await vscode.commands.executeCommand("editor.action.formatDocument");

				// Wait for formatting to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Check if the document content was formatted
				// Normalize line endings for cross-platform comparison
				const formattedContent = editor.document
					.getText()
					.replace(/\r\n/g, "\n");
				assert.strictEqual(
					formattedContent,
					formattedSqlLf,
					"Document should be formatted by tsqlrefine",
				);
			},
		);
	});

	test("format command returns same content when unchanged", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		const originalSql = "SELECT 1;";
		const customCliScript = `
const args = process.argv.slice(2);
const isFormatCommand = args.includes('format');

if (isFormatCommand) {
	// For format command, read stdin and output unchanged SQL
	let stdinData = '';
	process.stdin.on('data', chunk => { stdinData += chunk; });
	process.stdin.on('end', () => {
		// Output the same SQL (no changes)
		process.stdout.write(stdinData);
	});
} else {
	// For lint command
	const lastArg = args[args.length - 1] || "";
	if (lastArg === "-") {
		let stdinData = '';
		process.stdin.on('data', chunk => { stdinData += chunk; });
		process.stdin.on('end', () => {
			// No diagnostics
		});
	}
}
`;

		await runE2ETest(
			{
				customCliScript,
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: originalSql,
			},
			async (context, _harness) => {
				const editor = await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute the format command
				await vscode.commands.executeCommand("editor.action.formatDocument");

				// Wait for formatting to complete
				await new Promise((resolve) => setTimeout(resolve, 1000));

				// Check if the document content remains unchanged
				const content = editor.document.getText();
				assert.strictEqual(
					content,
					originalSql,
					"Document should remain unchanged when formatter returns same content",
				);
			},
		);
	});

	// Note: Parse error handling is tested in unit tests (runFormatter.test.ts).
	// E2E testing of error scenarios is unreliable due to VS Code's async
	// formatting pipeline and timeout constraints.

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
