import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@vscode/test-cli";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceFolder = path.join(rootDir, "test", "fixtures", "workspace");
let version = process.env.VSCODE_TEST_VERSION || "stable";

if (version === "minimum") {
	const { engines } = JSON.parse(
		readFileSync(new URL("./package.json", import.meta.url), "utf8"),
	);
	const match = /^\^(\d+\.\d+\.\d+)$/.exec(engines.vscode);
	if (!match) {
		throw new Error(
			"Expected engines.vscode to use a ^major.minor.patch range",
		);
	}
	version = match[1];
}

export default defineConfig({
	version,
	files: "out/test/e2e/**/*.test.js",
	workspaceFolder,
	mocha: {
		forbidPending: Boolean(process.env.CI),
	},
});
