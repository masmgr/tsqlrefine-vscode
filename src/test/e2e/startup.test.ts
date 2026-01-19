import * as assert from "node:assert";
import * as vscode from "vscode";
import { cleanupWorkspace, runE2ETest } from "../helpers/e2eTestHarness";
import { FAKE_CLI_RULES, TEST_TIMEOUTS } from "../helpers/testConstants";

suite("Startup Verification Test Suite", () => {
	suiteTeardown(async () => {
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		await cleanupWorkspace(workspaceRoot);
	});

	test("verifies tsqllint installation at startup without crashing", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.FAKE_RULE,
				config: { runOnOpen: false },
				documentContent: "select 1;",
			},
			async (context, _harness) => {
				// Extension activated successfully with fake CLI
				// Verify document was created properly
				assert.ok(context.document);
				assert.strictEqual(context.document.languageId, "sql");

				// No error thrown indicates verification passed
				// and extension activated successfully
				assert.ok(true);
			},
		);
	});

	test("extension remains functional after startup verification", async function () {
		this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

		await runE2ETest(
			{
				fakeCliRule: FAKE_CLI_RULES.MANUAL_RULE,
				config: { runOnSave: false, runOnType: false, runOnOpen: false },
				documentContent: "select 1;",
			},
			async (context, harness) => {
				await vscode.window.showTextDocument(context.document, {
					preview: false,
				});

				// Execute manual lint command to verify extension is functional
				await vscode.commands.executeCommand("tsqllint-lite.run");

				// Wait for diagnostics to verify linting works
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
});
