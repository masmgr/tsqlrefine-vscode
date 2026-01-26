import * as path from "node:path";
import type * as vscode from "vscode";
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

export function createLanguageClient(
	context: vscode.ExtensionContext,
): LanguageClient {
	const serverModule = context.asAbsolutePath(path.join("dist", "server.js"));

	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.ipc },
		debug: {
			module: serverModule,
			transport: TransportKind.ipc,
			options: {
				execArgv: ["--nolazy", "--inspect=6009"],
			},
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: ["sql", "tsql", "mssql"].flatMap((language) => [
			{ scheme: "file", language },
			{ scheme: "untitled", language },
		]),
		synchronize: {
			configurationSection: "tsqllint",
		},
	};

	return new LanguageClient(
		"tsqllintLite",
		"tsqllint-lite",
		serverOptions,
		clientOptions,
	);
}
