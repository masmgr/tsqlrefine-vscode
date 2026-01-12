# 詳細設計：土台整備（tsqllint-vscode-lite）

本書は `docs/requirement.md` および `docs/external-spec.md` の実装に先立ち、VS Code 拡張機能開発の「土台（テンプレ、型、lint、テスト、CI）」を整備するための詳細設計を定義する。

---

## 1. 目的・ゴール

### 1.1 目的

- `yo code` による TypeScript 拡張テンプレを作成し、以降の実装を載せるための開発基盤を確立する。
- `strict` な TypeScript、ESLint、Vitest、および CI を先に通し、「常に壊れていない状態」を初期段階から担保する。

### 1.2 土台フェーズの完了条件（Definition of Done）

- `npm run typecheck` が成功する。
- `npm run lint` が成功する（警告/エラーはゼロ）。
- `npm test`（Vitest）が成功する。
- `npm run build` が成功し、`out/` にビルド成果物が生成される。
- GitHub Actions の CI が PR / push で同じコマンドを実行し、成功する。
- 拡張機能を F5 で起動でき、アクティベーションでエラーが出ない（機能は未実装でも良い）。

---

## 2. スコープ

### 2.1 In Scope（本書で設計する範囲）

- `yo code` で作る VS Code 拡張（TypeScript）テンプレ土台
- TypeScript 設定（`strict` + 追加の安全系オプション）
- ESLint（TypeScript type-aware lint を含む）設定
- Vitest（ユニットテスト）導入
- GitHub Actions（CI）導入
- 推奨ディレクトリ構成、npm scripts、品質ゲートの定義

### 2.2 Out of Scope（次工程）

- `tsqllint` 呼び出し、stdout パース、Diagnostics 表示の本実装
- 仕様テスト（ゴールデン）と、フェイクCLI/統合テスト
- LSP の導入/再導入

---

## 3. 前提

- Node.js は LTS を使用する（CI も LTS に合わせる）。
- パッケージマネージャは npm を標準とする（`package-lock.json` による再現性確保）。
- クロスプラットフォーム（Windows/macOS/Linux）を前提に、パス/改行差異の影響を受けにくい構成とする。

---

## 4. リポジトリ構成（案）

```
.
├─ .github/
│  └─ workflows/
│     └─ ci.yml
├─ .vscode/
│  ├─ launch.json
│  └─ tasks.json
├─ docs/
│  ├─ requirement.md
│  ├─ external-spec.md
│  └─ detail-design-foundation.md
├─ src/
│  ├─ extension.ts
│  └─ (今後: lint/, config/, ui/ 等を追加)
├─ test/
│  └─ unit/
│     └─ sample.test.ts
├─ out/              (ビルド成果物)
├─ .eslintrc.cjs
├─ .eslintignore     (必要に応じて)
├─ .gitignore
├─ package.json
├─ package-lock.json
├─ tsconfig.json
├─ tsconfig.eslint.json
├─ vitest.config.ts
└─ README.md
```

- `src/` は拡張本体（VS Code API に依存する層）。
- `test/unit/` は純粋関数・ロジック中心（VS Code API 依存を避ける）で Vitest を適用する。
- `out/` は `tsc` の出力先（コミット対象外）。

---

## 5. 生成手順（テンプレ作成）

### 5.1 初期生成

- 前提：`yo` / `generator-code` が未導入の場合は `npm i -g yo generator-code` を実行する。
- `yo code` を用いて「New Extension (TypeScript)」を生成する。
- 初期状態で生成される `src/extension.ts`（activate/deactivate）を残し、以降の実装の起点とする。

### 5.2 初期依存の整理

- `vscode` 型定義（テンプレ標準）を維持する。
- テストフレームワークは Vitest に統一する（テンプレが Mocha を含む場合は移行する）。

---

## 6. TypeScript 設計（strict）

### 6.1 基本方針

