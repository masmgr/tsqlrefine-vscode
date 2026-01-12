# 要件定義書（ドラフト）

## 0. 文書情報

- 対象：VS Code 拡張 `tsqllint-lite`（内部に LSP サーバーを同梱）
- 目的：外部ツール `tsqllint`（TSQLLint）を実行し、SQL の lint 結果を Diagnostics として提示する
- 前提：内部実装は LSP（Language Server Protocol）採用を既定とする

---

## 1. 目的

- VS Code 拡張として `tsqllint` を実行し、SQL のアンチパターン検出結果を Diagnostics（赤線・問題リスト・ホバー）で表示する。
- 既存拡張（古い基盤）を延命せず、最新テンプレ土台で段階的に移植できる状態を作る。

---

## 2. 前提（tsqllint 仕様）

### 2.1 ツールのインストール形態

- `tsqllint` は dotnet tool / Homebrew / npm で導入可能 [2]
  - dotnet tool: `dotnet tool install --global TSQLLint` [2]
  - Homebrew: `brew install tsqllint` [2]
  - npm: `npm install tsqllint -g` [2]

### 2.2 実行インターフェース（最小）

- lint: `tsqllint <file.sql | dir | wildcard>` [2]
- config: `-c` 指定、もしくは探索（環境変数/カレント/ホーム等） [2]
- 出力（stdout）：ConsoleReporter が生成する固定フォーマット（1行=1違反）
  - `<file>(<line>,<col>): <severity> <ruleName> : <message>.`
  - `severity` は `error` / `warning` の小文字のみ（Off は出力されない）
  - 構文エラー時は `ruleName=invalid-syntax`
  - 最後にサマリーが 1 ブロック出る（ファイル数が 0 の場合は出ない）
  - 入力パスが無効などの場合は上記と異なる素のメッセージが出る
- 終了コード：ルールが error の違反があると非0になりうる [2]
  - warning は0になりうる（ツール仕様として説明あり） [2]

---

## 3. スコープ

### In Scope

- `.sql` を対象に、`tsqllint` を実行して Diagnostics を表示する
- 保存時（onSave）での lint（変更時は debounce で任意）
- 手動実行コマンド（コマンドパレット等）による lint
- `.tsqllintrc` の扱い（探索/パス指定/`--print-config` 連携）
- インストール検出・エラーメッセージ改善（導入手順提示）
- LSP（初期から採用）：診断生成は言語サーバー側に集約し、拡張はクライアントに専念する
- 仕様テスト/CI（typecheck+lint+test+build）

### Out of Scope（初期）

- 高度補完（ルール名補完など）
- ワークスペース全体の重い解析（初期はファイル単位）

---

## 4. 機能要件

### 4.1 lint 実行トリガ

- 基本：保存時 lint
- 任意：保存時 fix（`tsqllint --fix`）
- オプション：変更時 lint（debounce、例 300-800ms）
- 手動実行：コマンド `tsqllint-lite.run`
- 手動 fix：コマンド `tsqllint-lite.fix`
- 同時実行制御：
  - 同一ファイル（URI）の lint は多重起動しない
  - 連続トリガは「最新のみ」へ集約し、必要なら前回実行を中断できること

### 4.2 `tsqllint` 実行

- 実行コマンドは `tsqllint` を直接呼ぶ（PATH 解決）
- 実行前に `tsqllint` の存在確認を行い、存在しなければエラー通知する（`tsqllint.path` 指定時は当該パス、未指定時は PATH 解決の可否）。
- 引数（最小）：
  - 対象ファイルパス
  - 任意で `-c <configPath>`（ユーザー設定で指定可能）
- 終了コードの扱い：
  - exitCode != 0 でも「実行失敗」と断定しない（error 違反で非0になりうる） [2]
  - ただし「tsqllint 自体が起動できない」「stderr に tool not found」などは実行失敗

### 4.3 出力パース → Diagnostics 変換

- stdout を 1 行ずつ読み取り、以下を抽出して Diagnostic を生成する [1]
  - file, line, column, severity, ruleName, message
- 想定フォーマット（確定）：
  - `<file>(<line>,<col>): <severity> <ruleName> : <message>.`
- マッピング：
  - error → `DiagnosticSeverity.Error`
  - warning → `DiagnosticSeverity.Warning`

### 4.4 設定（Configuration）

- 拡張設定で提供：
  - `tsqllint.path`（任意：明示パス。最優先）
  - `tsqllint.configPath`（任意：`-c` で渡す）
  - `tsqllint.runOnSave`（default true）
  - `tsqllint.fixOnSave`（default false：保存時に `--fix` を実行）
  - `tsqllint.runOnType`（default false）
  - `tsqllint.debounceMs`（default 500）
  - `tsqllint.timeoutMs`（default 10000）
- `.tsqllintrc` の探索は `tsqllint` 側仕様に任せる（優先順位が明記されている） [2]
  - 拡張は configPath 指定がある時だけ `-c` を付与する

### 4.5 エラー表示（ユーザー誘導）

- `tsqllint` が見つからない場合：
  - OS 別に導入手順（dotnet/brew/npm）を提示する [2]
- config に問題がある場合：
  - `--print-config` の存在を案内する [2]
- 失敗時は「stderr + 次にやること」を必ず表示する（単なる “失敗しました” で終えない）

---

## 5. 非機能要件

- Windows/macOS/Linux で動作する
- タイムアウト（例：10秒、設定化）に対応する
- 実行時の cwd は、可能なら対象ファイルを含むワークスペースフォルダ、なければファイルのディレクトリとする
- ログ：
  - 通常は静かにし、失敗時のみ詳細を出せること
  - LSP のログは LanguageClient の出力へ集約できること

---

## 6. テスト要件（勝ち筋）

### 6.1 仕様テスト（最重要）

- SQL サンプルと期待 Diagnostics を JSON で固定（行/列/メッセージ/Severity）
- 目的：作り直しで挙動がズレたら即検知する

### 6.2 テスト階層

- Unit（dotnet 不要）
  - 出力パーサ（文字列 → Diagnostics）
  - パス正規化（相対/絶対、Windows パス）
  - 設定解決（path/configPath/timeout 等）
- Integration（CI で任意）
  - 実 `tsqllint` を入れて数ケース実行（導入コストが許せば）
  - もしくはフェイク CLI（同形式の stdout を吐くだけ）でプロセス周りを叩く
- E2E（最小）
  - VS Code 起動 → SQL を開く → 保存 → Diagnostics が出ることを確認する

---

## 7. 実装方針（LSP 採用・推奨）

- Client（VS Code 拡張）は LSP クライアント起動とコマンド橋渡しに限定する
- Server（言語サーバー）が `tsqllint` 実行・stdout パース・`publishDiagnostics` を担当する

---

## 8. 未決事項（ここだけ決めれば着手できる）

1. lint 対象：保存時のみ？リアルタイムも要る？
2. config：拡張が `-c` を常に付ける運用？（推奨は「指定ある時だけ」）
3. 対象範囲：単一ファイル lint だけ？ディレクトリ/ワイルドカードもやる？ [2]

---

[1]: https://github.com/tsqllint/tsqllint-sample-plugin "GitHub - tsqllint/tsqllint-sample-plugin"
[2]: https://github.com/tsqllint/tsqllint "GitHub - tsqllint/tsqllint: Configurable linting for TSQL"
[3]: https://github.com/tsqllint/tsqllint/issues/130 "Order error output by row number ・ Issue #130 ・ tsqllint/tsqllint ・ GitHub"
