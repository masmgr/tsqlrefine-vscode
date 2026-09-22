import type {
	Connection,
	PublishDiagnosticsParams,
	WorkspaceEdit,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
	defaultSettings,
	type TsqlRefineSettings,
} from "../../server/config/settings";
import type { DocumentContext } from "../../server/shared/documentContext";
import type { OperationControl } from "../../server/shared/operationExecution";
import { NotificationManager } from "../../server/state/notificationManager";

/**
 * Test doubles for the operation layer (`executeLint` / `executeFormat` /
 * `executeFix` / `executeCliEditOperation`), which take a `DocumentContext` and
 * a dependency bag rather than a full LSP connection.
 *
 * `ServerHarness` covers the layer above this one: it boots `registerServer`
 * and drives real LSP notifications.
 */

/**
 * Settings for a test, based on `defaultSettings` so a new setting cannot be
 * silently missing from the fixture.
 */
export function createTestSettings(
	overrides: Partial<TsqlRefineSettings> = {},
): TsqlRefineSettings {
	return { ...defaultSettings, ...overrides };
}

/**
 * A real TextDocument. `TextDocument.create` gives correct `getText(range)`,
 * `offsetAt` and `positionAt` behaviour, which a hand-written fake does not.
 */
export function createTestDocument(
	options: {
		uri?: string;
		languageId?: string;
		version?: number;
		text?: string;
	} = {},
): TextDocument {
	return TextDocument.create(
		options.uri ?? "file:///test.sql",
		options.languageId ?? "sql",
		options.version ?? 1,
		options.text ?? "SELECT 1;",
	);
}

export function createTestContext(
	overrides: Partial<DocumentContext> = {},
): DocumentContext {
	return {
		uri: "file:///test.sql",
		filePath: "/test.sql",
		workspaceRoot: "/workspace",
		cwd: "/workspace",
		effectiveSettings: createTestSettings(),
		effectiveConfigPath: undefined,
		documentText: "SELECT 1;",
		isSavedFile: true,
		...overrides,
	};
}

export type RecordedConnection = {
	connection: Connection;
	/** Messages passed to `window.showWarningMessage`. */
	warnings: string[];
	informations: string[];
	console: {
		debug: string[];
		log: string[];
		warn: string[];
		error: string[];
	};
	diagnostics: PublishDiagnosticsParams[];
	notifications: Array<{ method: string; params: unknown }>;
	edits: WorkspaceEdit[];
	/**
	 * Replace what `showWarningMessage` resolves to, so a test can simulate the
	 * user pressing an action button (or never dismissing the popup at all).
	 */
	setWarningResponse(
		respond: (message: string) => Promise<{ title: string } | undefined>,
	): void;
};

export function createTestConnection(): RecordedConnection {
	const warnings: string[] = [];
	const informations: string[] = [];
	const consoleCalls = {
		debug: [] as string[],
		log: [] as string[],
		warn: [] as string[],
		error: [] as string[],
	};
	const diagnostics: PublishDiagnosticsParams[] = [];
	const notifications: Array<{ method: string; params: unknown }> = [];
	const edits: WorkspaceEdit[] = [];
	let respond: (message: string) => Promise<{ title: string } | undefined> =
		async () => undefined;

	const connection = {
		sendDiagnostics: (params: PublishDiagnosticsParams) => {
			diagnostics.push(params);
		},
		sendNotification: (method: string, params?: unknown) => {
			notifications.push({ method, params });
		},
		console: {
			debug: (message: string) => consoleCalls.debug.push(message),
			log: (message: string) => consoleCalls.log.push(message),
			warn: (message: string) => consoleCalls.warn.push(message),
			error: (message: string) => consoleCalls.error.push(message),
		},
		window: {
			showWarningMessage: (message: string) => {
				warnings.push(message);
				return respond(message);
			},
			showInformationMessage: (message: string) => {
				informations.push(message);
				return Promise.resolve(undefined);
			},
		},
		workspace: {
			applyEdit: (edit: WorkspaceEdit) => {
				edits.push(edit);
				return Promise.resolve({ applied: true });
			},
		},
	} as unknown as Connection;

	return {
		connection,
		warnings,
		informations,
		console: consoleCalls,
		diagnostics,
		notifications,
		edits,
		setWarningResponse(next) {
			respond = next;
		},
	};
}

/**
 * An `OperationControl` whose staleness gate is a function, so a test can open
 * and close it per call (e.g. `let n = 0; isCurrent: () => ++n < 2`) to hit each
 * of the guards an operation performs around its CLI run.
 */
export function createOperationControl(
	overrides: { isCurrent?: () => boolean; controller?: AbortController } = {},
): { control: OperationControl; controller: AbortController } {
	const controller = overrides.controller ?? new AbortController();
	return {
		controller,
		control: {
			signal: controller.signal,
			isCurrent: overrides.isCurrent ?? (() => true),
		},
	};
}

/**
 * The dependency bag every operation takes, wired to a recording connection.
 *
 * The `NotificationManager` is the real class rather than a fake: its cooldown
 * logic, lazy debug gating and stderr routing are part of what the operation
 * tests assert, and a fake would need an `as unknown as` cast to type-check.
 */
export function createOperationDeps(
	overrides: {
		isCurrent?: () => boolean;
		controller?: AbortController;
		debug?: boolean;
	} = {},
): RecordedConnection & {
	notificationManager: NotificationManager;
	control: OperationControl;
	controller: AbortController;
} {
	const recorded = createTestConnection();
	const notificationManager = new NotificationManager(recorded.connection);
	if (overrides.debug) {
		notificationManager.setDebugEnabled(true);
	}
	const { control, controller } = createOperationControl(overrides);
	return { ...recorded, notificationManager, control, controller };
}
