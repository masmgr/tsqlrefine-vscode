import * as assert from "node:assert";
import * as fc from "fast-check";
import { DocumentStateManager } from "../../server/state/documentStateManager";

const uri = "file:///test.sql";
const other = "file:///other.sql";

suite("DocumentStateManager", () => {
	suite("saved version tracking", () => {
		test("getSavedVersion returns undefined for an unknown uri", () => {
			assert.strictEqual(
				new DocumentStateManager().getSavedVersion(uri),
				undefined,
			);
		});

		test("setSavedVersion then getSavedVersion round-trips", () => {
			const manager = new DocumentStateManager();
			manager.setSavedVersion(uri, 7);

			assert.strictEqual(manager.getSavedVersion(uri), 7);
		});

		test("isSaved is false when no version was recorded", () => {
			assert.strictEqual(new DocumentStateManager().isSaved(uri, 1), false);
		});

		test("isSaved is false when the version differs", () => {
			const manager = new DocumentStateManager();
			manager.setSavedVersion(uri, 1);

			assert.strictEqual(manager.isSaved(uri, 2), false);
		});

		test("isSaved is true for a matching version", () => {
			const manager = new DocumentStateManager();
			manager.setSavedVersion(uri, 2);

			assert.strictEqual(manager.isSaved(uri, 2), true);
		});

		test("isSaved is true for version 0", () => {
			// Guards against an `undefined` check written as a falsy check, which
			// would treat the first version of a document as never saved.
			const manager = new DocumentStateManager();
			manager.setSavedVersion(uri, 0);

			assert.strictEqual(manager.isSaved(uri, 0), true);
		});

		test("clearSavedVersion drops the record", () => {
			const manager = new DocumentStateManager();
			manager.setSavedVersion(uri, 3);
			manager.clearSavedVersion(uri);

			assert.strictEqual(manager.getSavedVersion(uri), undefined);
			assert.strictEqual(manager.isSaved(uri, 3), false);
		});
	});

	suite("in-flight tracking", () => {
		test("setInFlight then getInFlight round-trips", () => {
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);

			assert.strictEqual(manager.getInFlight(uri), controller);
			assert.strictEqual(manager.isCurrentInFlight(uri, controller), true);
		});

		test("getInFlight returns undefined for an unknown uri", () => {
			assert.strictEqual(
				new DocumentStateManager().getInFlight(uri),
				undefined,
			);
		});

		test("isCurrentInFlight is false for a different controller", () => {
			const manager = new DocumentStateManager();
			manager.setInFlight(uri, new AbortController());

			assert.strictEqual(
				manager.isCurrentInFlight(uri, new AbortController()),
				false,
			);
		});

		test("isCurrentInFlight is false after clearInFlight", () => {
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);
			manager.clearInFlight(uri);

			assert.strictEqual(manager.isCurrentInFlight(uri, controller), false);
		});

		test("cancelInFlight aborts and removes the controller", () => {
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);
			assert.strictEqual(controller.signal.aborted, false);

			manager.cancelInFlight(uri);

			assert.strictEqual(controller.signal.aborted, true);
			assert.strictEqual(manager.getInFlight(uri), undefined);
		});

		test("cancelInFlight is a no-op for an unknown uri", () => {
			assert.doesNotThrow(() => new DocumentStateManager().cancelInFlight(uri));
		});

		test("clearInFlight does not abort the controller", () => {
			// The difference from cancelInFlight: an operation that completed
			// normally releases its slot without aborting itself.
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);
			manager.clearInFlight(uri);

			assert.strictEqual(controller.signal.aborted, false);
		});

		test("setInFlight replaces the previous controller without aborting it", () => {
			const manager = new DocumentStateManager();
			const first = new AbortController();
			const second = new AbortController();
			manager.setInFlight(uri, first);
			manager.setInFlight(uri, second);

			assert.strictEqual(manager.getInFlight(uri), second);
			assert.strictEqual(manager.isCurrentInFlight(uri, first), false);
			assert.strictEqual(first.signal.aborted, false);
		});
	});

	suite("isolation", () => {
		test("state is tracked per uri", () => {
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);
			manager.setSavedVersion(uri, 1);

			assert.strictEqual(manager.getInFlight(other), undefined);
			assert.strictEqual(manager.getSavedVersion(other), undefined);

			manager.clearAll(other);

			assert.strictEqual(manager.getInFlight(uri), controller);
			assert.strictEqual(manager.getSavedVersion(uri), 1);
		});
	});

	suite("clearAll", () => {
		test("aborts the in-flight controller and clears the saved version", () => {
			const manager = new DocumentStateManager();
			const controller = new AbortController();
			manager.setInFlight(uri, controller);
			manager.setSavedVersion(uri, 4);

			manager.clearAll(uri);

			assert.strictEqual(controller.signal.aborted, true);
			assert.strictEqual(manager.getInFlight(uri), undefined);
			assert.strictEqual(manager.getSavedVersion(uri), undefined);
		});
	});

	suite("Property-based tests", () => {
		test("property: a released controller is never reported as current", () => {
			const operations = fc.constantFrom(
				"set",
				"clear",
				"cancel",
				"clearAll",
			) as fc.Arbitrary<"set" | "clear" | "cancel" | "clearAll">;

			fc.assert(
				fc.property(
					fc.array(operations, { minLength: 1, maxLength: 20 }),
					(sequence) => {
						const manager = new DocumentStateManager();
						let latest: AbortController | null = null;

						for (const operation of sequence) {
							switch (operation) {
								case "set":
									latest = new AbortController();
									manager.setInFlight(uri, latest);
									break;
								case "clear":
									manager.clearInFlight(uri);
									latest = null;
									break;
								case "cancel":
									manager.cancelInFlight(uri);
									latest = null;
									break;
								case "clearAll":
									manager.clearAll(uri);
									latest = null;
									break;
							}

							if (latest === null) {
								assert.strictEqual(manager.getInFlight(uri), undefined);
							} else {
								assert.strictEqual(manager.getInFlight(uri), latest);
								assert.strictEqual(
									manager.isCurrentInFlight(uri, latest),
									true,
								);
							}
						}
					},
				),
			);
		});
	});
});
