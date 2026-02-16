import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { SettingsManager } from "../../server/state/settingsManager";
import { defaultSettings } from "../../server/config/settings";

/**
 * Interface for tracking mock connection calls.
 */
interface MockConnectionCalls {
	getConfiguration: Array<{ section?: string; scopeUri?: string }>;
}

/**
 * Creates a mock Connection for testing SettingsManager.
 */
function createMockConnection(configValues: Record<string, unknown> = {}): {
	connection: Connection;
	calls: MockConnectionCalls;
} {
	const calls: MockConnectionCalls = {
		getConfiguration: [],
	};

	const connection = {
		workspace: {
			getConfiguration: async (params: {
				section?: string;
				scopeUri?: string;
			}) => {
				calls.getConfiguration.push(params);
				return configValues;
			},
		},
	} as unknown as Connection;

	return { connection, calls };
}

suite("SettingsManager", () => {
	suite("constructor", () => {
		test("creates instance with connection", () => {
			const { connection } = createMockConnection();
			const manager = new SettingsManager(connection);
			assert.ok(manager);
		});
	});

	suite("getSettings", () => {
		test("returns default settings initially", () => {
			const { connection } = createMockConnection();
			const manager = new SettingsManager(connection);

			const settings = manager.getSettings();

			assert.deepStrictEqual(settings, defaultSettings);
		});
	});

	suite("refreshSettings", () => {
		test("fetches configuration from workspace", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();

			assert.strictEqual(calls.getConfiguration.length, 1);
			assert.deepStrictEqual(calls.getConfiguration[0], {
				section: "tsqlrefine",
			});
		});

		test("merges workspace config with defaults", async () => {
			const { connection } = createMockConnection({
				runOnSave: false,
				debounceMs: 1000,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.runOnSave, false);
			assert.strictEqual(settings.debounceMs, 1000);
			// Default values should be preserved
			assert.strictEqual(settings.runOnType, defaultSettings.runOnType);
		});

		test("handles null configuration response", async () => {
			const connection = {
				workspace: {
					getConfiguration: async () => null,
				},
			} as unknown as Connection;
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			// Should fall back to defaults
			assert.deepStrictEqual(settings, defaultSettings);
		});
	});

	suite("getSettingsForDocument", () => {
		test("fetches scoped configuration for document URI", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.getSettingsForDocument("file:///test.sql");

			assert.strictEqual(calls.getConfiguration.length, 1);
			assert.deepStrictEqual(calls.getConfiguration[0], {
				scopeUri: "file:///test.sql",
				section: "tsqlrefine",
			});
		});

		test("merges scoped config with global settings", async () => {
			const { connection } = createMockConnection({
				timeoutMs: 20000,
			});
			const manager = new SettingsManager(connection);

			const settings = await manager.getSettingsForDocument("file:///test.sql");

			assert.strictEqual(settings.timeoutMs, 20000);
		});

		test("handles null scoped configuration response", async () => {
			const connection = {
				workspace: {
					getConfiguration: async () => null,
				},
			} as unknown as Connection;
			const manager = new SettingsManager(connection);

			const settings = await manager.getSettingsForDocument("file:///test.sql");

			// Should fall back to defaults
			assert.strictEqual(settings.runOnSave, defaultSettings.runOnSave);
		});
	});

	suite("normalizeSettings", () => {
		test("normalizes negative maxFileSizeKb to 0", async () => {
			const { connection } = createMockConnection({
				maxFileSizeKb: -10,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.maxFileSizeKb, 0);
		});

		test("normalizes NaN maxFileSizeKb to 0", async () => {
			const { connection } = createMockConnection({
				maxFileSizeKb: Number.NaN,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.maxFileSizeKb, 0);
		});

		test("normalizes Infinity maxFileSizeKb to 0", async () => {
			const { connection } = createMockConnection({
				maxFileSizeKb: Number.POSITIVE_INFINITY,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.maxFileSizeKb, 0);
		});

		test("preserves valid positive maxFileSizeKb", async () => {
			const { connection } = createMockConnection({
				maxFileSizeKb: 100,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.maxFileSizeKb, 100);
		});

		test("preserves zero maxFileSizeKb (unlimited)", async () => {
			const { connection } = createMockConnection({
				maxFileSizeKb: 0,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.maxFileSizeKb, 0);
		});

		test("normalizes non-boolean allowPlugins to false", async () => {
			const { connection } = createMockConnection({
				allowPlugins: "yes" as unknown,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.allowPlugins, false);
		});

		test("preserves allowPlugins true when explicitly set", async () => {
			const { connection } = createMockConnection({
				allowPlugins: true,
			});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.allowPlugins, true);
		});

		test("defaults allowPlugins to false when not configured", async () => {
			const { connection } = createMockConnection({});
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			const settings = manager.getSettings();

			assert.strictEqual(settings.allowPlugins, false);
		});
	});
});
