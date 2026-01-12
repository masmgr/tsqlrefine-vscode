# 詳細設計（tsqllint-vscode-lite）

本書は `docs/external-spec.md` を実装可能な粒度に分解し、拡張の内部構成・データフロー・主要ロジックを詳細化する。

---

## 1. 目的・ゴール

- `tsqllint` の実行結果を VS Code Diagnostics として安定的に表示する。
- 保存時 lint を既定動作とし、入力中 lint は任意で有効化できる。
- 外部プロセス起動・標準出力パース・診断更新の責務を分離し、保守性とテスト容易性を担保する。

---

## 2. 全体構成

```
src/
├─ extension.ts                (VS Code API 連携・イベント購読)
├─ lint/
│  ├─ runTsqllint.ts            (外部プロセス実行)
│  ├─ parseOutput.ts            (stdout -> Diagnostic)
│  └─ types.ts                  (LintResult / Issue などの型)
├─ config/
│  └─ settings.ts               (設定読み取り・既定値)
└─ ui/
   └─ notifications.ts          (ユーザー通知/OutputChannel)
```

- `extension.ts` は最小限のオーケストレーションに限定する。
- `parseOutput.ts` は純粋関数として分離し、単体テスト可能にする。

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
- `timeoutMs` は外部仕様で「TBD」扱いのため、実装時に設定名の最終確認を行う。

### 3.2 設定取得

- `vscode.workspace.getConfiguration("tsqllint")` を使用。
- 設定変更時は `onDidChangeConfiguration` を監視し、必要ならデバウンス設定を再構成する。

---

## 4. アクティベーション設計

### 4.1 activationEvents

- `onLanguage:sql`
- `onCommand:tsqllint.run`（将来拡張のために用意）

### 4.2 初期化手順

1. `DiagnosticCollection` を生成（例: `"tsqllint"`）。
2. OutputChannel を生成（例: `"tsqllint-lite"`）。
3. 設定読み込み、デバウンス関数を構築。
4. `onDidSaveTextDocument` を登録（runOnSave）。
5. `onDidChangeTextDocument` を登録（runOnType）。
6. `onDidCloseTextDocument` で Diagnostics をクリア。
7. `onDidRenameFiles` / `onDidDeleteFiles` で旧 URI の Diagnostics をクリア。

---

## 5. lint 実行フロー

### 5.1 トリガ

- 保存時: `doc.languageId === "sql"` の場合のみ。
- 入力中: `doc.languageId === "sql"` かつ `doc.isDirty` かつ `runOnType=true` の場合のみ。

### 5.2 同時実行制御（単一実行）

- 共有状態:
  - `isRunning: boolean`
  - `pendingRequests: Map<string, TextDocument>`（key は URI 文字列）
  - `abortController: AbortController | null`
- 擬似コード:

```ts
async function enqueueLint(doc: TextDocument) {
  if (isRunning) {
    pendingRequests.set(doc.uri.toString(), doc);
    return;
  }
  isRunning = true;
  try {
    await runLint(doc);
  } finally {
    isRunning = false;
    if (pendingRequests.size > 0) {
      const next = pendingRequests.values().next().value;
      pendingRequests.delete(next.uri.toString());
      enqueueLint(next);
    }
  }
}
```

補足:
- pending は「最後の状態だけ lint できればよい」前提のため、同一 URI は上書き。
- 入力中 lint では前回の実行を中断できるようにする（AbortController / ChildProcess.kill）。

---

## 6. 外部プロセス実行 (`runTsqllint.ts`)

### 6.1 実行パラメータ

- 実行ファイル:
  - `tsqllint.path` が設定されている場合はそれを優先。
  - ない場合は `"tsqllint"` を PATH 解決。
- 引数:
  - 対象ファイルパス
  - `tsqllint.configPath` が指定されている場合のみ `-c <path>` を付与。
- `cwd`:
  - `vscode.workspace.getWorkspaceFolder(doc.uri)` がある場合はその root。
  - ない場合は対象ファイルのディレクトリ。
- タイムアウト:
  - `tsqllint.timeoutMs` を使用。
 - キャンセル:
  - `AbortController` で中断要求を伝播し、`ChildProcess.kill` で停止する。

### 6.2 戻り値

```ts
type LintRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
};
```

### 6.3 エラーハンドリング

- 起動失敗（spawn error）:
  - 通知を出し、Diagnostics は空にする。
- 非ゼロ exit code:
  - 失敗扱いにせず stdout をパースして Diagnostics を更新。
- タイムアウト:
  - 通知 + OutputChannel に詳細を出す。

