import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	type CliEditOperationDeps,
	executeCliEditOperation,
} from "../shared/cliEditOperation";
import type { DocumentContext } from "../shared/documentContext";
import { runFixer } from "./runFixer";

export type FixOperationDeps = CliEditOperationDeps;

/**
 * Execute fix operation on a document.
 *
 * @param context - Document context containing URI, settings, and text
 * @param document - The TextDocument to fix
 * @param deps - Dependencies including connection and managers
 * @returns Array of TextEdits to apply, empty if no changes, null on error
 */
export async function executeFix(
	context: DocumentContext,
	document: TextDocument,
	deps: FixOperationDeps,
): Promise<TextEdit[] | null> {
	return await executeCliEditOperation(context, document, deps, {
		operationName: "fix",
		runner: runFixer,
		isEnabled: ({ effectiveSettings }) => effectiveSettings.enableFix,
	});
}
