# 外部仕様書：tsqllint-lite（案）

## 0. 文書情報

- 対象：VS Code 拡張 `tsqllint-lite`
- 目的：外部ツール `tsqllint`（TSQLLint）を実行し、SQL の lint 結果を VS Code の Diagnostics として提示する
- 前提：本書は `docs/requirement.md`（要件定義ドラフト）に基づく外部仕様（利用者・利用環境・外部I/F・振る舞い）を定義する

---

## 1. 概要

### 1.1 提供価値

- `.sql` ファイルに対して `tsqllint` を実行し、問題点を VS Code の以下 UI に統合表示する
  - エディタ上の下線（赤線等）
  - Problems（問題）ビュー
  - ホバー（Diagnostics の詳細）

### 1.2 スコープ

- 対象：`.sql`
- lint 実行：保存時（必須）、入力中（任意・debounce）
- 内部実装：LSP（Language Server Protocol）を採用し、診断生成は言語サーバー側で行う
- ワークスペース全体の重い解析：初期対象外（基本はファイル単位）

---

## 2. 利用環境・前提条件

### 2.1 対応 OS / 実行環境

- VS Code（Desktop）上で動作
- 対応 OS：Windows / macOS / Linux

### 2.2 依存ツール（必須）

- `tsqllint`（TSQLLint）が利用者環境にインストール済みであること
  - dotnet tool：`dotnet tool install --global TSQLLint`
  - Homebrew：`brew install tsqllint`
  - npm：`npm install tsqllint -g`

### 2.3 `tsqllint` の外部仕様（本拡張が依存する範囲）

- 実行：`tsqllint <file.sql | dir | wildcard>`
- 設定：`-c <configPath>` 指定、または `tsqllint` 側の探索（環境変数/カレント/ホーム等）
- 出力（stdout）：ConsoleReporter が生成する固定フォーマット（1行=1違反）
  - `<file>(<line>,<col>): <severity> <ruleName> : <message>.`
  - `severity` は `error` / `warning` の小文字のみ（Off は出力されない）
  - 構文エラー時は `ruleName=invalid-syntax`
  - 最後にサマリーが 1 ブロック出る（ファイル数が 0 の場合は出ない）
- 終了コード：error 違反がある場合に非0終了になりうる

---

## 3. 外部インターフェース

### 3.1 VS Code UI 連携

- Diagnostics：`tsqllint` の検出結果を Diagnostics として提示し、下線・Problems・ホバーに反映する
  - 実装上は LSP の `textDocument/publishDiagnostics` により通知する

### 3.2 外部プロセス実行 I/F

- 実行ファイル
  - 設定 `tsqllint.path` が指定されている場合：そのパスを使用
  - 未指定の場合：`tsqllint` を PATH から解決して使用
- 実行引数（最小）
  - 対象：対象 `.sql` ファイルのパス
  - 任意：`tsqllint.configPath` が指定されている場合のみ `-c <configPath>` を付与
- 実行時カレントディレクトリ（cwd）
  - ワークスペースがある場合：対象ファイルを含むワークスペースフォルダ（なければ先頭）
  - ない場合：対象ファイルのディレクトリ
- タイムアウト
  - 既定：10 秒
  - 変更：設定 `tsqllint.timeoutMs` で変更可能

### 3.3 コマンド

- 手動実行：コマンド `tsqllint-lite.run` により、アクティブな `.sql` ドキュメントに対して lint を実行する
- 手動 fix：コマンド `tsqllint-lite.fix` により、アクティブな `.sql` ドキュメントに対して `tsqllint --fix` を実行する（保存済みファイルのみ）

---

## 4. 機能仕様

### 4.1 lint 実行トリガ

#### 4.1.1 保存時 lint（既定）

- 設定 `tsqllint.runOnSave=true` の場合、保存を契機に lint を実行する（既定：true）
- 対象：保存された `.sql` ファイル
- 動作：`tsqllint` を 1 回実行し、結果を Diagnostics に反映する

#### 4.1.2 入力中 lint（任意）

- 設定 `tsqllint.runOnType=true` の場合、ドキュメント変更を契機に lint を実行する
- 実行は debounce する
  - 設定：`tsqllint.debounceMs`

#### 4.1.3 同時実行制御

- lint は多重起動しない（最大 1 実行）
- 連続トリガはキュー化し、実行中に新規要求が来た場合は「最新 1 件」へ集約する

#### 4.1.4 fix（任意）

- 設定 `tsqllint.fixOnSave=true` の場合、保存を契機に `tsqllint --fix` を実行し、その後に lint を実行して Diagnostics を更新する
- 手動 fix（`tsqllint-lite.fix`）でも同様に `--fix` 実行後に lint を行う
- fix は保存済みファイルのみ対象（未保存/untitled は対象外）

### 4.2 実行結果の解釈（終了コード）

