# kintone GPS 地図アプリ

kintone に蓄積された GPS データを地図上に可視化する Google Apps Script（GAS）ウェブアプリです。

## 機能

- **移動履歴表示** — GPS 地点を時刻ベースのカラーグラデーションでプロット
- **温度表示モード** — 各地点の気温を色で表現（白 → 青(15℃) → 緑 → 黄 → 赤(35℃) → 紫(40℃)）
- **最終記録日表示** — データの最新日時を画面上に表示
- **期間フィルタ** — 直近1日 / 直近10日 / 任意期間を切り替え
- **道の駅アイコン** — 道の駅訪問履歴アプリのデータをマーカーで表示
- **特定地点の★表示** — 送信種別=1 の地点を星マーカーで表示
- **除外エリアフィルタ** — 指定エリア内の GPS 地点を非表示（Haversine 距離計算）
- **スマホ対応** — デバイス幅に応じてマーカーサイズ・文字サイズを自動調整
- **ローディングスピナー** — 初期ロード・期間指定取得中に半透明オーバーレイを表示
- **Google マップリンク** — ポップアップから各地点を Google マップで開ける

## 構成

```
.
├── Code.gs           # GAS サーバーサイド（データ取得・加工）
├── index.html        # フロントエンド（Leaflet.js による地図表示）
├── appsscript.json   # GAS プロジェクト設定
├── .env.example      # スクリプトプロパティのテンプレート
└── images/
    └── michinoeki_icon.png  # 道の駅マーカーアイコン
```

## 前提条件

- kintone アカウントと以下のアプリ
  - GPS アプリ（緯度・経度・送信日時・送信種別・温度フィールドを含む）
  - 道の駅履歴アプリ（任意）
  - 除外エリアアプリ（任意）
- Google アカウント（Google Apps Script 用）
- [clasp](https://github.com/google/clasp)（ローカルからのコード同期用）

## セットアップ

### 1. GAS プロジェクトの準備

1. [Google Apps Script](https://script.google.com/) で新規プロジェクトを作成
2. プロジェクトの設定画面でスクリプト ID を確認する
3. このリポジトリをクローンしたディレクトリに `.clasp.json` を作成する

```json
{"scriptId": "YOUR_SCRIPT_ID", "rootDir": "."}
```

4. `clasp push` でコードを GAS エディタに同期する

### 2. スクリプトプロパティの設定

GAS エディタの「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録します。

| プロパティ名 | 内容 |
|---|---|
| `KINTONE_DOMAIN` | kintone ドメイン（例: `your-domain.cybozu.com`） |
| `APP_ID` | GPS アプリの ID |
| `API_TOKEN` | GPS アプリの API トークン |
| `FIELD_LAT` | 緯度フィールドコード |
| `FIELD_LNG` | 経度フィールドコード |
| `FIELD_DATETIME` | 送信日時フィールドコード |
| `FIELD_KEY` | 送信日時 YYYYMMddHHmm フィールドコード |
| `FIELD_TYPE` | 送信種別フィールドコード |
| `FIELD_TEMP` | 温度フィールドコード |
| `KINTONE_APP_ID_MICHINOEKI_RIREKI` | 道の駅履歴アプリ ID（任意） |
| `KINTONE_API_TOKEN_MICHINOEKI_RIREKI` | 道の駅履歴アプリ API トークン（任意） |
| `FIELD_MICHINOEKI_NAME` | 道の駅名フィールドコード（任意） |
| `KINTONE_APP_ID_EXCLUDE` | 除外エリアアプリ ID（任意） |
| `KINTONE_API_TOKEN_EXCLUDE` | 除外エリアアプリ API トークン（任意） |
| `FIELD_EXCLUDE_LAT` | 除外エリア緯度フィールドコード（任意） |
| `FIELD_EXCLUDE_LON` | 除外エリア経度フィールドコード（任意） |
| `FIELD_EXCLUDE_RADIUS` | 除外エリア半径（m）フィールドコード（任意） |
| `FIELD_EXCLUDE_NAME` | 除外エリア名称フィールドコード（任意） |

`.env.example` を参考にしてください。

### 3. デプロイ

GAS エディタ右上「デプロイ」→「新しいデプロイ」→ 種別「ウェブアプリ」で公開します。

> **注意:** `clasp deploy` は使用しないでください。デプロイ種別が変わり、ウェブアプリとして動作しなくなります。再デプロイ時は「デプロイを管理」→ 鉛筆アイコン →「新しいバージョン」→「デプロイ」の手順で行ってください。

## 使い方

デプロイ後に発行されたウェブアプリ URL をブラウザで開くと地図が表示されます。

| ボタン | 動作 |
|---|---|
| 移動履歴 / 温度 | 表示モードを切り替え |
| 最終記録日 | 最新 GPS 記録の日付を表示 |
| 直近1日 / 直近10日 | 期間を絞り込んで再表示 |
| 期間指定 | 開始日・終了日を入力して取得 |

## 技術スタック

- [Google Apps Script](https://developers.google.com/apps-script)
- [Leaflet.js](https://leafletjs.com/)
- [kintone REST API](https://cybozu.dev/ja/kintone/docs/rest-api/)
