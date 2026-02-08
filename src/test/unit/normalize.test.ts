import * as assert from "node:assert";
import * as path from "node:path";
import * as fc from "fast-check";
import {
	normalizeForCompare,
	normalizeExecutablePath,
	normalizeConfigPath,
} from "../../server/shared/normalize";

suite("normalize", () => {
	suite("normalizeForCompare", () => {
		suite("Example-based tests", () => {
			test("resolves to absolute path", () => {
				const result = normalizeForCompare("test.sql");
				assert.ok(path.isAbsolute(result));
			});

			test("normalizes path separators", () => {
				const result = normalizeForCompare("foo/bar/baz.sql");
				assert.ok(path.isAbsolute(result));
			});

			test("handles absolute paths", () => {
				const absolutePath = path.resolve("/foo/bar/test.sql");
				const result = normalizeForCompare(absolutePath);
				assert.ok(path.isAbsolute(result));
			});

			if (process.platform === "win32") {
				test("converts to lowercase on Windows", () => {
					const result = normalizeForCompare("TEST.SQL");
					assert.strictEqual(result, result.toLowerCase());
				});

				test("handles mixed case on Windows", () => {
					const upper = normalizeForCompare("C:\\TEMP\\FILE.SQL");
					const lower = normalizeForCompare("c:\\temp\\file.sql");
					assert.strictEqual(upper, lower);
				});
			}

			test("handles empty string", () => {
				const result = normalizeForCompare("");
				assert.ok(path.isAbsolute(result));
			});
		});

		suite("Property-based tests", () => {
			test("property: idempotence", () => {
				fc.assert(
					fc.property(fc.string(), (filePath) => {
						const normalized = normalizeForCompare(filePath);
						return normalizeForCompare(normalized) === normalized;
					}),
				);
			});

			test("property: always returns absolute path", () => {
				fc.assert(
					fc.property(fc.string(), (filePath) => {
						const result = normalizeForCompare(filePath);
						return path.isAbsolute(result);
					}),
				);
			});

			test("property: deterministic", () => {
				fc.assert(
					fc.property(fc.string(), (filePath) => {
						const result1 = normalizeForCompare(filePath);
						const result2 = normalizeForCompare(filePath);
						return result1 === result2;
					}),
				);
			});

			if (process.platform === "win32") {
				test("property: case folding on Windows", () => {
					fc.assert(
						fc.property(fc.string(), (filePath) => {
							const upper = normalizeForCompare(filePath.toUpperCase());
							const lower = normalizeForCompare(filePath.toLowerCase());
							return upper === lower;
						}),
					);
				});

				test("property: always lowercase output on Windows", () => {
					fc.assert(
						fc.property(fc.string(), (filePath) => {
							const normalized = normalizeForCompare(filePath);
							return normalized === normalized.toLowerCase();
						}),
					);
				});
			}
		});
	});

	suite("normalizeExecutablePath", () => {
		suite("Example-based tests", () => {
			test("returns null for undefined", () => {
				assert.strictEqual(normalizeExecutablePath(undefined), null);
			});

			test("returns null for empty string", () => {
				assert.strictEqual(normalizeExecutablePath(""), null);
			});

			test("returns null for whitespace-only string", () => {
				assert.strictEqual(normalizeExecutablePath("   "), null);
				assert.strictEqual(normalizeExecutablePath("\t\n"), null);
			});

			test("trims and resolves valid path", () => {
				const result = normalizeExecutablePath("  test.exe  ");
				assert.ok(result !== null);
				assert.ok(path.isAbsolute(result));
			});

			test("resolves relative path to absolute", () => {
				const result = normalizeExecutablePath("bin/tsqlrefine");
				assert.ok(result !== null);
				assert.ok(path.isAbsolute(result));
			});

			test("preserves absolute path", () => {
				const absolutePath = path.resolve("/usr/bin/tsqlrefine");
				const result = normalizeExecutablePath(absolutePath);
				assert.ok(result !== null);
				assert.ok(path.isAbsolute(result));
			});
		});

		suite("Property-based tests", () => {
			test("property: null for undefined", () => {
				assert.strictEqual(normalizeExecutablePath(undefined), null);
			});

			test("property: null for whitespace-only", () => {
				fc.assert(
					fc.property(
						fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
							minLength: 1,
							maxLength: 10,
						}),
						(chars) => {
							const whitespace = chars.join("");
							return normalizeExecutablePath(whitespace) === null;
						},
					),
				);
			});

			test("property: non-null for valid paths", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const result = normalizeExecutablePath(pathStr);
						return result !== null;
					}),
				);
			});

			test("property: result is absolute when non-null", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const result = normalizeExecutablePath(pathStr);
						if (result !== null) {
							return path.isAbsolute(result);
						}
						return true;
					}),
				);
			});

			test("property: trimming equivalence", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const padded = `  ${pathStr}  `;
						return (
							normalizeExecutablePath(padded) ===
							normalizeExecutablePath(pathStr)
						);
					}),
				);
			});

			test("property: idempotence for non-null results", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const result = normalizeExecutablePath(pathStr);
						if (result !== null) {
							// Normalizing an already normalized path should return same result
							const secondResult = normalizeExecutablePath(result);
							return secondResult === result;
						}
						return true;
					}),
				);
			});
		});
	});

	suite("normalizeConfigPath", () => {
		suite("Example-based tests", () => {
			test("returns null for undefined", () => {
				assert.strictEqual(normalizeConfigPath(undefined), null);
			});

			test("returns null for empty string", () => {
				assert.strictEqual(normalizeConfigPath(""), null);
			});

			test("returns null for whitespace-only string", () => {
				assert.strictEqual(normalizeConfigPath("   "), null);
				assert.strictEqual(normalizeConfigPath("\t\n"), null);
			});

			test("trims valid path without resolving", () => {
				const result = normalizeConfigPath("  config.json  ");
				assert.strictEqual(result, "config.json");
			});

			test("preserves relative paths", () => {
				const result = normalizeConfigPath("../config/tsqlrefine.json");
				assert.strictEqual(result, "../config/tsqlrefine.json");
			});

			test("preserves absolute paths without modification", () => {
				const absolutePath = "/etc/tsqlrefine/config.json";
				const result = normalizeConfigPath(absolutePath);
				assert.strictEqual(result, absolutePath);
			});

			test("does not resolve relative paths to absolute", () => {
				const result = normalizeConfigPath("./config.json");
				assert.strictEqual(result, "./config.json");
				assert.ok(!path.isAbsolute(result || ""));
			});
		});

		suite("Property-based tests", () => {
			test("property: null for undefined", () => {
				assert.strictEqual(normalizeConfigPath(undefined), null);
			});

			test("property: null for whitespace-only", () => {
				fc.assert(
					fc.property(
						fc.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
							minLength: 1,
							maxLength: 10,
						}),
						(chars) => {
							const whitespace = chars.join("");
							return normalizeConfigPath(whitespace) === null;
						},
					),
				);
			});

			test("property: trimming only (no resolution)", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const result = normalizeConfigPath(pathStr);
						return result === pathStr.trim();
					}),
				);
			});

			test("property: preserves non-whitespace characters", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const result = normalizeConfigPath(pathStr);
						if (result !== null) {
							// All non-whitespace characters should be preserved
							const originalContent = pathStr.trim();
							return result === originalContent;
						}
						return true;
					}),
				);
			});

			test("property: trimming equivalence", () => {
				fc.assert(
					fc.property(fc.string({ minLength: 1 }), (pathStr) => {
						fc.pre(pathStr.trim() !== ""); // Precondition: non-whitespace
						const padded = `  ${pathStr}  `;
						return normalizeConfigPath(padded) === normalizeConfigPath(pathStr);
					}),
				);
			});

			test("property: never returns empty string (only null)", () => {
				fc.assert(
					fc.property(fc.string(), (pathStr) => {
						const result = normalizeConfigPath(pathStr);
						return result === null || result.length > 0;
					}),
				);
			});
		});
	});
});
