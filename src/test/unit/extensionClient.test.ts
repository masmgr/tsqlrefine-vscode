import * as assert from "node:assert";
import * as path from "node:path";
import type * as vscode from "vscode";
import { URI } from "vscode-uri";
import type * as Extension from "../../extension";
import { loadWithMocks } from "../helpers/moduleMocks";

type Callback = (...args: never[]) => unknown;

function createHarness() {
	const commands = new Map<string, Callback>();
	const events = new Map<string, Callback>();
	const notifications = new Map<string, Callback>();
	const requests: Array<{ method: string; params: unknown }> = [];
	const sentNotifications: Array<{ method: string; params: unknown }> = [];
	const errors: string[] = [];
	const informations: Array<{ message: string; items: string[] }> = [];
	const opened: string[] = [];
	const updates: Array<{
		section: string;
		scope: unknown;
		key: string;
		value: unknown;
		target: unknown;
	}> = [];
	const state = {
		enableLint: true,
		conflicting: false,
		suppress: false,
		defaultFormatter: "",
		choice: undefined as string | undefined,
		activeUri: "untitled:test.sql" as string | undefined,
		workspaceFolders: [{ uri: URI.file(process.cwd()) }] as Array<{ uri: URI }>,
		diagnostics: [] as [URI, Array<{ source: string; severity: number }>][],
		response: { ok: true } as { ok: boolean; error?: string },
		starts: 0,
		stops: 0,
		shown: 0,
		/** Makes `client.start()` reject. */
		startError: undefined as Error | undefined,
		/** Makes `config.update` throw. */
		updateError: undefined as Error | undefined,
		/** Makes `context.globalState.get` throw. */
		globalStateError: undefined as Error | undefined,
	};
	const statusItem = {
		text: "",
		tooltip: "",
		command: "",
		show() {
			state.shown++;
		},
		dispose() {},
	};
	const disposable = { dispose() {} };
	const subscribe = (event: string) => (callback: Callback) => {
		events.set(event, callback);
		return disposable;
	};
	let clientOptions:
		| {
				documentSelector: unknown;
				synchronize: unknown;
				outputChannel?: unknown;
		  }
		| undefined;
	let serverOptions:
		| {
				run: { module: string; transport: unknown };
				debug: {
					module: string;
					transport: unknown;
					options: { execArgv: string[] };
				};
		  }
		| undefined;
	let clientIdentity: { id: string; name: string } | undefined;
	const outputChannels: Array<{ name: string; options?: unknown }> = [];
	class LanguageClient {
		constructor(
			id: string,
			name: string,
			server: typeof serverOptions,
			options: typeof clientOptions,
		) {
			clientIdentity = { id, name };
			serverOptions = server;
			clientOptions = options;
		}
		onNotification(method: string, callback: Callback) {
			notifications.set(method, callback);
			return disposable;
		}
		async start() {
			state.starts++;
			if (state.startError) {
				throw state.startError;
			}
		}
		async stop() {
			state.stops++;
		}
		async sendRequest(method: string, params: unknown) {
			requests.push({ method, params });
			return state.response;
		}
		async sendNotification(method: string, params: unknown) {
			sentNotifications.push({ method, params });
		}
	}
	const fakeVscode = {
		Uri: URI,
		StatusBarAlignment: { Left: 1 },
		DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
		ConfigurationTarget: { Global: 1, Workspace: 2 },
		env: {
			openExternal: async (uri: URI) => {
				opened.push(uri.toString());
				return true;
			},
		},
		extensions: { getExtension: () => (state.conflicting ? {} : undefined) },
		commands: {
			registerCommand: (id: string, callback: Callback) => {
				commands.set(id, callback);
				return disposable;
			},
			executeCommand: async (id: string, ...args: never[]) =>
				commands.get(id)?.(...args),
		},
		window: {
			get activeTextEditor() {
				return state.activeUri
					? { document: { uri: URI.parse(state.activeUri) } }
					: undefined;
			},
			createOutputChannel: (name: string, options?: unknown) => {
				outputChannels.push(
					options === undefined ? { name } : { name, options },
				);
				return disposable;
			},
			createStatusBarItem: () => statusItem,
			showInformationMessage: async (message: string, ...items: string[]) => {
				informations.push({ message, items });
				return state.choice;
			},
			showErrorMessage: async (message: string) => {
				errors.push(message);
			},
		},
		languages: {
			getDiagnostics: (uri?: URI) =>
				uri
					? (state.diagnostics.find(
							([entryUri]) => entryUri.toString() === uri.toString(),
						)?.[1] ?? [])
					: state.diagnostics,
			onDidChangeDiagnostics: subscribe("diagnostics"),
		},
		workspace: {
			get workspaceFolders() {
				return state.workspaceFolders;
			},
			getConfiguration: (section: string, scope: unknown) => ({
				get: (key: string) =>
					key === "enableLint" ? state.enableLint : state.defaultFormatter,
				update: async (key: string, value: unknown, target: unknown) => {
					if (state.updateError) {
						throw state.updateError;
					}
					updates.push({ section, scope, key, value, target });
				},
			}),
			onDidChangeConfiguration: subscribe("configuration"),
			onDidDeleteFiles: subscribe("delete"),
			onDidRenameFiles: subscribe("rename"),
		},
	};
	const context = {
		subscriptions: [],
		asAbsolutePath: (relative: string) => path.resolve(relative),
		globalState: {
			get: () => {
				if (state.globalStateError) {
					throw state.globalStateError;
				}
				return state.suppress;
			},
			update: async (_key: string, value: boolean) => {
				state.suppress = value;
			},
		},
	} as unknown as vscode.ExtensionContext;
	const modules = [
		"../../extension",
		"../../client/client",
		"../../client/statusBar",
	].map((id) => require.resolve(id));
	for (const filename of modules) delete require.cache[filename];
	const extension = loadWithMocks<typeof Extension>(
		require.resolve("../../extension"),
		{
			vscode: fakeVscode,
			"vscode-languageclient/node": {
				LanguageClient,
				TransportKind: { ipc: 1 },
			},
		},
	);
	const call = async (
		callbacks: Map<string, Callback>,
		id: string,
		...args: unknown[]
	) => {
		const callback = callbacks.get(id);
		assert.ok(callback, `Missing callback: ${id}`);
		return callback(...(args as never[]));
	};
	return {
		extension,
		context,
		state,
		commands,
		events,
		notifications,
		requests,
		sentNotifications,
		errors,
		informations,
		opened,
		statusItem,
		updates,
		outputChannels,
		call,
		get clientOptions() {
			return clientOptions;
		},
		get serverOptions() {
			return serverOptions;
		},
		get clientIdentity() {
			return clientIdentity;
		},
		dispose() {
			for (const filename of modules) delete require.cache[filename];
		},
	};
}

