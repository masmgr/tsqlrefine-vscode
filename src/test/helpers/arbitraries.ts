/**
 * Custom fast-check arbitraries for property-based testing.
 *
 * This module provides reusable arbitraries for generating test data
 * with realistic constraints for the tsqlrefine-vscode extension.
 */

import * as fc from "fast-check";

/**
 * Arbitrary for Unix-style file paths.
 * Generates paths like "/foo/bar/baz.sql"
 */
export const unixPath = fc
	.array(fc.stringMatching(/^[a-zA-Z0-9_.-]+$/), {
		minLength: 1,
		maxLength: 5,
	})
	.map((parts) => `/${parts.join("/")}`);

/**
 * Arbitrary for Windows-style file paths.
 * Generates paths like "C:\foo\bar\baz.sql"
 */
export const windowsPath = fc
	.tuple(
		fc.constantFrom("C:", "D:", "E:"),
		fc.array(fc.stringMatching(/^[a-zA-Z0-9_.-]+$/), {
			minLength: 1,
			maxLength: 5,
		}),
	)
	.map(([drive, parts]) => `${drive}\\${parts.join("\\")}`);

/**
 * Arbitrary for platform-appropriate file paths.
 * Returns Windows paths on Windows, Unix paths on other platforms.
 */
export const platformPath =
	process.platform === "win32" ? windowsPath : unixPath;

/**
 * Arbitrary for whitespace-only strings.
 * Generates strings containing only spaces, tabs, newlines, etc.
 */
export const whitespace = fc
	.array(fc.constantFrom(" ", "\t", "\n", "\r"), {
		minLength: 1,
		maxLength: 10,
	})
	.map((chars) => chars.join(""));

/**
 * Arbitrary for strings with leading/trailing whitespace.
 * Generates strings like "  content  " with optional padding.
 */
export const paddedString = fc
	.tuple(fc.option(whitespace), fc.string(), fc.option(whitespace))
	.map(
		([prefix, content, suffix]) => `${prefix ?? ""}${content}${suffix ?? ""}`,
	);

/**
 * Arbitrary for text with various line endings.
 * Generates multiline text with \n, \r\n, or \r separators.
 */
export const textWithLineEndings = fc
	.array(fc.string(), { maxLength: 10 })
	.chain((lines) =>
		fc.constantFrom("\n", "\r\n", "\r").map((sep) => lines.join(sep)),
	);

/**
 * Arbitrary for UTF-8 buffers with optional BOM.
 * Generates buffers that may start with UTF-8 BOM (0xEF 0xBB 0xBF).
 */
export const utf8BufferWithOptionalBom = fc
	.tuple(fc.boolean(), fc.string())
	.map(([hasBom, text]) => {
		const textBuffer = Buffer.from(text, "utf8");
		if (hasBom) {
			return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), textBuffer]);
		}
		return textBuffer;
	});

/**
 * Arbitrary for CLI diagnostic JSON structure.
 * Generates valid diagnostic objects matching tsqlrefine CLI output.
 */
export const cliDiagnostic = fc.record({
	range: fc.record({
		start: fc.record({
			line: fc.nat(1000),
			character: fc.nat(200),
		}),
		end: fc.record({
			line: fc.nat(1000),
			character: fc.nat(200),
		}),
	}),
	severity: fc.option(fc.integer({ min: 1, max: 4 })),
	code: fc.option(fc.string()),
	message: fc.string(),
	data: fc.option(
		fc.record({
			ruleId: fc.option(fc.string()),
			category: fc.option(fc.string()),
			fixable: fc.option(fc.boolean()),
			codeDescriptionHref: fc.option(
				fc.webUrl({ withFragments: false, withQueryParameters: false }),
			),
		}),
	),
});

/**
 * Arbitrary for CLI JSON output structure.
 * Generates valid JSON output matching tsqlrefine lint --output json format.
 */
export const cliJsonOutput = fc.record({
	tool: fc.constant("tsqlrefine"),
	version: fc.constant("1.0.0"),
	command: fc.constant("lint"),
	files: fc.array(
		fc.record({
			filePath: fc.oneof(fc.constant("<stdin>"), fc.string()),
			diagnostics: fc.array(cliDiagnostic),
		}),
	),
});
