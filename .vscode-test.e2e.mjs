import { defineConfig } from "@vscode/test-cli";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceFolder = path.join(rootDir, "test", "fixtures", "workspace");

export default defineConfig({
	files: "out/e2e/**/*.test.js",
	workspaceFolder,
});
