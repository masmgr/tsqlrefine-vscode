import * as assert from "node:assert";
import {
	formatStatusBarText,
	formatStatusBarTooltip,
} from "../../client/statusBarFormat";

const zeroCounts = { errors: 0, warnings: 0, infos: 0, hints: 0 };

suite("statusBar", () => {
	suite("formatStatusBarText", () => {
		test("shows check icon when no issues", () => {
			const text = formatStatusBarText(zeroCounts, false, false);
			assert.strictEqual(text, "$(check) TSQLRefine");
		});

		test("shows error count", () => {
			const text = formatStatusBarText(
				{ ...zeroCounts, errors: 2 },
				false,
				false,
			);
			assert.strictEqual(text, "$(warning) TSQLRefine: 2E");
		});

		test("shows warning count", () => {
			const text = formatStatusBarText(
				{ ...zeroCounts, warnings: 3 },
				false,
				false,
			);
			assert.strictEqual(text, "$(warning) TSQLRefine: 3W");
		});

		test("shows both error and warning counts", () => {
			const text = formatStatusBarText(
				{ ...zeroCounts, errors: 2, warnings: 1 },
				false,
				false,
			);
			assert.strictEqual(text, "$(warning) TSQLRefine: 2E 1W");
		});

		test("shows spinner when running", () => {
			const text = formatStatusBarText(zeroCounts, true, false);
			assert.strictEqual(text, "$(sync~spin) TSQLRefine");
		});

		test("spinner takes priority over counts", () => {
			const text = formatStatusBarText(
				{ ...zeroCounts, errors: 2, warnings: 1 },
				true,
				false,
			);
			assert.strictEqual(text, "$(sync~spin) TSQLRefine");
		});

		test("shows disabled state", () => {
			const text = formatStatusBarText(zeroCounts, false, true);
			assert.strictEqual(text, "$(circle-slash) TSQLRefine: Off");
		});

		test("disabled takes priority over running", () => {
			const text = formatStatusBarText(zeroCounts, true, true);
			assert.strictEqual(text, "$(circle-slash) TSQLRefine: Off");
		});

		test("ignores info and hint counts in display", () => {
			const text = formatStatusBarText(
				{ errors: 0, warnings: 0, infos: 5, hints: 3 },
				false,
				false,
			);
			assert.strictEqual(text, "$(check) TSQLRefine");
		});
	});

	suite("formatStatusBarTooltip", () => {
		test("shows all counts", () => {
			const tooltip = formatStatusBarTooltip({
				errors: 2,
				warnings: 1,
				infos: 3,
				hints: 0,
			});
			assert.ok(tooltip.includes("Errors: 2"));
			assert.ok(tooltip.includes("Warnings: 1"));
			assert.ok(tooltip.includes("Info: 3"));
			assert.ok(tooltip.includes("Hints: 0"));
		});

		test("shows zero counts", () => {
			const tooltip = formatStatusBarTooltip(zeroCounts);
			assert.ok(tooltip.includes("Errors: 0"));
			assert.ok(tooltip.includes("Warnings: 0"));
			assert.ok(tooltip.includes("Info: 0"));
			assert.ok(tooltip.includes("Hints: 0"));
		});

		test("starts with TSQLRefine", () => {
			const tooltip = formatStatusBarTooltip(zeroCounts);
			assert.ok(tooltip.startsWith("TSQLRefine"));
		});
	});
});
