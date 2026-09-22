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
		diagnostics: [] as Array<
			[URI, Array<{ source: string; severity: number }>]
		>,
		response: { ok: true } as { ok: boolean; error?: string },
		starts: 0,
		stops: 0,
		shown: 0,
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
		| { documentSelector: unknown; synchronize: unknown }
		| undefined;
	class LanguageClient {
		constructor(
			_id: string,
			_name: string,
			_server: unknown,
			options: typeof clientOptions,
		) {
			clientOptions = options;
		}
		onNotification(method: string, callback: Callback) {
			notifications.set(method, callback);
			return disposable;
		}
		async start() {
			state.starts++;
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
			createOutputChannel: () => disposable,
			createStatusBarItem: () => statusItem,
			showInformationMessage: async () => state.choice,
			showErrorMessage: async (message: string) => {
				errors.push(message);
			},
		},
		languages: {
			getDiagnostics: () => state.diagnostics,
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
			get: () => state.suppress,
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
		opened,
		statusItem,
		updates,
		call,
		get clientOptions() {
			return clientOptions;
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
});
