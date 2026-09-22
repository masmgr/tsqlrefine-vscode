import * as assert from "node:assert";
import type {
	Connection,
	PublishDiagnosticsParams,
	WorkspaceEdit,
} from "vscode-languageserver/node";
import {
	defaultSettings,
	type TsqlRefineSettings,
} from "../../server/config/settings";
import { registerServer, type ServerRunners } from "../../server/server";

// Re-exported so existing imports of these from serverHarness keep working.
export {
	cliCancelled,
	cliResult,
	cliTimedOut,
	deferred,
	diagnosticJson,
} from "./processResults";

type Handler = (params: never) => unknown;

export class ServerHarness {
	readonly uri = "untitled:regression.sql";
	readonly handlers = new Map<string, Handler>();
	readonly diagnostics: PublishDiagnosticsParams[] = [];
	readonly edits: WorkspaceEdit[] = [];
	readonly warnings: string[] = [];
	readonly logs: string[] = [];
	readonly notifications: Array<{ method: string; params: unknown }> = [];
	settings: TsqlRefineSettings = {
		...defaultSettings,
		path: process.execPath,
		runOnOpen: false,
		runOnSave: false,
		runOnType: false,
	};
	configuration = async (
		_scopeUri?: string,
	): Promise<Partial<TsqlRefineSettings>> => this.settings;
	applyEdit = async (_edit: WorkspaceEdit) => ({ applied: true });
	showWarning = async (_message: string): Promise<undefined> => undefined;

	constructor(runners: ServerRunners = {}) {
		const register = (name: string) => (handler: Handler) => {
			this.handlers.set(name, handler);
			return { dispose() {} };
		};
		const connection = {
			...Object.fromEntries(
				[
					"onInitialize",
					"onInitialized",
					"onDidChangeConfiguration",
					"onDocumentFormatting",
					"onCodeAction",
					"onDidOpenTextDocument",
					"onDidChangeTextDocument",
					"onDidCloseTextDocument",
					"onDidSaveTextDocument",
					"onWillSaveTextDocument",
					"onWillSaveTextDocumentWaitUntil",
				].map((name) => [name, register(name)]),
			),
			onRequest: (name: string, handler: Handler) => register(name)(handler),
			onNotification: (name: string, handler: Handler) =>
				register(name)(handler),
			sendDiagnostics: (params: PublishDiagnosticsParams) =>
				this.diagnostics.push(params),
			sendNotification: (method: string, params: unknown) =>
				this.notifications.push({ method, params }),
			console: Object.fromEntries(
				["log", "debug", "warn", "error"].map((name) => [
					name,
					(message: string) => this.logs.push(message),
				]),
			),
			window: {
				showWarningMessage: (message: string) => {
					this.warnings.push(message);
					return this.showWarning(message);
				},
			},
			workspace: {
				onDidChangeWorkspaceFolders: register("workspaceFolders"),
				getConfiguration: (params: { scopeUri?: string }) =>
					this.configuration(params.scopeUri),
				applyEdit: (edit: WorkspaceEdit) => {
					this.edits.push(edit);
					return this.applyEdit(edit);
				},
			},
		} as unknown as Connection;
		registerServer(connection, runners);
	}

	async invoke<T = unknown>(method: string, params: unknown = {}): Promise<T> {
		const handler = this.handlers.get(method);
		assert.ok(handler, `No handler for ${method}`);
		return (await handler(params as never)) as T;
	}

	async initialize(): Promise<void> {
		await this.invoke("onInitialize", { capabilities: {}, trace: "verbose" });
		await this.invoke("onInitialized");
	}

	async open(
		text = "SELECT FROM;",
		version = 1,
		uri = this.uri,
	): Promise<void> {
		await this.invoke("onDidOpenTextDocument", {
			textDocument: { uri, languageId: "sql", version, text },
		});
	}

	async change(text = "SELECT 1;", version = 2): Promise<void> {
		await this.invoke("onDidChangeTextDocument", {
			textDocument: { uri: this.uri, version },
			contentChanges: [{ text }],
		});
	}

	async save(version = 1): Promise<void> {
		await this.invoke("onDidSaveTextDocument", {
			textDocument: { uri: this.uri, version },
		});
	}

	async close(): Promise<void> {
		await this.invoke("onDidCloseTextDocument", {
			textDocument: { uri: this.uri },
		});
	}

	async changeConfiguration(): Promise<void> {
		await this.invoke("onDidChangeConfiguration", { settings: {} });
	}

	/**
	 * Drain pending microtasks. Detached server work (`void` promises, scheduler
	 * callbacks) settles across several `await` boundaries, and unlike
	 * `setImmediate` this keeps working under installed fake timers.
	 */
	async settle(iterations = 5): Promise<void> {
		for (let i = 0; i < iterations; i++) {
			await Promise.resolve();
		}
	}

	async request(operation: "lint" | "format" | "fix", uri = this.uri) {
		return this.invoke<{ ok: boolean; issues?: number; error?: string }>(
			`tsqlrefine/${operation}Document`,
			{ uri },
		);
	}
}
