import * as path from "node:path";
import { URI } from "vscode-uri";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { resolveConfigPath } from "../config/resolveConfigPath";
import type { TsqlRefineSettings } from "../config/settings";
import { normalizeForCompare } from "./normalize";

export type DocumentContext = {
	uri: string;
	filePath: string;
	workspaceRoot: string | null;
	cwd: string;
	effectiveSettings: TsqlRefineSettings;
	effectiveConfigPath: string | undefined;
	documentText: string;
	isSavedFile: boolean;
};

export type DocumentContextOptions = {
	document: TextDocument;
	documentSettings: TsqlRefineSettings;
	workspaceFolders: string[];
	isSavedFn: (document: TextDocument) => boolean;
};

export async function createDocumentContext(
	options: DocumentContextOptions,
): Promise<DocumentContext> {
	const { document, documentSettings, workspaceFolders, isSavedFn } = options;
	const uri = document.uri;
	const parsedUri = URI.parse(uri);
	const filePath = parsedUri.fsPath;
	const workspaceRoot = resolveWorkspaceRoot(
		filePath || undefined,
		workspaceFolders,
	);
	const cwd =
		workspaceRoot ?? (filePath ? path.dirname(filePath) : process.cwd());

	const effectiveConfigPath = await resolveConfigPath({
		configuredConfigPath: documentSettings.configPath,
		filePath: filePath || null,
		workspaceRoot,
	});

	const effectiveSettings: TsqlRefineSettings =
		typeof effectiveConfigPath === "string" && effectiveConfigPath.trim()
			? { ...documentSettings, configPath: effectiveConfigPath }
			: documentSettings;

	const documentText = document.getText();
	const isSavedFile = isSavedFn(document);

	return {
		uri,
		filePath,
		workspaceRoot,
		cwd,
		effectiveSettings,
		effectiveConfigPath,
		documentText,
		isSavedFile,
	};
}

function resolveWorkspaceRoot(
	filePath: string | undefined,
	workspaceFolders: string[],
): string | null {
	if (workspaceFolders.length === 0) {
		return null;
	}

	if (filePath) {
		const normalizedFilePath = normalizeForCompare(filePath);
		for (const folder of workspaceFolders) {
			const normalizedFolder = normalizeForCompare(folder);
			if (normalizedFilePath.startsWith(normalizedFolder)) {
				return folder;
			}
		}
		return null;
	}

	return workspaceFolders[0] ?? null;
}
