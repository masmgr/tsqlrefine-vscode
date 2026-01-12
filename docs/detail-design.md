# 詳細設計（tsqllint-vscode-lite）

本書は `docs/external-spec.md` を実装可能な粒度に分解し、拡張の内部構成・データフロー・主要ロジックを詳細化する。

本書では「LSP（Language Server Protocol）構成を初期リリースから採用する」前提で記述する（外部仕様書が非 LSP 前提の場合は、別途整合を取る）。

---

## 1. 目的・ゴール

- `tsqllint` の実行結果を Diagnostics として安定的に表示する（VS Code では Problems/下線/ホバーに反映される）。
- 保存時 lint を既定動作とし、入力中 lint は任意で有効化できる。
- 外部プロセス起動・標準出力パース・診断更新の責務をサーバー側に集約し、拡張側はクライアントとして最小化する。
- VS Code 以外のクライアントへも拡張可能な構造にする（LSP）。

---

## 2. 全体構成（LSP）

```
src/
├─ extension.ts                 (VS Code: LSP クライアント起動)
├─ client/
│  └─ client.ts                 (LanguageClient 構築・コマンド橋渡し)
└─ server/
   ├─ server.ts                 (LSP サーバー本体)
   ├─ lint/
   │  ├─ runTsqllint.ts          (外部プロセス実行)
   │  ├─ parseOutput.ts          (stdout -> LSP Diagnostic[])
   │  └─ types.ts                (LintRunResult / Issue 等の型)
   └─ config/
      └─ settings.ts             (設定読み取り・既定値)
```

- `extension.ts` / `client.ts` は起動・設定同期・コマンド送出に限定する。
- lint 実行・パース・診断生成はサーバーに集約する。
- `parseOutput.ts` は副作用なしの純粋関数として分離し、単体テスト可能にする。
- 主要依存パッケージ（想定）:
  - Client: `vscode-languageclient`
  - Server: `vscode-languageserver/node`, `vscode-uri`

---

## 3. 設定仕様

### 3.1 設定キー

| キー | 型 | 既定 | 説明 |
|---|---|---|---|
| `tsqllint.path` | string | なし | `tsqllint` 実行ファイルの明示パス |
| `tsqllint.configPath` | string | なし | `tsqllint -c` に渡す config |
| `tsqllint.runOnSave` | boolean | true | 保存時 lint |
| `tsqllint.runOnType` | boolean | false | 入力中 lint |
| `tsqllint.debounceMs` | number | 500 | 入力中 lint の debounce |
| `tsqllint.timeoutMs` | number | 10000 | 外部プロセスのタイムアウト |

注記:
- LSP サーバー側が設定を参照できるよう、クライアントは設定同期（`workspace/didChangeConfiguration` / `workspace/configuration`）を有効化する。

### 3.2 設定取得・同期（Client/Server）

- Client:
  - `LanguageClientOptions.synchronize.configurationSection = "tsqllint"` を使用する。
  - `tsqllint-lite.run` 等のコマンドは、アクティブドキュメントの URI をサーバーへ渡す。
- Server:
  - `workspace/configuration` から `tsqllint.*` を取得し、キャッシュする。
  - 設定変更通知（`workspace/didChangeConfiguration`）を受けたらキャッシュを更新し、debounce 等の動作へ反映する。

---

## 4. アクティベーション設計（Client）

### 4.1 activationEvents

- `onLanguage:sql`
- `onCommand:tsqllint-lite.run`（手動実行）

### 4.2 初期化手順

1. LSP サーバーモジュール（`out/server/server.js` など）を指定して `LanguageClient` を生成する。
2. `client.start()` で起動する（クライアント側で Diagnostics を直接管理しない）。
3. コマンド `tsqllint-lite.run` を登録し、サーバーに「指定 URI を lint」する要求を送る。
4. 出力は基本的に LanguageClient の output channel（Language Server）へ集約する。

---

## 5. LSP I/F（Client/Server）

### 5.1 標準通知

- `textDocument/didOpen` / `textDocument/didChange` / `textDocument/didSave` / `textDocument/didClose`
  - Server は `TextDocuments` でドキュメント状態（URI・内容・version）を保持する。

### 5.2 カスタム要求（推奨）

- 手動 lint: `tsqllint/lintDocument`（request）
  - 入力: `{ uri: string }`
  - 出力: `{ ok: boolean; issues: number }`（UI 表示用途。Diagnostics は別途 publish）
- クリア: `tsqllint/clearDiagnostics`（notification）
  - 入力: `{ uris: string[] }`
  - rename/delete などで古い URI を確実に消す目的。

補足:
- `workspace/didRenameFiles` / `workspace/didDeleteFiles` は LSP クライアント実装依存で届かない場合があるため、VS Code 側でイベント購読し、上記カスタム通知でサーバーへ伝える構成を既定とする。

---

## 6. lint 実行フロー（Server）

### 6.1 トリガ

- 保存時: `didSave` を受けたら lint（`runOnSave=true` の場合）。
- 入力中: `didChange` を受けたら debounce 後に lint（`runOnType=true` の場合）。
- 手動: `tsqllint/lintDocument` を受けたら即 lint。

### 6.2 同時実行制御（URI 単位）

- 目的:
  - 同一 URI の lint は「最新のみ」を走らせたい。
  - 別 URI 同士は並列に走らせてもよい（過負荷回避のため上限を設けてもよい）。
- 共有状態（例）:
  - `inFlightByUri: Map<string, { abort: AbortController; startedVersion: number | null }>`
  - `pendingByUri: Map<string, { reason: "save" | "type" | "manual"; version: number | null }>`
  - `debounceTimerByUri: Map<string, NodeJS.Timeout>`
