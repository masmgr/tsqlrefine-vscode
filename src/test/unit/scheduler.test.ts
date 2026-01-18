import * as assert from "node:assert";
import {
	LintScheduler,
	type PendingLint,
	type LintReason,
} from "../../server/lint/scheduler";

/**
 * Helper to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Helper to create a mock runLint function that tracks calls
 */
function createMockRunLint() {
	const calls: Array<{ uri: string; pending: PendingLint }> = [];
	const runLint = async (
		uri: string,
		pending: PendingLint,
	): Promise<number> => {
		calls.push({ uri, pending });
		return pending.version ?? 0;
	};
	return { runLint, calls };
}

/**
 * Helper to create a mock getDocumentVersion function
 */
function createMockGetVersion(versions: Map<string, number | null>) {
	return (uri: string): number | null => {
		return versions.get(uri) ?? null;
	};
}

suite("scheduler", () => {
	suite("Semaphore", () => {
		// Note: Semaphore is private, so we test it through LintScheduler behavior

		test("allows concurrent runs up to maxConcurrentRuns", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 2,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					await sleep(20); // Simulate async work
					return runLint(uri, pending);
				},
			});

			// Start 2 concurrent lints
			scheduler.requestLint("file1.sql", "save", 1);
			scheduler.requestLint("file2.sql", "save", 1);

			// Wait for both to complete
			await sleep(100);

			assert.strictEqual(calls.length, 2);
			assert.ok(calls.some((c) => c.uri === "file1.sql"));
			assert.ok(calls.some((c) => c.uri === "file2.sql"));
		});

		test("queues when all slots are occupied", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 1],
				["file3.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					await sleep(50);
					return runLint(uri, pending);
				},
			});

			// Start 3 lints with maxConcurrentRuns=1
			scheduler.requestLint("file1.sql", "save", 1);
			scheduler.requestLint("file2.sql", "save", 1);
			scheduler.requestLint("file3.sql", "save", 1);

			// Wait for all to complete
			await sleep(200);

			assert.strictEqual(calls.length, 3);
		});

		test("enforces minimum of 1 slot even with maxConcurrentRuns=0", async () => {
			const versions = new Map([["file1.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 0, // Should become 1
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			await scheduler.requestLint("file1.sql", "save", 1);

			assert.strictEqual(calls.length, 1);
		});
	});

	suite("LintScheduler", () => {
		test("calls runLint when slot available immediately", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			await scheduler.requestLint("file.sql", "save", 1);

			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0]?.uri, "file.sql");
			assert.strictEqual(calls[0]?.pending.reason, "save");
			assert.strictEqual(calls[0]?.pending.version, 1);
		});

		test("queues lint when all slots are occupied", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();
			let file1Resolve: (() => void) | undefined;
			const file1Promise = new Promise<void>((resolve) => {
				file1Resolve = resolve;
			});

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					if (uri === "file1.sql") {
						await sleep(10); // Give time for file2 to queue
						await file1Promise; // Block until we release
					}
					return runLint(uri, pending);
				},
			});

			// Start file1 (blocks)
			scheduler.requestLint("file1.sql", "save", 1);
			await sleep(20);

			// Start file2 (should queue)
			scheduler.requestLint("file2.sql", "save", 1);
			await sleep(20);

			// Only file1 should have started executing
			assert.strictEqual(calls.length, 0); // Still blocked

			// Release file1
			if (file1Resolve) {
				file1Resolve();
			}
			await sleep(100);

			// Now both should have run
			assert.strictEqual(calls.length, 2);
			assert.strictEqual(calls[0]?.uri, "file1.sql");
			assert.strictEqual(calls[1]?.uri, "file2.sql");
		});

		test("debounces 'type' reason with specified delay", async () => {
			const versions = new Map([["file.sql", 3]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Rapid type events
			scheduler.requestLint("file.sql", "type", 1, 100);
			await sleep(30);
			scheduler.requestLint("file.sql", "type", 2, 100);
			await sleep(30);
			scheduler.requestLint("file.sql", "type", 3, 100);

			// Should not run immediately
			await sleep(50);
			assert.strictEqual(calls.length, 0);

			// Wait for debounce
			await sleep(80);

			// Should run once with latest pending version
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0]?.pending.version, 3);
		});

		test("does not debounce 'save' reason", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			scheduler.requestLint("file.sql", "save", 1);

			// Should run immediately without debounce
			await sleep(10);
			assert.strictEqual(calls.length, 1);
		});

		test("does not debounce 'open' reason", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			scheduler.requestLint("file.sql", "open", 1);

			// Should run immediately
			await sleep(10);
			assert.strictEqual(calls.length, 1);
		});

		test("manual reason bypasses queue and waits for slot", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();
			let file1Resolve: (() => void) | undefined;
			const file1Promise = new Promise<void>((resolve) => {
				file1Resolve = resolve;
			});

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					if (uri === "file1.sql") {
						await file1Promise;
					}
					return runLint(uri, pending);
				},
			});

			// Start file1 (blocks)
			scheduler.requestLint("file1.sql", "save", 1);
			await sleep(10);

			// Manual should wait, not queue
			const manualPromise = scheduler.requestLint("file2.sql", "manual", 1);

			// Release file1
			if (file1Resolve) {
				file1Resolve();
			}
			await manualPromise;

			// Manual should have run
			assert.strictEqual(calls.length, 2);
			assert.strictEqual(calls[1]?.uri, "file2.sql");
			assert.strictEqual(calls[1]?.pending.reason, "manual");
		});

		test("clears debounce timer on manual request", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Start type with debounce
			scheduler.requestLint("file.sql", "type", 1, 100);
			await sleep(30);

			// Manual should clear the debounce timer
			await scheduler.requestLint("file.sql", "manual", 2);

			// Manual should have run immediately
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0]?.pending.reason, "manual");

			// Wait for original debounce period
			await sleep(100);

			// Should still be only 1 call (debounce was cleared)
			assert.strictEqual(calls.length, 1);
		});

		test("updates pending version when document changes during queue", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();
			let file1Resolve: (() => void) | undefined;
			const file1Promise = new Promise<void>((resolve) => {
				file1Resolve = resolve;
			});

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: (uri) => versions.get(uri) ?? null,
				runLint: async (uri, pending) => {
					if (uri === "file1.sql") {
						await sleep(20); // Give time for version update
						await file1Promise;
					}
					return runLint(uri, pending);
				},
			});

			// Block slot with file1
			scheduler.requestLint("file1.sql", "save", 1);
			await sleep(30);

			// Queue file.sql with version 1
			scheduler.requestLint("file.sql", "save", 1);
			await sleep(10);

			// Update document version before file1 completes
			versions.set("file.sql", 2);

			// Release file1
			if (file1Resolve) {
				file1Resolve();
			}
			await sleep(150);

			// file.sql should have run with updated version 2
			const fileSqlCalls = calls.filter((c) => c.uri === "file.sql");
			assert.strictEqual(fileSqlCalls.length, 1);
			assert.strictEqual(fileSqlCalls[0]?.pending.version, 2);
		});

		test("runs lint with current version when forceLatestVersion=true (manual)", async () => {
			const versions = new Map([["file.sql", 2]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Request with version 1, but current is 2
			await scheduler.requestLint("file.sql", "manual", 1);

			// Manual uses forceLatestVersion=true, so should use current version 2
			assert.strictEqual(calls.length, 1);
			assert.strictEqual(calls[0]?.pending.version, 2);
		});

		test("skips lint when document is closed (version=null)", async () => {
			const versions = new Map([["file.sql", null]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			await scheduler.requestLint("file.sql", "save", 1);

			// Should not run if document version is null
			assert.strictEqual(calls.length, 0);
		});

		test("clear() removes from queue and clears debounce timer", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Start type with debounce
			scheduler.requestLint("file.sql", "type", 1, 100);
			await sleep(30);

			// Clear before debounce fires
			scheduler.clear("file.sql");

			// Wait for debounce period
			await sleep(100);

			// Should not have run
			assert.strictEqual(calls.length, 0);
		});

		test("does not queue same URI multiple times", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 3],
			]);
			const { runLint, calls } = createMockRunLint();
			let file1Resolve: (() => void) | undefined;
			const file1Promise = new Promise<void>((resolve) => {
				file1Resolve = resolve;
			});

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					if (uri === "file1.sql") {
						await sleep(20); // Give time for multiple requests
						await file1Promise;
					}
					return runLint(uri, pending);
				},
			});

			// Block with file1
			scheduler.requestLint("file1.sql", "save", 1);
			await sleep(30);

			// Queue file2 multiple times (should only queue once)
			scheduler.requestLint("file2.sql", "save", 1);
			scheduler.requestLint("file2.sql", "save", 2);
			scheduler.requestLint("file2.sql", "save", 3);

			// Release file1
			if (file1Resolve) {
				file1Resolve();
			}
			await sleep(100);

			// file2 should only run once with latest pending version
			const file2Calls = calls.filter((c) => c.uri === "file2.sql");
			assert.strictEqual(file2Calls.length, 1);
			assert.strictEqual(file2Calls[0]?.pending.version, 3);
		});

		test("handles runLint throwing errors gracefully", async () => {
			const versions = new Map([["file.sql", 1]]);
			const calls: string[] = [];

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, _pending) => {
					calls.push(uri);
					throw new Error("Simulated error");
				},
			});

			// Should not throw - error is caught internally
			try {
				await scheduler.requestLint("file.sql", "manual", 1);
			} catch (error) {
				// Manual returns the promise, so error may bubble up
				// This is expected behavior
			}

			// runLint was called despite error
			assert.strictEqual(calls.length, 1);
		});

		test("draining flag prevents concurrent drain operations", async () => {
			const versions = new Map([
				["file1.sql", 1],
				["file2.sql", 1],
				["file3.sql", 1],
			]);
			const { runLint, calls } = createMockRunLint();
			let file1Resolve: (() => void) | undefined;
			const file1Promise = new Promise<void>((resolve) => {
				file1Resolve = resolve;
			});

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 1,
				getDocumentVersion: createMockGetVersion(versions),
				runLint: async (uri, pending) => {
					if (uri === "file1.sql") {
						await file1Promise;
					}
					return runLint(uri, pending);
				},
			});

			// Block with file1
			scheduler.requestLint("file1.sql", "save", 1);
			await sleep(10);

			// Queue file2 and file3
			scheduler.requestLint("file2.sql", "save", 1);
			scheduler.requestLint("file3.sql", "save", 1);

			// Release file1 (triggers drain)
			if (file1Resolve) {
				file1Resolve();
			}
			await sleep(150);

			// All should have run exactly once
			assert.strictEqual(calls.length, 3);
		});

		test("handles version=null in pending lint", async () => {
			const versions = new Map([["file.sql", 5]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Request with null version (should use current version)
			await scheduler.requestLint("file.sql", "save", null);

			assert.strictEqual(calls.length, 1);
			// With null version, it runs with the pending version (null)
			assert.strictEqual(calls[0]?.pending.version, null);
		});

		test("respects zero debounce delay", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Type with 0ms debounce (should still use setTimeout, but immediate)
			scheduler.requestLint("file.sql", "type", 1, 0);

			// Should run very quickly
			await sleep(10);
			assert.strictEqual(calls.length, 1);
		});

		test("handles negative debounce delay as zero", async () => {
			const versions = new Map([["file.sql", 1]]);
			const { runLint, calls } = createMockRunLint();

			const scheduler = new LintScheduler({
				maxConcurrentRuns: 4,
				getDocumentVersion: createMockGetVersion(versions),
				runLint,
			});

			// Type with negative debounce (should be treated as 0)
			scheduler.requestLint("file.sql", "type", 1, -100);

			await sleep(10);
			assert.strictEqual(calls.length, 1);
		});
	});
});
