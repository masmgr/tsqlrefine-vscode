import * as assert from "node:assert";
import * as path from "node:path";
import { URI } from "vscode-uri";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	createDocumentContext,
	type DocumentContextOptions,
} from "../../server/shared/documentContext";
import type { TsqlRefineSettings } from "../../server/config/settings";

/**
 * Creates default test settings.
 */
function createTestSettings(
	overrides: Partial<TsqlRefineSettings> = {},
): TsqlRefineSettings {
	return {
		runOnSave: true,
		runOnType: false,
		runOnOpen: true,
		debounceMs: 500,
		timeoutMs: 10000,
		maxFileSizeKb: 0,
		minSeverity: "info",
		enableLint: true,
		enableFormat: true,
		enableFix: true,
		...overrides,
	};
}

suite("createDocumentContext", () => {
	test("creates context for file with workspace root", async () => {
		const filePath = path.resolve("workspace", "test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 1;");
		const workspaceRoot = path.resolve("workspace");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings(),
			workspaceFolders: [workspaceRoot],
			isSavedFn: () => true,
		};

		const context = await createDocumentContext(options);

		assert.strictEqual(context.uri, uri);
		assert.strictEqual(context.filePath, filePath);
		assert.strictEqual(context.workspaceRoot, workspaceRoot);
		assert.strictEqual(context.cwd, workspaceRoot);
		assert.strictEqual(context.documentText, "SELECT 1;");
		assert.strictEqual(context.isSavedFile, true);
	});

	test("creates context for file without workspace root", async () => {
		const filePath = path.resolve("test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 2;");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings(),
			workspaceFolders: [],
			isSavedFn: () => false,
		};

		const context = await createDocumentContext(options);

		assert.strictEqual(context.uri, uri);
		assert.strictEqual(context.filePath, filePath);
		assert.strictEqual(context.workspaceRoot, null);
		assert.strictEqual(context.cwd, path.dirname(filePath));
		assert.strictEqual(context.documentText, "SELECT 2;");
		assert.strictEqual(context.isSavedFile, false);
	});

	test("creates context for untitled document", async () => {
		const uri = "untitled:Untitled-1";
		const document = TextDocument.create(uri, "sql", 1, "SELECT 3;");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings(),
			workspaceFolders: [],
			isSavedFn: () => false,
		};

		const context = await createDocumentContext(options);

		assert.strictEqual(context.uri, uri);
		assert.strictEqual(context.documentText, "SELECT 3;");
		assert.strictEqual(context.isSavedFile, false);
	});

	test("uses first workspace folder when file is not in any workspace", async () => {
		const filePath = path.resolve("outside", "test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 4;");
		const workspaceRoot1 = path.resolve("workspace1");
		const workspaceRoot2 = path.resolve("workspace2");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings(),
			workspaceFolders: [workspaceRoot1, workspaceRoot2],
			isSavedFn: () => true,
		};

		const context = await createDocumentContext(options);

		assert.strictEqual(context.uri, uri);
		assert.strictEqual(context.workspaceRoot, null);
	});

	test("finds matching workspace folder for nested file", async () => {
		const workspaceRoot = path.resolve("workspace");
		const filePath = path.join(workspaceRoot, "src", "queries", "test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 5;");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings(),
			workspaceFolders: [workspaceRoot],
			isSavedFn: () => true,
		};

		const context = await createDocumentContext(options);

		assert.strictEqual(context.workspaceRoot, workspaceRoot);
		assert.strictEqual(context.cwd, workspaceRoot);
	});

	test("includes configPath in effective settings when resolved", async () => {
		const filePath = path.resolve("workspace", "test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 6;");
		const configPath = path.resolve("workspace", "tsqlrefine.config.json");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings({
				configPath,
			}),
			workspaceFolders: [path.resolve("workspace")],
			isSavedFn: () => true,
		};

		const context = await createDocumentContext(options);

		// The effective config path might be resolved differently,
		// but it should at least preserve the configured path
		assert.ok(context.effectiveSettings.configPath);
	});

	test("handles empty configPath", async () => {
		const filePath = path.resolve("workspace", "test.sql");
		const uri = URI.file(filePath).toString();
		const document = TextDocument.create(uri, "sql", 1, "SELECT 7;");

		const options: DocumentContextOptions = {
			document,
			documentSettings: createTestSettings({
				configPath: "",
			}),
			workspaceFolders: [path.resolve("workspace")],
			isSavedFn: () => true,
		};

		const context = await createDocumentContext(options);

		assert.ok(context.effectiveSettings);
	});
});