- 方針:
  - 新規要求が来たら、同 URI の in-flight を中断（`abort.abort()` + `ChildProcess.kill()`）し、pending を最新で上書き。
  - `runOnType` の場合は `debounceMs` 経過後に実行し、さらに新しい変更が来たら timer をリセットする。

### 6.3 lint 対象の決定（保存済み/未保存）

- `file://` URI かつ保存済みの場合:
  - `tsqllint <filePath>` で実行する（最も安定）。
- 未保存（Untitled）または「変更が未保存で runOnType」:
  - `tsqllint` が stdin を受け取れる場合: stdin で内容を渡す。
  - stdin が使えない場合: 一時ファイルに書き出して lint し、終了後に削除する。
  - 一時ファイル運用時は、パースした `path` と元 URI のひも付け（出力の `path` が一時ファイルを指す問題）に注意する。

---

## 7. 外部プロセス実行（Server: `runTsqllint.ts`）

### 7.1 実行パラメータ

- 実行ファイル:
  - `tsqllint.path` が設定されている場合はそれを優先。
  - ない場合は `"tsqllint"` を PATH 解決。
- 引数:
  - 対象ファイルパス
  - `tsqllint.configPath` が指定されている場合のみ `-c <path>` を付与。
- `cwd`:
  - ワークスペース（`workspaceFolders`）がある場合は、対象ファイルを含むフォルダ（なければ先頭）を優先する。
  - ワークスペースがない場合は、対象ファイルのディレクトリを使用する。
- タイムアウト:
  - `tsqllint.timeoutMs` を使用。
- キャンセル:
  - `AbortController` で中断要求を伝播し、`ChildProcess.kill` で停止する。

### 7.2 戻り値

```ts
type LintRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
};
```

### 7.3 エラーハンドリング

- 起動失敗（spawn error）:
  - Server は `window/showMessage`（warning/error）と `window/logMessage` を併用し、当該 URI の Diagnostics は空で更新する。
- 非ゼロ exit code:
  - 失敗扱いにせず stdout をパースして Diagnostics を更新する（tsqllint は違反検出で非ゼロになりうる）。
- タイムアウト:
  - 通知 + `window/logMessage` に詳細を出す。

---

## 8. stdout パース（Server: `parseOutput.ts`）

### 8.1 想定フォーマット

```
<path>(<line>,<col>): <severity> <rule> : <message>
```

### 8.2 正規表現

```ts
const pattern =
  /^(?<path>.+?)\((?<line>\d+),(?<col>-?\d+)\):\s+(?<severity>\w+)\s+(?<rule>[^:]+)\s+:\s+(?<message>.+)$/;
```

### 8.3 変換ルール（LSP Diagnostic）

- `line` / `col` は 1 始まり → 0 始まりへ変換する。
- `col = -1` は行頭扱い（`col=0`）に正規化する。
- ルール名は `Diagnostic.code` に格納し、`Diagnostic.source = "tsqllint"` を付与する。
- `severity` マップ:
  - `error` -> `DiagnosticSeverity.Error`
  - `warning` -> `DiagnosticSeverity.Warning`
  - それ以外 -> `DiagnosticSeverity.Information`

### 8.4 ファイルフィルタ

- `path` は相対/絶対が混在しうるため、`cwd` を基準に `path.resolve()` して正規化し、URI から導出した file path（例: `URI.parse(uri).fsPath`）と突き合わせる。
- 対象 URI と一致しない行は基本的に無視する（将来、複数ファイル lint を行う場合は URI ごとに振り分ける）。

---

## 9. Diagnostics 更新（Server）

### 9.1 更新手順

1. stdout をパースして `Diagnostic[]` を構築。
2. `textDocument/publishDiagnostics` で該当 URI に送信する。
3. パース結果がゼロ件の場合は空配列を送信する（古い診断の残留防止）。

### 9.2 位置計算

- 範囲長は 1 文字を既定とする。
- `col` が行長を超える場合は、行全体ハイライト（例: `range.start.character=0` to `range.end.character=lineLength`）へフォールバックする。
- 必要なら「1 文字 / 行全体」を切り替えられる設定を検討する。

---

## 10. 通知・ログ設計（Server/Client）

### 10.1 通知条件

- `tsqllint` が見つからない/起動失敗
- config エラーなど stderr がある場合
- タイムアウト

### 10.2 通知内容

- 原因（起動できない、設定不正、タイムアウト）
- 次に行うべき手順（install 手順、`tsqllint --print-config`）

### 10.3 ログ出力

- 通常時は静かにし、失敗時のみ詳細を `window/logMessage`（+ 必要なら `showMessage`）へ出す。
- LSP のログは LanguageClient の出力（Language Server）に集約する（専用 OutputChannel を作る場合は `LanguageClientOptions.outputChannel` を検討する）。

---

## 11. テスト方針

### 11.1 単体テスト

- `server/lint/parseOutput.ts` に対するテストケースを用意する。
  - 正常行/異常行
  - `col=-1` の補正
  - warning/error/その他
  - path の正規化（相対/絶対、Windows パス）

### 11.2 統合テスト

- フェイク CLI（固定 stdout を返すスクリプト）を用意し、`server/lint/runTsqllint.ts` を通す。
- VS Code Extension Test（`@vscode/test-electron`）上で「保存 → lint → Problems に出る」までを確認する。

---

## 12. 未確定事項

- runOnType の既定 debounce 値の最終調整
- stdin lint の可否（`tsqllint` の入力仕様に依存）
- rename/delete の通知経路（LSP 標準通知で受けるか、VS Code 側イベント + カスタム通知にするか）
