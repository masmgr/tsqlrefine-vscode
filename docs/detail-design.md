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

---

## 5. lint 実行フロー

### 5.1 トリガ

- 保存時: 対象ファイルが `.sql` の場合のみ。
- 入力中: `.sql` かつ `runOnType=true` の場合のみ。

### 5.2 同時実行制御（単一実行）

- 共有状態:
  - `isRunning: boolean`
  - `pendingRequest: TextDocument | null`
- 擬似コード:

```ts
async function enqueueLint(doc: TextDocument) {
  if (isRunning) {
    pendingRequest = doc;
    return;
  }
  isRunning = true;
  try {
    await runLint(doc);
  } finally {
    isRunning = false;
    if (pendingRequest) {
      const next = pendingRequest;
      pendingRequest = null;
      enqueueLint(next);
    }
  }
}
```

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
  - ワークスペースがある場合は workspace root。
  - ない場合は対象ファイルのディレクトリ。
- タイムアウト:
  - `tsqllint.timeoutMs` を使用。

### 6.2 戻り値

```ts
type LintRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
};
```

### 6.3 エラーハンドリング

- 起動失敗（spawn error）:
  - 通知を出し、Diagnostics は空にする。
- 非ゼロ exit code:
  - 失敗扱いにせず stdout をパースして Diagnostics を更新。
- タイムアウト:
  - 通知 + OutputChannel に詳細を出す。

---

## 7. stdout パース (`parseOutput.ts`)

### 7.1 想定フォーマット

```
<path>(<line>,<col>): <severity> <rule> : <message>
```

### 7.2 正規表現

```ts
const pattern =
  /^(?<path>.+)\((?<line>\d+),(?<col>-?\d+)\):\s+(?<severity>\w+)\s+(?<rule>[^:]+)\s+:\s+(?<message>.+)$/;
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
- 異なるファイルの行は無視（将来: multi-file lint へ拡張余地）。

---

## 8. Diagnostics 更新

### 8.1 更新手順

1. stdout をパースして `Diagnostic[]` を構築。
2. `DiagnosticCollection.set(doc.uri, diagnostics)` で更新。
3. パース結果がゼロ件の場合は空配列をセット（古い診断の残留防止）。

### 8.2 位置計算

- 範囲長は 1 文字を既定とする。
- 行末を越えないように `lineLength` を参照して調整する。

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

## 11. 将来拡張

- ワークスペース全体 lint の追加
- LSP 化
- 複数ファイル出力の取り込み

---

## 12. 未確定事項

- `tsqllint.timeoutMs` 設定キー名の最終確定
- runOnType の既定 debounce 値の最終調整
- マルチファイル lint の扱い（外部仕様の未決 3 点に連動）
