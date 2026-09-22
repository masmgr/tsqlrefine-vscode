import * as assert from "node:assert";
import type * as vscode from "vscode";
import { URI } from "vscode-uri";
import type * as StatusBarModule from "../../client/statusBar";
import { loadWithMocks } from "../helpers/moduleMocks";

type FakeDiagnostic = { source: string; severity: number };

/** Severity values must match vscode's: Error=0, Warning=1, Information=2, Hint=3. */
const severity = { Error: 0, Warning: 1, Information: 2, Hint: 3 } as const;

function diag(
	level: keyof typeof severity,
	source = "tsqlrefine",
): FakeDiagnostic {
	return { source, severity: severity[level] };
}

function createHarness(diagnostics: [URI, FakeDiagnostic[]][] = []) {
	const item = {
		text: "",
		tooltip: "" as string | undefined,
		command: "",
		shown: 0,
		disposed: 0,
		show() {
			this.shown++;
		},
		dispose() {
			this.disposed++;
		},
	};
	const created: Array<{ alignment: number; priority: number }> = [];
	const subscriptions: Array<{ dispose(): void }> = [];

	const fakeVscode = {
		Uri: URI,
		StatusBarAlignment: { Left: 1, Right: 2 },
		DiagnosticSeverity: severity,
		window: {
			createStatusBarItem: (alignment: number, priority: number) => {
				created.push({ alignment, priority });
				return item;
			},
		},
		languages: {
			getDiagnostics: (uri?: URI) =>
				uri
					? (diagnostics.find(
							([entryUri]) => entryUri.toString() === uri.toString(),
						)?.[1] ?? [])
					: diagnostics,
		},
	};

	const filename = require.resolve("../../client/statusBar");
	delete require.cache[filename];
	const module = loadWithMocks<typeof StatusBarModule>(filename, {
		vscode: fakeVscode,
	});

	return {
		manager: new module.StatusBarManager(),
		context: { subscriptions } as unknown as vscode.ExtensionContext,
		item,
		created,
		subscriptions,
		/** Replace the diagnostics the fake `vscode.languages` reports. */
		setDiagnostics(next: [URI, FakeDiagnostic[]][]) {
			diagnostics.length = 0;
			diagnostics.push(...next);
		},
		dispose() {
			delete require.cache[filename];
		},
	};
}

const fileA = URI.file("/ws/a.sql");
const fileB = URI.file("/ws/b.sql");

suite("StatusBarManager", () => {
	let h: ReturnType<typeof createHarness>;

	teardown(() => {
		h?.dispose();
	});

	suite("initialize", () => {
		test("creates the item at Left/100 with the problems command and shows it", () => {
			h = createHarness();
			h.manager.initialize(h.context);

			assert.deepStrictEqual(h.created, [{ alignment: 1, priority: 100 }]);
			assert.strictEqual(h.item.command, "workbench.action.problems.focus");
			assert.strictEqual(h.item.shown, 1);
			assert.strictEqual(h.subscriptions.length, 1);
		});

		test("counts existing tsqlrefine diagnostics on startup", () => {
			h = createHarness([
				[fileA, [diag("Error"), diag("Error"), diag("Warning")]],
			]);
			h.manager.initialize(h.context);

			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 2E 1W");
		});

		test("ignores diagnostics from other sources", () => {
			h = createHarness([
				[fileA, [diag("Error", "mssql"), diag("Warning", "sqlfluff")]],
			]);
			h.manager.initialize(h.context);

			assert.strictEqual(h.item.text, "$(check) TSQLRefine");
		});

		test("counts every severity level", () => {
			h = createHarness([
				[fileA, [diag("Error"), diag("Warning"), diag("Information")]],
				[fileB, [diag("Hint"), diag("Hint")]],
			]);
			h.manager.initialize(h.context);

			assert.strictEqual(
				h.item.tooltip,
				"TSQLRefine\nErrors: 1\nWarnings: 1\nInfo: 1\nHints: 2",
			);
		});
	});

	suite("updateDiagnostics", () => {
		test("recounts only the uris passed in", () => {
			h = createHarness([
				[fileA, [diag("Error")]],
				[fileB, [diag("Warning")]],
			]);
			h.manager.initialize(h.context);
			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 1E 1W");

			// fileA gains an error; fileB is untouched and must keep its tally.
			h.setDiagnostics([
				[fileA, [diag("Error"), diag("Error")]],
				[fileB, [diag("Warning")]],
			]);
			h.manager.updateDiagnostics([fileA as unknown as vscode.Uri]);

			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 2E 1W");
		});

		test("removes a uri from the tally when its diagnostics become empty", () => {
			h = createHarness([
				[fileA, [diag("Error")]],
				[fileB, [diag("Warning")]],
			]);
			h.manager.initialize(h.context);

			h.setDiagnostics([
				[fileA, []],
				[fileB, [diag("Warning")]],
			]);
			h.manager.updateDiagnostics([fileA as unknown as vscode.Uri]);

			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 1W");
		});

		test("recounts everything when called without uris", () => {
			h = createHarness([[fileA, [diag("Error")]]]);
			h.manager.initialize(h.context);

			// A full recount must reset the running totals rather than add to them.
			h.manager.updateDiagnostics();
			h.manager.updateDiagnostics();

			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 1E");
			assert.strictEqual(
				h.item.tooltip,
				"TSQLRefine\nErrors: 1\nWarnings: 0\nInfo: 0\nHints: 0",
			);
		});
	});

	suite("setOperationState", () => {
		test("shows the spinner while an operation is running", () => {
			h = createHarness([[fileA, [diag("Error")]]]);
			h.manager.initialize(h.context);

			h.manager.setOperationState("started");
			assert.strictEqual(h.item.text, "$(sync~spin) TSQLRefine");

			h.manager.setOperationState("completed");
			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 1E");
		});

		test("does not go negative when completed fires more often than started", () => {
			h = createHarness();
			h.manager.initialize(h.context);

			h.manager.setOperationState("completed");
			h.manager.setOperationState("completed");
			h.manager.setOperationState("started");

			// A single started must still show the spinner despite the extra
			// completions, i.e. the running count never dropped below zero.
			assert.strictEqual(h.item.text, "$(sync~spin) TSQLRefine");
		});
	});

	suite("setDisabled", () => {
		test("renders the disabled text and restores it when re-enabled", () => {
			h = createHarness([[fileA, [diag("Error")]]]);
			h.manager.initialize(h.context);

			h.manager.setDisabled(true);
			assert.strictEqual(h.item.text, "$(circle-slash) TSQLRefine: Off");

			h.manager.setDisabled(false);
			assert.strictEqual(h.item.text, "$(warning) TSQLRefine: 1E");
		});
	});

	suite("before initialize", () => {
		test("updates are no-ops until the status bar item exists", () => {
			h = createHarness([[fileA, [diag("Error")]]]);

			assert.doesNotThrow(() => {
				h.manager.setDisabled(true);
				h.manager.setOperationState("started");
				h.manager.updateDiagnostics([fileA as unknown as vscode.Uri]);
				h.manager.updateDiagnostics();
			});
			assert.strictEqual(h.item.text, "");
			assert.strictEqual(h.item.shown, 0);
		});
	});
});