- 実行前に `tsqllint` の存在確認を行う：
  - `tsqllint.path` が指定されている場合は、そのパスの実在を確認する
  - 未指定の場合は、コマンドラインで `tsqllint` が解決できることを確認する（PATH）
  - 見つからない場合は、lint/fix を実行せずエラー通知を行う
- `tsqllint` が起動でき、stdout が取得できた場合：
  - exitCode が非0でも「実行失敗」と断定しない（error 違反により非0となりうるため）
  - stdout を可能な限りパースし、Diagnostics を更新する
- `tsqllint` が起動できない場合（例：tool not found）：
  - 実行失敗として扱い、ユーザー誘導（導入手順）を表示する

### 4.3 stdout パース → Diagnostics 変換

#### 4.3.1 入力フォーマット

- 1 行を 1 件の問題として扱う（行単位パース）
- 想定フォーマット（確定）：
  - `<file>(<line>,<col>): <severity> <ruleName> : <message>.`
- サマリー（違反とは別扱い）：

```
Linted {fileCount} files in {seconds} seconds

{errorCount} Errors.
{warningCount} Warnings.
```

（`--fix` 実行時に修正があれば末尾に `{fixedCount} Fixed` が追加される）
- 入力パスが無効などの場合は上記と異なる素のメッセージが出る（例: `"{path} is not a valid file path."`）。

#### 4.3.2 抽出項目

- `file`：対象ファイルパス
- `line`：行番号（1 始まり想定）
- `col`：列番号（1 始まり想定）
- `severity`：`error` / `warning`
- `ruleName`：ルール名（構文エラー時は `invalid-syntax`）
- `message`：メッセージ本文

#### 4.3.3 VS Code へのマッピング

- Severity
  - `error` → `DiagnosticSeverity.Error`
  - `warning` → `DiagnosticSeverity.Warning`
- 位置情報
  - `line` は 1 始まりのため、VS Code への反映時は 0 始まりに変換する
  - `col` は 1 始まりのため、VS Code への反映時は 0 始まりに変換する
  - 範囲長は `tsqllint` 出力に長さ情報がないため、原則 1 文字幅とする

### 4.4 `.tsqllintrc` / config の扱い

- `tsqllint.configPath` が指定されている場合のみ、`-c <configPath>` を付与する
- それ以外の config 探索は `tsqllint` 側仕様に委ねる（拡張は独自探索を行わない）

---

## 5. 設定仕様

拡張設定（Settings）として以下を提供する。

| キー | 型 | 既定 | 説明 |
|---|---:|---:|---|
| `tsqllint.path` | string | なし | `tsqllint` 実行ファイルの明示パス（最優先） |
| `tsqllint.configPath` | string | なし | `tsqllint -c` に渡す config パス |
| `tsqllint.runOnSave` | boolean | true | 保存時 lint を有効化 |
| `tsqllint.fixOnSave` | boolean | false | 保存時に `tsqllint --fix` を実行（保存済みファイルのみ） |
| `tsqllint.runOnType` | boolean | false | 入力中 lint を有効化 |
| `tsqllint.debounceMs` | number | 500 | 入力中 lint の debounce（ms） |
| `tsqllint.timeoutMs` | number | 10000 | `tsqllint` 実行のタイムアウト（ms） |

---

## 6. エラー表示・ユーザー誘導

### 6.1 `tsqllint` が見つからない場合

- 通知に以下を含める
  - 原因：`tsqllint` が起動できない（PATH 未設定または未インストール）
  - 次にやること：OS 別の導入手順（dotnet/brew/npm）

### 6.2 config が不正／期待通り動かない場合

- 通知に以下を含める
  - stderr（可能な範囲で）
  - 次にやること：`tsqllint --print-config` の案内

### 6.3 失敗時の出力方針

- 失敗時は「stderr + 次にやること」を必ず提示する（単なる “失敗しました” で終えない）
- 開発者向け詳細ログは OutputChannel に出力する（通常は静か、失敗時のみ通知）

---

## 7. 非機能・制約

- パフォーマンス
  - 入力中 lint は debounce し、外部プロセス多重起動を抑制する
  - 初期はファイル単位 lint を基本とし、ワークスペース全体の重い解析は行わない
- 移植性
  - Windows/macOS/Linux のパス差異を考慮してファイルパスを解決する

---

## 8. 未決事項（要件からの引き継ぎ）

1. lint 対象：保存時のみ／リアルタイムの必要性（`runOnType` の運用方針）
2. config：拡張が `-c` を常に付与する運用にするか（現仕様は「指定時のみ」）
3. 対象範囲：単一ファイル lint のみか、ディレクトリ/ワイルドカード lint を提供するか

---

## 9. 参考

- tsqllint 出力例：https://github.com/tsqllint/tsqllint-sample-plugin
- tsqllint 本体：https://github.com/tsqllint/tsqllint
- 出力順序 Issue：https://github.com/tsqllint/tsqllint/issues/130