- `tsconfig.json` は `strict: true` を必須とする。
- `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 等の「落とし穴を早期に検出する」設定を有効化する。
- `src/` のビルドと、ESLint の type-aware lint で参照する `tsconfig.eslint.json` を分ける。

### 6.2 `tsconfig.json`（案）

- 目的：拡張本体のビルド（`out/` 生成）
- 主な方針
  - `rootDir: "src"`, `outDir: "out"`
  - `sourceMap: true`（デバッグ容易性）
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
  - `noImplicitOverride: true`
  - `noPropertyAccessFromIndexSignature: true`

### 6.3 `tsconfig.eslint.json`（案）

- 目的：ESLint の type-aware lint 用（`test/` も含む）
- `include`: `["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]`
- `noEmit: true`

---

## 7. ESLint 設計

### 7.1 基本方針

- TypeScript ESLint を採用し、型情報を利用するルールも有効化する（type-aware）。
- 重大なバグに直結しやすいルールを優先する（未処理 Promise、危険な any 等）。

### 7.2 依存パッケージ（案）

- `eslint`
- `typescript-eslint`（`@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` 相当）

必要に応じて追加：
- `eslint-plugin-import`（import の健全性）
- `eslint-config-prettier`（Prettier を入れる場合のみ、競合回避）

### 7.3 ルール方針（案）

- `@typescript-eslint/no-floating-promises`: 有効（未await Promise の取りこぼし防止）
- `@typescript-eslint/consistent-type-imports`: 有効（型 import を安定化）
- `@typescript-eslint/no-misused-promises`: 有効（イベントハンドラ等の誤用防止）
- `@typescript-eslint/switch-exhaustiveness-check`: 有効（将来の拡張に備える）

---

## 8. Vitest 設計（ユニットテスト）

### 8.1 基本方針

- 土台フェーズでは「純粋関数」のテストを先に整備できる状態を作る。
- `vscode` API に依存するテスト（Extension host 起動）は次工程に回す。

### 8.2 設定方針（案）

- `vitest.config.ts` を追加し、`test/unit/**/*.test.ts` を対象とする。
- Node 環境（`environment: "node"`）で実行する。
- カバレッジは必須ゲートにしない（次工程で段階導入）。

### 8.3 サンプルテスト

- CI の健全性確認用に、`test/unit/sample.test.ts` を 1 本用意し、`npm test` の疎通を担保する。

---

## 9. npm scripts 設計（案）

`package.json` の scripts は、CI でそのまま利用できる粒度に分ける。

- `typecheck`：`tsc -p tsconfig.json --noEmit`（もしくは `tsc -p tsconfig.json` を `build` に寄せる）
- `build`：`tsc -p tsconfig.json`
- `vscode:prepublish`：`npm run build`（VS Code 拡張の標準フックとして用意）
- `lint`：`eslint .`
- `test`：`vitest run`
- `watch`：`tsc -watch -p tsconfig.json`
- `test:watch`：`vitest`

（任意）
- `package`：拡張のパッケージング（後工程で `@vscode/vsce` 採用時）

---

## 10. CI 設計（GitHub Actions）

### 10.1 方針

- PR / push で、ローカルと同一の品質ゲート（typecheck / lint / test / build）を実行する。
- クロスプラットフォーム対応を担保するため、OS のマトリクス実行を推奨する。

### 10.2 ワークフロー（案）

- トリガ
  - `on: [push, pull_request]`
- ジョブ構成
  - `ci` 1 ジョブで直列に実行（土台フェーズでは単純さを優先）
- 実行内容
  - `actions/checkout`
  - `actions/setup-node`（LTS、npm cache 有効）
  - `npm ci`
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`

### 10.3 推奨マトリクス

- `os: [ubuntu-latest, windows-latest, macos-latest]`
- Node は `lts/*`（固定したい場合は `.nvmrc` / `engines` を追加し、CI も一致させる）

---

## 11. VS Code 実行・デバッグ設定（.vscode）

テンプレ生成物を基本とし、以下を満たすこと。

- F5 起動で Extension Development Host が起動する
- TypeScript の sourcemap でブレークポイントが機能する

---

## 12. 成果物一覧（土台フェーズ）

- 生成物（テンプレ）
  - `package.json`, `src/extension.ts`, `.vscode/launch.json`, `.vscode/tasks.json`（テンプレ由来）
- 追加/更新（品質ゲート）
  - `tsconfig.json`, `tsconfig.eslint.json`
  - `.eslintrc.cjs`（必要なら `.eslintignore`）
  - `vitest.config.ts`, `test/unit/*.test.ts`
  - `.github/workflows/ci.yml`

---

## 13. 以降工程への引き継ぎ

土台が整ったら、次工程（仕様テスト→最小実装）では以下の分割方針を推奨する。

- `lint/parseOutput.ts`：stdout パース（純粋関数）→ Vitest で仕様テストに移行しやすい
- `lint/runTsqllint.ts`：外部実行（副作用）→ モック/フェイクCLI で統合テストを用意しやすい
- `extension.ts`：イベント/Diagnostics 更新（VS Code API 依存）→ E2E を後段で追加
