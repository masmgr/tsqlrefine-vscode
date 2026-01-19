import * as assert from "node:assert";
import type { LanguageClient } from "vscode-languageclient/node";
import { URI } from "vscode-uri";
import {
	handleDidDeleteFiles,
	handleDidRenameFiles,
} from "../../client/handlers";

/**
 * Notification tracking type for mock client.
 */
interface NotificationRecord {
	method: string;
	params: unknown;
}

/**
 * Mock LanguageClient with notification tracking.
 */
interface MockLanguageClient extends LanguageClient {
	__notifications: NotificationRecord[];
}

/**
 * Creates a mock LanguageClient for testing with notification tracking.
 *
 * @returns Mock LanguageClient that tracks all sendNotification calls
 */
function createMockLanguageClient(): MockLanguageClient {
	const notifications: NotificationRecord[] = [];

	const mockClient = {
		sendNotification(method: string, params: unknown) {
			notifications.push({ method, params });
		},
		__notifications: notifications,
	} as MockLanguageClient;

	return mockClient;
}

/**
 * Creates a mock LanguageClient with custom sendNotification behavior.
 *
 * @param customSendNotification - Custom implementation for sendNotification
 * @returns Mock LanguageClient with custom behavior
 */
function createMockLanguageClientWithBehavior(
	customSendNotification: (method: string, params: unknown) => void,
): MockLanguageClient {
	const notifications: NotificationRecord[] = [];

	const mockClient = {
		sendNotification(method: string, params: unknown) {
			customSendNotification(method, params);
			notifications.push({ method, params });
		},
		__notifications: notifications,
	} as MockLanguageClient;

	return mockClient;
}

/**
 * Gets notifications sent to mock client.
 *
 * @param client - Mock LanguageClient instance
 * @returns Array of notifications sent to the client
 */
function getMockNotifications(
	client: MockLanguageClient,
): NotificationRecord[] {
	return client.__notifications;
}

suite("handlers", () => {
	suite("handleDidDeleteFiles", () => {
		test("sends clearDiagnostics notification with deleted URIs", async () => {
			const deletedUris = [
				URI.file("/path/to/file1.sql"),
				URI.file("/path/to/file2.sql"),
			];

			const mockClient = createMockLanguageClient();

			const event = {
				files: deletedUris,
			};

			await handleDidDeleteFiles(event, mockClient, Promise.resolve());

			const notifications = getMockNotifications(mockClient);
			assert.strictEqual(notifications.length, 1);
			assert.strictEqual(notifications[0]?.method, "tsqllint/clearDiagnostics");
			assert.deepStrictEqual(notifications[0]?.params, {
				uris: deletedUris.map((uri) => uri.toString()),
			});
		});

		test("does nothing when client is undefined", async () => {
			const event = {
				files: [URI.file("/path/to/file.sql")],
			};

			// Should not throw
			await handleDidDeleteFiles(event, undefined, Promise.resolve());
		});

		test("waits for clientReady before sending notification", async () => {
			let readyResolved = false;
			const clientReady = new Promise<void>((resolve) => {
				setTimeout(() => {
					readyResolved = true;
					resolve();
				}, 10);
			});

			const mockClient = createMockLanguageClientWithBehavior(
				(_method: string, _params: unknown) => {
					assert.ok(
						readyResolved,
						"Client should be ready before sending notification",
					);
				},
			);

			const event = {
				files: [URI.file("/path/to/file.sql")],
			};

			await handleDidDeleteFiles(event, mockClient, clientReady);

			const notifications = getMockNotifications(mockClient);
			assert.strictEqual(notifications.length, 1);
		});
	});

	suite("handleDidRenameFiles", () => {
		test("sends clearDiagnostics notification with old URIs", async () => {
			const oldUris = [
				URI.file("/path/to/old1.sql"),
				URI.file("/path/to/old2.sql"),
			];
			const newUris = [
				URI.file("/path/to/new1.sql"),
				URI.file("/path/to/new2.sql"),
			];

			const mockClient = createMockLanguageClient();

			const event = {
				files: oldUris.map((oldUri, i) => ({
					oldUri,
					newUri: newUris[i] ?? URI.file(""),
				})),
			};

			await handleDidRenameFiles(event, mockClient, Promise.resolve());

			const notifications = getMockNotifications(mockClient);
			assert.strictEqual(notifications.length, 1);
			assert.strictEqual(notifications[0]?.method, "tsqllint/clearDiagnostics");
			assert.deepStrictEqual(notifications[0]?.params, {
				uris: oldUris.map((uri) => uri.toString()),
			});
		});

		test("does nothing when client is undefined", async () => {
			const event = {
				files: [
					{
						oldUri: URI.file("/path/to/old.sql"),
						newUri: URI.file("/path/to/new.sql"),
					},
				],
			};

			// Should not throw
			await handleDidRenameFiles(event, undefined, Promise.resolve());
		});

		test("waits for clientReady before sending notification", async () => {
			let readyResolved = false;
			const clientReady = new Promise<void>((resolve) => {
				setTimeout(() => {
					readyResolved = true;
					resolve();
				}, 10);
			});

			const mockClient = createMockLanguageClientWithBehavior(() => {
				assert.ok(
					readyResolved,
					"Client should be ready before sending notification",
				);
			});

			const event = {
				files: [
					{
						oldUri: URI.file("/path/to/old.sql"),
						newUri: URI.file("/path/to/new.sql"),
					},
				],
			};

			await handleDidRenameFiles(event, mockClient, clientReady);

			const notifications = getMockNotifications(mockClient);
			assert.strictEqual(notifications.length, 1);
		});
	});
});
