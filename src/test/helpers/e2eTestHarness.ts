/**
 * E2E Test Harness for automating VS Code extension test setup and teardown.
 * Eliminates boilerplate and provides consistent test structure.
 */

import * as assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { type RemovalOptions, removeDirectory, sleep } from "./cleanup";
import type { FakeCli } from "./fakeCli";
import { TEST_DELAYS, TEST_TIMEOUTS } from "./testConstants";
import {
	applyTestConfig,
	createCustomFakeCli,
	createSqlDocument,
	createStandardFakeCli,
	createTestWorkspace,
	restoreTestConfig,
} from "./testFixtures";

/**
 * Context provided to E2E tests, containing all necessary test resources.
 */
export interface E2ETestContext {
	/** The workspace root URI */
	workspaceRoot: vscode.Uri;
	/** Temporary directory created for this test */
	tempDir: string;
	/** Fake CLI instance */
	fakeCli: FakeCli;
	/** SQL document opened for testing */
	document: vscode.TextDocument;
	/** Configuration snapshot for restoration */
	configSnapshot: Map<string, unknown | undefined>;
}

/**
 * Options for setting up an E2E test.
 */
export interface E2ETestOptions {
	/** Fake CLI rule name (creates standard fake CLI) */
	fakeCliRule?: string;
	/** Fake CLI severity level (default: "error") */
	fakeCliSeverity?: "error" | "warning";
	/** Custom fake CLI script body (mutually exclusive with fakeCliRule) */
	customCliScript?: string;
	/** VS Code configuration to apply */
	config?: Record<string, unknown>;
	/** Initial document content (default: "select 1;") */
	documentContent?: string;
	/** Document filename (default: "query.sql") */
	filename?: string;
}

/**
 * E2E Test Harness class that manages test lifecycle.
 * Handles setup, teardown, and provides helper methods for E2E tests.
 */
export class E2ETestHarness {
	private context: Partial<E2ETestContext> = {};
	private isSetup = false;

	/**
	 * Sets up the E2E test environment.
	 *
	 * @param options - Configuration options for the test
	 * @returns Fully initialized test context
	 */
	async setup(options: E2ETestOptions): Promise<E2ETestContext> {
		// Ensure extension is activated
		await activateExtension();

		// Create fake CLI
		if (options.customCliScript) {
			this.context.fakeCli = await createCustomFakeCli(options.customCliScript);
		} else if (options.fakeCliRule) {
			this.context.fakeCli = await createStandardFakeCli(
				options.fakeCliRule,
				options.fakeCliSeverity,
			);
		} else {
			throw new Error("Either fakeCliRule or customCliScript must be provided");
		}

		// Get workspace root
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
		assert.ok(workspaceRoot, "No workspace folder available for tests");
		this.context.workspaceRoot = workspaceRoot;

		// Create temporary workspace
		const { tempDir, createFile } = await createTestWorkspace(
			this.context.workspaceRoot,
		);
		this.context.tempDir = tempDir;

		// Create document
		const filename = options.filename ?? "query.sql";
		const content = options.documentContent ?? "select 1;";
		const documentUri = await createFile(filename, content);
		this.context.document = await createSqlDocument(documentUri, content);

		// Apply configuration
		const config = {
			path: this.context.fakeCli.commandPath,
			...options.config,
		};
		this.context.configSnapshot = await applyTestConfig(config);

		this.isSetup = true;

		return this.context as E2ETestContext;
	}

	/**
	 * Tears down the E2E test environment.
	 * Safe to call multiple times (idempotent).
	 */
	async teardown(): Promise<void> {
		if (!this.isSetup) {
			return;
		}

		// Restore configuration
		if (this.context.configSnapshot) {
			await restoreTestConfig(this.context.configSnapshot);
		}

		// Close all editors
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");

		// Cleanup fake CLI
		if (this.context.fakeCli) {
			await this.context.fakeCli.cleanup();
		}

		// Sleep to allow async operations to complete
		await sleep(TEST_DELAYS.CLEANUP_SLEEP);

		// Cleanup workspace
		await cleanupWorkspace(this.context.workspaceRoot);

		// Sleep again for file system to release handles
		await sleep(TEST_DELAYS.CLEANUP_SLEEP);

		// Remove temporary directory
		if (this.context.tempDir) {
			await removeDirectory(this.context.tempDir);
		}

		this.isSetup = false;
		this.context = {};
	}