suite("Extension client integration", () => {
	let h: ReturnType<typeof createHarness>;
	setup(() => {
		h = createHarness();
	});
	teardown(async () => {
		await h.extension.deactivate();
		h.dispose();
	});

	test("activates the language client and reflects diagnostics, operations and enableLint", async () => {
		await h.extension.activate(h.context).clientReady;
		assert.strictEqual(h.state.starts, 1);
		assert.deepStrictEqual(
			h.clientOptions?.documentSelector,
			["sql", "tsql", "mssql"].flatMap((language) => [
				{ scheme: "file", language },
				{ scheme: "untitled", language },
			]),
		);
		h.state.diagnostics = [
			[
				URI.parse("untitled:test"),
				[
					{ source: "tsqlrefine", severity: 0 },
					{ source: "tsqlrefine", severity: 1 },
					{ source: "tsqlrefine", severity: 2 },
					{ source: "tsqlrefine", severity: 3 },
					{ source: "other", severity: 0 },
				],
			],
		];
		await h.call(h.events, "diagnostics");
		assert.ok(h.statusItem.text.includes("1E 1W"));
		assert.ok(h.statusItem.tooltip.includes("Hints: 1"));

		// Only the URIs carried by the event are re-counted.
		h.state.diagnostics = [
			[URI.parse("untitled:test"), [{ source: "tsqlrefine", severity: 0 }]],
			[
				URI.parse("untitled:other"),
				[
					{ source: "tsqlrefine", severity: 1 },
					{ source: "tsqlrefine", severity: 1 },
				],
			],
		];
		await h.call(h.events, "diagnostics", {
			uris: [URI.parse("untitled:test")],
		});
		assert.ok(
			h.statusItem.text.includes("1E"),
			`expected only the changed URI to be re-counted, got: ${h.statusItem.text}`,
		);
		assert.ok(!h.statusItem.text.includes("W"));

		await h.call(h.events, "diagnostics", {
			uris: [URI.parse("untitled:other")],
		});
		assert.ok(h.statusItem.text.includes("1E 2W"));

		// A URI that no longer has tsqlrefine diagnostics drops out of the totals.
		h.state.diagnostics = [
			[URI.parse("untitled:test"), [{ source: "other", severity: 0 }]],
			[
				URI.parse("untitled:other"),
				[
					{ source: "tsqlrefine", severity: 1 },
					{ source: "tsqlrefine", severity: 1 },
				],
			],
		];
		await h.call(h.events, "diagnostics", {
			uris: [URI.parse("untitled:test")],
		});
		assert.ok(h.statusItem.text.includes("2W"));
		assert.ok(!h.statusItem.text.includes("E"));

		await h.call(h.notifications, "tsqlrefine/operationState", {
			state: "started",
		});
		assert.ok(h.statusItem.text.includes("spin"));
		await h.call(h.notifications, "tsqlrefine/operationState", {
			state: "completed",
		});
		assert.ok(!h.statusItem.text.includes("spin"));
		h.state.enableLint = false;
		await h.call(h.events, "configuration", {
			affectsConfiguration: () => true,
		});
		assert.ok(h.statusItem.text.includes("Off"));
	});

	test("commands use the active document or supplied URI and route file cleanup", async () => {
		await h.extension.activate(h.context).clientReady;
		await h.call(h.commands, "tsqlrefine.run");
		await h.call(h.commands, "tsqlrefine.format", URI.parse("untitled:format"));
		await h.call(h.commands, "tsqlrefine.fix", "untitled:fix");
		assert.deepStrictEqual(h.requests, [
			{
				method: "tsqlrefine/lintDocument",
				params: { uri: "untitled:test.sql" },
			},
			{
				method: "tsqlrefine/formatDocument",
				params: { uri: "untitled:format" },
			},
			{ method: "tsqlrefine/fixDocument", params: { uri: "untitled:fix" } },
		]);
		h.state.activeUri = undefined;
		await h.call(h.commands, "tsqlrefine.run");
		assert.strictEqual(h.requests.length, 3);
		await h.call(h.events, "delete", {
			files: [URI.parse("untitled:deleted")],
		});
		await h.call(h.events, "rename", {
			files: [{ oldUri: URI.parse("untitled:old") }],
		});
		assert.strictEqual(h.sentNotifications.length, 2);
		await h.call(h.notifications, "tsqlrefine/openInstallGuide");
		assert.strictEqual(h.opened.length, 1);
	});

	test("reports command failures without rejecting the command", async () => {
		await h.extension.activate(h.context).clientReady;
		h.state.response = { ok: false, error: "Document changed or closed" };
		const original = console.error;
		console.error = () => {};
		try {
			await h.call(h.commands, "tsqlrefine.fix");
		} finally {
			console.error = original;
		}
		assert.ok(h.errors[0]?.includes("Document changed or closed"));
	});

	for (const hasWorkspace of [true, false]) {
		test(`sets language-specific default formatters (workspace=${hasWorkspace})`, async () => {
			if (!hasWorkspace) h.state.workspaceFolders = [];
			await h.extension.activate(h.context).clientReady;
			await h.call(h.commands, "tsqlrefine.setAsDefaultFormatter");
			assert.strictEqual(h.updates.length, 3);
			assert.ok(
				h.updates.every(
					(update) =>
						update.value === "masmgr.tsqlrefine" &&
						update.target === (hasWorkspace ? 2 : 1),
				),
			);
		});
	}

	for (const choice of ["Don't Ask Again", "Set as Default"]) {
		test(`handles the formatter suggestion: ${choice}`, async () => {
			h.state.conflicting = true;
			h.state.choice = choice;
			await h.extension.activate(h.context).clientReady;
			await new Promise<void>((resolve) => setImmediate(resolve));
			if (choice === "Don't Ask Again") assert.ok(h.state.suppress);
			else assert.strictEqual(h.updates.length, 3);
		});
	}

	suite("createLanguageClient", () => {
		test("runs dist/server.js over the ipc transport", async () => {
			await h.extension.activate(h.context).clientReady;

			const server = h.serverOptions;
			assert.ok(server);
			assert.ok(
				server.run.module.endsWith(path.join("dist", "server.js")),
				`unexpected server module: ${server.run.module}`,
			);
			assert.strictEqual(server.run.transport, 1);
			assert.strictEqual(server.debug.module, server.run.module);
			assert.strictEqual(server.debug.transport, 1);
			assert.deepStrictEqual(server.debug.options.execArgv, [
				"--nolazy",
				"--inspect=6009",
			]);
		});

		test("synchronizes the tsqlrefine configuration section", async () => {
			await h.extension.activate(h.context).clientReady;

			assert.deepStrictEqual(h.clientOptions?.synchronize, {
				configurationSection: "tsqlrefine",
			});
		});

		test("creates a log output channel named TSQLRefine", async () => {
			await h.extension.activate(h.context).clientReady;

			assert.deepStrictEqual(h.outputChannels, [
				{ name: "TSQLRefine", options: { log: true } },
			]);
			assert.ok(h.clientOptions?.outputChannel);
		});

		test("uses the tsqlrefineLite client id", async () => {
			await h.extension.activate(h.context).clientReady;

			assert.deepStrictEqual(h.clientIdentity, {
				id: "tsqlrefineLite",
				name: "tsqlrefine",
			});
		});
	});

	suite("failure paths", () => {
		/** Run `body` with console.error silenced, as these paths log to it. */
		async function withSilencedConsole(body: () => Promise<void>) {
			const original = console.error;
			console.error = () => {};
			try {
				await body();
			} finally {
				console.error = original;
			}
		}

		test("surfaces a client start failure", async () => {
			h.state.startError = new Error("boom");

			await withSilencedConsole(async () => {
				const api = h.extension.activate(h.context);
				// The failure stays on clientReady so the commands still report it,
				// and is surfaced once here.
				await assert.rejects(api.clientReady, /boom/);
			});

			assert.ok(
				h.errors.some((message) =>
					message.includes("language server failed to start"),
				),
				`unexpected errors: ${JSON.stringify(h.errors)}`,
			);
		});

		test("reports a configuration update failure", async () => {
			await h.extension.activate(h.context).clientReady;
			h.state.updateError = new Error("denied");

			await withSilencedConsole(async () => {
				await h.call(h.commands, "tsqlrefine.setAsDefaultFormatter");
			});

			assert.ok(
				h.errors.some((message) =>
					message.includes("failed to set default formatter"),
				),
				`unexpected errors: ${JSON.stringify(h.errors)}`,
			);
		});
	});

	suite("default formatter suggestion", () => {
		/** activate() fires the suggestion detached, so let it settle. */
		async function activateAndSettle() {
			await h.extension.activate(h.context).clientReady;
			await new Promise<void>((resolve) => setImmediate(resolve));
		}

		test("prompts when a conflicting formatter is installed", async () => {
			h.state.conflicting = true;
			await activateAndSettle();

			assert.strictEqual(h.informations.length, 1);
			assert.deepStrictEqual(h.informations[0]?.items, [
				"Set as Default",
				"Don't Ask Again",
			]);
		});

		test("does not prompt when the suggestion was suppressed", async () => {
			h.state.conflicting = true;
			h.state.suppress = true;
			await activateAndSettle();

			assert.deepStrictEqual(h.informations, []);
		});

		test("does not prompt when no conflicting extension is installed", async () => {
			h.state.conflicting = false;
			await activateAndSettle();

			assert.deepStrictEqual(h.informations, []);
		});

		test("does not prompt when a default formatter is already configured", async () => {
			h.state.conflicting = true;
			h.state.defaultFormatter = "ms-mssql.mssql";
			await activateAndSettle();

			assert.deepStrictEqual(h.informations, []);
		});

		test("swallows an error while evaluating the suggestion", async () => {
			h.state.globalStateError = new Error("state unavailable");
			const original = console.error;
			console.error = () => {};
			try {
				await activateAndSettle();
			} finally {
				console.error = original;
			}

			// activate() still succeeded and nothing was shown to the user.
			assert.strictEqual(h.state.starts, 1);
			assert.deepStrictEqual(h.informations, []);
			assert.deepStrictEqual(h.errors, []);
		});
	});
});