### 6.4 入力中 lint と未保存内容

- `tsqllint` が stdin を受け取れる場合は、保存済みファイルパスに加えて現在の内容を渡す。
- stdin が使えない場合は、入力中 lint は「保存済み内容に対してのみ」になる旨を設定説明に明記する。
- 代替として一時ファイルに書き出して実行する案もあるが、I/O と競合ケアが必要なため慎重に扱う。

---

## 7. stdout パース (`parseOutput.ts`)

### 7.1 想定フォーマット

```
<path>(<line>,<col>): <severity> <rule> : <message>
```

### 7.2 正規表現

```ts
const pattern =
  /^(?<path>.+?)\((?<line>\d+),(?<col>-?\d+)\):\s+(?<severity>\w+)\s+(?<rule>[^:]+)\s+:\s+(?<message>.+)$/;
```

### 7.3 変換ルール

- `line` / `col` は 1 始まり → 0 始まりへ変換。
- `col = -1` は行頭扱い（`col=0`）。
- ルール名は `Diagnostic.code` に格納。
- `severity` マップ:
  - `error` -> `DiagnosticSeverity.Error`
  - `warning` -> `DiagnosticSeverity.Warning`
  - それ以外 -> `DiagnosticSeverity.Information`

### 7.4 ファイルフィルタ

- `path` が対象ドキュメントと一致する行のみ採用。
- 異なるファイルの行は無視。

---

## 8. Diagnostics 更新

### 8.1 更新手順

1. stdout をパースして `Diagnostic[]` を構築。
2. `DiagnosticCollection.set(doc.uri, diagnostics)` で更新。
3. パース結果がゼロ件の場合は空配列をセット（古い診断の残留防止）。

### 8.2 位置計算

- 範囲長は 1 文字を既定とする。
- `col` が行長を超える場合は、行全体ハイライト（`Range(line, 0, line, lineLength)`）へフォールバックする。
- 必要なら「1 文字 / 行全体」を切り替えられる設定を検討する。

---

## 9. 通知・ログ設計

### 9.1 通知条件

- `tsqllint` が見つからない/起動失敗
- config エラーなど stderr がある場合
- タイムアウト

### 9.2 通知内容

- 原因（起動できない、設定不正、タイムアウト）
- 次に行うべき手順（install 手順、`tsqllint --print-config`）

### 9.3 OutputChannel

- 通常時は静かにする。
- 失敗時のみ stderr / stdout の要点を出す。

---

## 10. テスト方針

### 10.1 単体テスト

- `parseOutput.ts` に対するテストケースを用意する。
  - 正常行/異常行
  - `col=-1` の補正
  - warning/error/その他

### 10.2 統合テスト

- フェイク CLI（固定 stdout を返すスクリプト）を用意し、`runTsqllint.ts` を通す。
- VS Code Extension Test CLI 上で Diagnostics が更新されることを確認。

---

## 11. LSP 化

### 11.1 目的
- lint 実行・診断更新を言語サーバー側へ集約し、拡張側はクライアントに専念する。
- テスト容易性を高め、VS Code 以外のクライアントへ拡張可能にする。

### 11.2 構成
```
src/
├─ extension.ts                (LanguageClient 起動・設定)
├─ client/
│  └─ client.ts                (LSP 初期化・設定同期)
└─ server/
   ├─ server.ts                (LSP サーバー本体)
   ├─ lint/
   │  ├─ runTsqllint.ts         (外部プロセス実行)
   │  └─ parseOutput.ts         (stdout -> Diagnostic)
   └─ config/
      └─ settings.ts            (設定読み取り・既定値)
```

### 11.3 Client 側（extension.ts）
- `LanguageClient` を起動し、`onLanguage:sql` で有効化。
- 設定変更を `workspace/didChangeConfiguration` でサーバーへ通知。
- コマンド `tsqllint.run` は `workspace/executeCommand` を LSP へ委譲。

### 11.4 Server 側（server.ts）
- `textDocument/didSave` で lint 実行（既定）。
- `textDocument/didChange` で lint 実行（runOnType 時のみ）。
- `textDocument/didClose` で診断をクリア。
- `workspace/didRenameFiles` / `workspace/didDeleteFiles` で旧 URI の診断をクリア。
- 設定変更時は debounce を再構築。

### 11.5 診断送信
- `textDocument/publishDiagnostics` で送信。
- 旧診断は空配列送信でクリア。

---

## 12. 未確定事項

- `tsqllint.timeoutMs` 設定キー名の最終確定
- runOnType の既定 debounce 値の最終調整
- stdin lint の可否（`tsqllint` の入力仕様に依存）