	/**
	 * Waits for diagnostics matching the predicate.
	 *
	 * @param uri - Document URI to watch for diagnostics
	 * @param predicate - Function that returns true when desired diagnostics are present
	 * @param timeoutMs - Maximum time to wait (default: TEST_TIMEOUTS.DIAGNOSTICS_WAIT)
	 * @returns Array of diagnostics when predicate is satisfied
	 */
	async waitForDiagnostics(
		uri: vscode.Uri,
		predicate: (diagnostics: vscode.Diagnostic[]) => boolean,
		timeoutMs = TEST_TIMEOUTS.DIAGNOSTICS_WAIT,
	): Promise<vscode.Diagnostic[]> {
		// Check if predicate is already satisfied
		const existing = vscode.languages.getDiagnostics(uri);
		if (predicate(existing)) {
			return existing;
		}

		// Wait for diagnostics change event
		return await new Promise((resolve) => {
			let subscription: vscode.Disposable | null = null;
			const timeout = setTimeout(() => {
				subscription?.dispose();
				resolve(vscode.languages.getDiagnostics(uri));
			}, timeoutMs);

			subscription = vscode.languages.onDidChangeDiagnostics((event) => {
				if (
					!event.uris.some((changed) => changed.toString() === uri.toString())
				) {
					return;
				}
				const current = vscode.languages.getDiagnostics(uri);
				if (!predicate(current)) {
					return;
				}
				clearTimeout(timeout);
				subscription?.dispose();
				resolve(current);
			});
		});
	}
}

/**
 * Runs an E2E test with automatic setup and teardown.
 * This is the preferred way to write E2E tests.
 *
 * @param options - Test configuration options
 * @param testFn - Test function that receives context and harness
 *
 * @example
 * test("my test", async function () {
 *   this.timeout(TEST_TIMEOUTS.MOCHA_TEST);
 *
 *   await runE2ETest(
 *     {
 *       fakeCliRule: 'MyRule',
 *       config: { runOnSave: true },
 *     },
 *     async (context, harness) => {
 *       // Test implementation
 *     }
 *   );
 * });
 */
export async function runE2ETest(
	options: E2ETestOptions,
	testFn: (context: E2ETestContext, harness: E2ETestHarness) => Promise<void>,
): Promise<void> {
	const harness = new E2ETestHarness();
	try {
		const context = await harness.setup(options);
		await testFn(context, harness);
	} finally {
		await harness.teardown();
	}
}

/**
 * Activates the tsqllint-lite extension and waits for client to be ready.
 * Should be called once at the beginning of the test suite or in each test.
 */
export async function activateExtension(): Promise<void> {
	const extension = vscode.extensions.all.find(
		(ext) => ext.packageJSON?.name === "tsqllint-lite",
	);
	assert.ok(extension, "Extension tsqllint-lite not found");

	const api = (await extension.activate()) as { clientReady?: Promise<void> };
	const clientReady = api.clientReady;
	if (clientReady) {
		await clientReady;
	}
}

/**
 * Cleans up VS Code workspace test artifacts.
 * Removes .vscode directory and tsqllint-workspace-* temporary directories.
 *
 * @param workspaceRoot - The workspace root URI, or undefined if no workspace
 * @param options - Cleanup options
 */
export async function cleanupWorkspace(
	workspaceRoot: vscode.Uri | undefined,
	options: RemovalOptions = {},
): Promise<void> {
	if (!workspaceRoot) {
		return;
	}

	const workspacePath = workspaceRoot.fsPath;

	// Clean up .vscode directory
	const vscodeDir = vscode.Uri.joinPath(workspaceRoot, ".vscode");
	try {
		await vscode.workspace.fs.delete(vscodeDir, { recursive: true });
	} catch {
		// Ignore errors if directory doesn't exist
	}

	// Clean up any remaining tsqllint-workspace-* directories
	try {
		const entries = await fs.readdir(workspacePath);
		for (const entry of entries) {
			if (entry.startsWith("tsqllint-workspace-")) {
				const fullPath = path.join(workspacePath, entry);
				await removeDirectory(fullPath, options);
			}
		}
	} catch {
		// Ignore errors if workspace root doesn't exist
	}
}
