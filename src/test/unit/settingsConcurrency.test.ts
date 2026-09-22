import * as assert from "node:assert";
import type { Connection } from "vscode-languageserver/node";
import { defaultSettings } from "../../server/config/settings";
import { SettingsManager } from "../../server/state/settingsManager";
import { deferred } from "../helpers/serverHarness";

suite("Settings refresh concurrency", () => {
	test("an old scoped response cannot restore enabled lint after disable", async () => {
		const oldResponse = deferred<typeof defaultSettings>();
		let enabled = true;
		let calls = 0;
		const manager = new SettingsManager({
			workspace: {
				getConfiguration: async ({ scopeUri }: { scopeUri?: string }) => {
					if (scopeUri && ++calls === 1) return oldResponse.promise;
					return { ...defaultSettings, enableLint: enabled };
				},
			},
		} as unknown as Connection);
		const pending = manager.getSettingsForDocument("untitled:test");
		enabled = false;
		await manager.refreshSettings();
		oldResponse.resolve(defaultSettings);
		assert.strictEqual((await pending).enableLint, false);
		assert.strictEqual(
			(await manager.getSettingsForDocument("untitled:test")).enableLint,
			false,
		);
		assert.strictEqual(calls, 2);
	});

	test("out-of-order global responses keep the latest settings", async () => {
		const oldResponse = deferred<typeof defaultSettings>();
		let calls = 0;
		const manager = new SettingsManager({
			workspace: {
				getConfiguration: async () =>
					++calls === 1
						? oldResponse.promise
						: { ...defaultSettings, enableLint: false },
			},
		} as unknown as Connection);
		const oldRefresh = manager.refreshSettings();
		await manager.refreshSettings();
		oldResponse.resolve(defaultSettings);
		await oldRefresh;
		assert.strictEqual(manager.getSettings().enableLint, false);
	});
});
