import type { TextEdit } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import {
	type CliEditOperationDeps,
	executeCliEditOperation,
} from "../shared/cliEditOperation";
import type { DocumentContext } from "../shared/documentContext";
import { runFormatter } from "./runFormatter";

export type FormatOperationDeps = CliEditOperationDeps;

/**
 * Execute format operation on a document.
 *
 * @param context - Document context containing URI, settings, and text
 * @param document - The TextDocument to format
 * @param deps - Dependencies including connection and managers
 * @returns Array of TextEdits to apply, empty if no changes, null on error
 */
export async function executeFormat(
	context: DocumentContext,
	document: TextDocument,
	deps: FormatOperationDeps,
): Promise<TextEdit[] | null> {
	return await executeCliEditOperation(context, document, deps, {
		operationName: "format",
		runner: runFormatter,
	});
}
