import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { defaultSettings } from "../../server/config/settings";
import { executeCliEditOperation } from "../../server/shared/cliEditOperation";
import type { DocumentContext } from "../../server/shared/documentContext";
import { DocumentStateManager } from "../../server/state/documentStateManager";
import { NotificationManager } from "../../server/state/notificationManager";

function createHarness(text: string) {
	const warnings: string[] = [];
	const connection = {
		window: {
			showWarningMessage: async (message: string) => {
				warnings.push(message);
			},
		},
		console: {
			debug: () => {},
			log: () => {},
			warn: () => {},
			error: () => {},
		},
	} as unknown as Connection;
	const document = TextDocument.create("untitled:test", "sql", 1, text);
	const context: DocumentContext = {
		uri: document.uri,
		filePath: "",
		workspaceRoot: null,
		cwd: process.cwd(),
		effectiveSettings: defaultSettings,
		effectiveConfigPath: undefined,
		documentText: text,
		isSavedFile: false,
	};
	return { connection, context, document, warnings };
}

suite("executeCliEditOperation", () => {
	test("rejects empty output for a non-empty document", async () => {
		const harness = createHarness("SELECT 1;");
		const result = await executeCliEditOperation(
			harness.context,
			harness.document,
			{
				connection: harness.connection,
				notificationManager: new NotificationManager(harness.connection),
				stateManager: new DocumentStateManager(),
			},
			{
				operationName: "format",
				isEnabled: () => true,
				runner: async () => ({
					stdout: "",
					stderr: "",
					exitCode: 0,
					timedOut: false,
					cancelled: false,
				}),
			},
		);

		assert.strictEqual(result, null);
		assert.ok(harness.warnings[0]?.includes("empty output"));
	});

	test("allows empty output for an empty document", async () => {
		const harness = createHarness("");
		const result = await executeCliEditOperation(
			harness.context,
			harness.document,
			{
				connection: harness.connection,
				notificationManager: new NotificationManager(harness.connection),
				stateManager: new DocumentStateManager(),
			},
			{
				operationName: "fix",
				isEnabled: () => true,
				runner: async () => ({
					stdout: "",
					stderr: "",
					exitCode: 0,
					timedOut: false,
					cancelled: false,
				}),
			},
		);

		assert.deepStrictEqual(result, []);
	});
});
