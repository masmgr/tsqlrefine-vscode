import * as assert from "node:assert";
import { install, type Clock } from "@sinonjs/fake-timers";
import { URI } from "vscode-uri";
import { MissingTsqlRefineError } from "../../server/shared/errors";
import type { ProcessRunResult } from "../../server/shared/types";
import {
	cliResult,
	deferred,
	diagnosticJson,
	ServerHarness,
} from "../helpers/serverHarness";

suite("Server document lifecycle", () => {
	let clock: Clock;
	setup(() => {
		clock = install({ now: Date.now() });
	});
	teardown(() => clock.uninstall());

	test("publishes syntax diagnostics for exit code 2 without a failure popup", async () => {
		const h = new ServerHarness({
			lint: { runner: async () => cliResult(diagnosticJson, 2) },
		});
		await h.initialize();
		await h.open();
		assert.deepStrictEqual(await h.request("lint"), { ok: true, issues: 1 });
		assert.strictEqual(h.diagnostics[0]?.diagnostics[0]?.code, "parse-error");
		assert.strictEqual(h.diagnostics[0]?.version, 1);
		assert.deepStrictEqual(h.warnings, []);
	});

	for (const operation of ["lint", "format", "fix"] as const) {
		test(`${operation} ignores a late runner error after cancellation`, async () => {
			const started = deferred<void>();
			const result = deferred<ProcessRunResult>();
			const h = new ServerHarness({
				[operation]: {
					runner: async () => {
						started.resolve();
						return result.promise;
					},
				},
			});
			await h.open();
			const request = h.request(operation);
			await started.promise;
			await h.close();
			const before = h.diagnostics.length;
			result.reject(new Error("late failure"));
			await request;
			assert.strictEqual(h.diagnostics.length, before);
			assert.deepStrictEqual(h.warnings, []);
		});

		for (const transition of ["edit", "close", "reopen"] as const) {
			test(`${operation} discards results after ${transition}, even if the runner ignores abort`, async () => {
				const started = deferred<AbortSignal>();
				const result = deferred<ProcessRunResult>();
				const h = new ServerHarness({
					[operation]: {
						runner: async ({ signal }: { signal: AbortSignal }) => {
							started.resolve(signal);
							return result.promise;
						},
					},
				});
				await h.open();
				const request = h.request(operation);
				const signal = await started.promise;
				if (transition === "edit") await h.change();
				else {
					await h.close();
					if (transition === "reopen") await h.open("SELECT 2;", 1);
				}
				assert.ok(signal.aborted);
				const before = h.diagnostics.length;
				result.resolve(
					cliResult(operation === "lint" ? diagnosticJson : "SELECT 9;"),
				);
				await request;
				assert.strictEqual(h.diagnostics.length, before);
				assert.deepStrictEqual(h.edits, []);
				assert.deepStrictEqual(h.warnings, []);
			});
		}

		test(`${operation} does not start after close during settings lookup`, async () => {
			let calls = 0;
			const h = new ServerHarness({
				[operation]: {
					runner: async () => {
						calls++;
						return cliResult("SELECT 9;");
					},
				},
			});
			const config = deferred<typeof h.settings>();
			h.configuration = async () => config.promise;
			await h.open();
			const request = h.request(operation);
			await h.close();
			const before = h.diagnostics.length;
			config.resolve(h.settings);
			await request;
			assert.strictEqual(calls, 0);
			assert.strictEqual(h.diagnostics.length, before);
			assert.deepStrictEqual(h.edits, []);
		});
	}

	test("disable clears diagnostics, cancels active lint, and rejects its late output", async () => {
		const started = deferred<AbortSignal>();
		const result = deferred<ProcessRunResult>();
		let calls = 0;
		const h = new ServerHarness({
			lint: {
				runner: async ({ signal }) => {
					if (++calls === 1) return cliResult(diagnosticJson, 2);
					started.resolve(signal);
					return result.promise;
				},
			},
		});
		await h.open();
		await h.request("lint");
		const request = h.request("lint");
		const signal = await started.promise;
		h.settings = { ...h.settings, enableLint: false };
		await h.invoke("onDidChangeConfiguration");
		assert.ok(signal.aborted);
		assert.deepStrictEqual(h.diagnostics.at(-1)?.diagnostics, []);
		const before = h.diagnostics.length;
		result.resolve(cliResult(diagnosticJson, 2));
		await request;
		await h.request("lint");
		assert.strictEqual(h.diagnostics.length, before);
		assert.strictEqual(calls, 2);
	});

	test("disable removes pending debounced lint", async () => {
		let calls = 0;
		const h = new ServerHarness({
			lint: {
				runner: async () => {
					calls++;
					return cliResult(diagnosticJson);
				},
			},
		});
		h.settings.runOnType = true;
		await h.open();
		await h.change();
		await clock.tickAsync(1);
		h.settings = { ...h.settings, enableLint: false };
		await h.invoke("onDidChangeConfiguration");
		await clock.tickAsync(1000);
		assert.strictEqual(calls, 0);
	});

	test("disable clears existing diagnostics even if typing occurs during settings refresh", async () => {
		const h = new ServerHarness({
			lint: { runner: async () => cliResult(diagnosticJson) },
		});
		await h.open();
		await h.request("lint");
		const scoped = deferred<typeof h.settings>();
		const started = deferred<void>();
		h.settings = { ...h.settings, enableLint: false };
		h.configuration = async (scopeUri) => {
			if (scopeUri) {
				started.resolve();
				return scoped.promise;
			}
			return h.settings;
		};
		const update = h.invoke("onDidChangeConfiguration");
		await started.promise;
		await h.change();
		scoped.resolve(h.settings);
		await update;
		assert.deepStrictEqual(h.diagnostics.at(-1)?.diagnostics, []);
	});

	for (const runOnOpen of [false, true]) {
		test(`runOnType does not duplicate or override runOnOpen=${runOnOpen}`, async () => {
			const inputs: string[] = [];
			const h = new ServerHarness({
				lint: {
					runner: async ({ stdin }) => {
						inputs.push(stdin);
						return cliResult(diagnosticJson);
					},
				},
			});
			h.settings = { ...h.settings, runOnType: true, runOnOpen };
			await h.open();
			await clock.tickAsync(1000);
			assert.strictEqual(inputs.length, runOnOpen ? 1 : 0);
			await h.change();
			await clock.tickAsync(1000);
			assert.strictEqual(inputs.length, runOnOpen ? 2 : 1);
			assert.strictEqual(inputs.at(-1), "SELECT 1;");
		});
	}

	test("save still lints when runOnType is disabled", async () => {
		const h = new ServerHarness({
			lint: { runner: async () => cliResult(diagnosticJson) },
		});
		h.settings.runOnSave = true;
		await h.open();
		await h.change();
		await h.invoke("onDidSaveTextDocument", { textDocument: { uri: h.uri } });
		await clock.tickAsync(0);
		assert.strictEqual(h.diagnostics.at(-1)?.version, 2);
	});

	test("format and fix apply versioned edits, and fix refreshes lint", async () => {
		const h = new ServerHarness({
			format: { runner: async () => cliResult("SELECT 1;\n") },
			fix: { runner: async () => cliResult("SELECT 2;\n") },
			lint: { runner: async () => cliResult(diagnosticJson) },
		});
		await h.open();
		assert.ok((await h.request("format")).ok);
		assert.ok((await h.request("fix")).ok);
		assert.strictEqual(h.edits.length, 2);
		assert.deepStrictEqual(h.edits[0]?.documentChanges?.[0], {
			textDocument: { uri: h.uri, version: 1 },
			edits: [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 12 },
					},
					newText: "SELECT 1;\n",
				},
			],
		});
		assert.strictEqual(h.diagnostics.length, 1);
	});

	test("unchanged edits and disabled operations do not apply edits", async () => {
		const h = new ServerHarness({
			format: { runner: async ({ stdin }) => cliResult(stdin) },
			fix: { runner: async ({ stdin }) => cliResult(stdin) },
		});
		await h.open();
		assert.ok((await h.request("format")).ok);
		assert.ok((await h.request("fix")).ok);
		h.settings = { ...h.settings, enableFormat: false, enableFix: false };
		await h.invoke("onDidChangeConfiguration");
		assert.strictEqual((await h.request("format")).ok, false);
		assert.strictEqual((await h.request("fix")).ok, false);
		assert.deepStrictEqual(h.edits, []);
	});

	test("handles missing documents and rejected workspace edits", async () => {
		const h = new ServerHarness({
			format: { runner: async () => cliResult("SELECT 1;") },
		});
		assert.strictEqual((await h.request("format")).ok, false);
		assert.strictEqual((await h.request("fix")).ok, false);
		assert.ok((await h.request("lint")).ok);
		assert.strictEqual(
			await h.invoke("onDocumentFormatting", { textDocument: { uri: h.uri } }),
			null,
		);
		await h.open();
		h.applyEdit = async () => ({ applied: false });
		assert.deepStrictEqual(await h.request("format"), {
			ok: false,
			error: "Failed to apply edits",
		});
	});

	test("exposes standard formatting and fixable code actions", async () => {
		const h = new ServerHarness({
			format: { runner: async () => cliResult("SELECT 1;") },
		});
		await h.open();
		assert.ok(
			await h.invoke("onDocumentFormatting", { textDocument: { uri: h.uri } }),
		);
		const params = {
			textDocument: { uri: h.uri },
			context: { diagnostics: [] as unknown[] },
		};
		assert.strictEqual(await h.invoke("onCodeAction", params), null);
		params.context.diagnostics.push({
			source: "tsqlrefine",
			data: { fixable: true },
		});
		const actions = await h.invoke<Array<{ command: { arguments: string[] } }>>(
			"onCodeAction",
			params,
		);
		assert.deepStrictEqual(actions[0]?.command.arguments, [h.uri]);
	});

	test("clears file state on delete and resolves file workspace contexts", async () => {
		const cwd = deferred<string>();
		const h = new ServerHarness({
			lint: {
				runner: async (options) => {
					cwd.resolve(options.cwd);
					return cliResult(diagnosticJson);
				},
			},
		});
		const folder = URI.file(process.cwd()).toString();
		await h.invoke("onInitialize", { workspaceFolders: [{ uri: folder }] });
		await h.invoke("onInitialized");
		await h.invoke("workspaceFolders", {
			removed: [{ uri: folder }],
			added: [{ uri: folder }],
		});
		await h.invoke("$/setTrace", { value: "verbose" });
		const uri = URI.file(`${process.cwd()}/query.sql`).toString();
		await h.open("SELECT 1;", 1, uri);
		await h.request("lint", uri);
		assert.strictEqual(await cwd.promise, URI.parse(folder).fsPath);
		await h.invoke("tsqlrefine/clearDiagnostics", { uris: [uri] });
		assert.deepStrictEqual(h.diagnostics.at(-1)?.diagnostics, []);
	});

	test("suppresses late missing-executable diagnostics after close", async () => {
		const warning = deferred<undefined>();
		const shown = deferred<void>();
		const h = new ServerHarness({
			lint: {
				runner: async () => {
					throw new MissingTsqlRefineError("missing");
				},
			},
		});
		h.showWarning = async () => {
			shown.resolve();
			return warning.promise;
		};
		await h.open();
		const request = h.request("lint");
		await shown.promise;
		await h.close();
		const before = h.diagnostics.length;
		warning.resolve(undefined);
		await request;
		assert.strictEqual(h.diagnostics.length, before);
	});
});
