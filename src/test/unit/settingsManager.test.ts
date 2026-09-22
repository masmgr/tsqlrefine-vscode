import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { DOCUMENT_SETTINGS_CACHE_MAX_SIZE } from "../../server/config/constants";
import { defaultSettings } from "../../server/config/settings";
import { SettingsManager } from "../../server/state/settingsManager";

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

	suite("getSettingsForDocument caching", () => {
		test("caches result and avoids repeated LSP round-trips", async () => {
			const { connection, calls } = createMockConnection({ timeoutMs: 20000 });
			const manager = new SettingsManager(connection);

			const first = await manager.getSettingsForDocument("file:///test.sql");
			const second = await manager.getSettingsForDocument("file:///test.sql");

			// Second call served from cache: only one getConfiguration call total.
			assert.strictEqual(calls.getConfiguration.length, 1);
			assert.deepStrictEqual(first, second);
		});

		test("caches per-document independently", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.getSettingsForDocument("file:///a.sql");
			await manager.getSettingsForDocument("file:///b.sql");

			assert.strictEqual(calls.getConfiguration.length, 2);
		});

		test("invalidateDocument clears the cached entry", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.getSettingsForDocument("file:///test.sql");
			manager.invalidateDocument("file:///test.sql");
			await manager.getSettingsForDocument("file:///test.sql");

			assert.strictEqual(calls.getConfiguration.length, 2);
		});

		test("invalidateAll clears all cached entries", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.getSettingsForDocument("file:///a.sql");
			await manager.getSettingsForDocument("file:///b.sql");
			manager.invalidateAll();
			await manager.getSettingsForDocument("file:///a.sql");
			await manager.getSettingsForDocument("file:///b.sql");

			assert.strictEqual(calls.getConfiguration.length, 4);
		});

		test("refreshSettings invalidates the document cache", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			await manager.getSettingsForDocument("file:///test.sql");
			await manager.refreshSettings(); // global fetch (1 call)
			// Cache was cleared by refreshSettings, so this re-fetches.
			await manager.getSettingsForDocument("file:///test.sql");

			// 1 (initial doc) + 1 (refresh) + 1 (doc re-fetch) = 3
			assert.strictEqual(calls.getConfiguration.length, 3);
		});

		test("evicts the least recently used document once the cache is full", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			for (let i = 0; i < DOCUMENT_SETTINGS_CACHE_MAX_SIZE; i++) {
				await manager.getSettingsForDocument(`file:///doc${i}.sql`);
			}
			const afterFill = calls.getConfiguration.length;

			// One more document pushes the oldest entry out.
			await manager.getSettingsForDocument("file:///overflow.sql");
			await manager.getSettingsForDocument("file:///doc0.sql");

			assert.strictEqual(
				calls.getConfiguration.length,
				afterFill + 2,
				"doc0 should have been evicted and re-fetched",
			);
			// The most recently cached document is still served from cache.
			const newest = `file:///doc${DOCUMENT_SETTINGS_CACHE_MAX_SIZE - 1}.sql`;
			await manager.getSettingsForDocument(newest);
			assert.strictEqual(calls.getConfiguration.length, afterFill + 2);
		});

		test("refreshes the LRU order on a cache hit", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			for (let i = 0; i < DOCUMENT_SETTINGS_CACHE_MAX_SIZE; i++) {
				await manager.getSettingsForDocument(`file:///doc${i}.sql`);
			}
			// Touch doc0 so doc1 becomes the oldest entry instead.
			await manager.getSettingsForDocument("file:///doc0.sql");
			const afterTouch = calls.getConfiguration.length;

			await manager.getSettingsForDocument("file:///overflow.sql");
			await manager.getSettingsForDocument("file:///doc0.sql");

			assert.strictEqual(
				calls.getConfiguration.length,
				afterTouch + 1,
				"doc0 was touched most recently and should still be cached",
			);
		});

		test("re-caching a document already in a full cache evicts nothing", async () => {
			const { connection, calls } = createMockConnection();
			const manager = new SettingsManager(connection);

			for (let i = 0; i < DOCUMENT_SETTINGS_CACHE_MAX_SIZE; i++) {
				await manager.getSettingsForDocument(`file:///doc${i}.sql`);
			}
			manager.invalidateDocument("file:///doc5.sql");
			await manager.getSettingsForDocument("file:///doc5.sql");
			const afterRefill = calls.getConfiguration.length;

			// doc0 is still cached: re-inserting doc5 did not evict anything.
			await manager.getSettingsForDocument("file:///doc0.sql");

			assert.strictEqual(calls.getConfiguration.length, afterRefill);
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

		test("normalizes negative timeoutMs to default", async () => {
			const { connection } = createMockConnection({ timeoutMs: -1 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().timeoutMs,
				defaultSettings.timeoutMs,
			);
		});

		test("normalizes NaN timeoutMs to default", async () => {
			const { connection } = createMockConnection({ timeoutMs: Number.NaN });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().timeoutMs,
				defaultSettings.timeoutMs,
			);
		});

		test("normalizes zero timeoutMs to default", async () => {
			const { connection } = createMockConnection({ timeoutMs: 0 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().timeoutMs,
				defaultSettings.timeoutMs,
			);
		});

		test("preserves valid positive timeoutMs", async () => {
			const { connection } = createMockConnection({ timeoutMs: 5000 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(manager.getSettings().timeoutMs, 5000);
		});

		test("normalizes invalid formatTimeoutMs to default", async () => {
			const { connection } = createMockConnection({ formatTimeoutMs: -1 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().formatTimeoutMs,
				defaultSettings.formatTimeoutMs,
			);
		});

		test("normalizes invalid fixTimeoutMs to default", async () => {
			const { connection } = createMockConnection({ fixTimeoutMs: -1 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().fixTimeoutMs,
				defaultSettings.fixTimeoutMs,
			);
		});

		test("normalizes negative debounceMs to default", async () => {
			const { connection } = createMockConnection({ debounceMs: -1 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(
				manager.getSettings().debounceMs,
				defaultSettings.debounceMs,
			);
		});

		test("preserves zero debounceMs (no debounce)", async () => {
			const { connection } = createMockConnection({ debounceMs: 0 });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(manager.getSettings().debounceMs, 0);
		});

		test("falls back to info for an unrecognized minSeverity", async () => {
			const { connection } = createMockConnection({ minSeverity: "critical" });
			const manager = new SettingsManager(connection);

			await manager.refreshSettings();
			assert.strictEqual(manager.getSettings().minSeverity, "info");
		});

		test("preserves each recognized minSeverity", async () => {
			for (const severity of ["error", "warning", "info", "hint"] as const) {
				const { connection } = createMockConnection({ minSeverity: severity });
				const manager = new SettingsManager(connection);

				await manager.refreshSettings();
				assert.strictEqual(manager.getSettings().minSeverity, severity);
			}
		});
	});
});
