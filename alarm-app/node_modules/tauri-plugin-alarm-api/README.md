# tauri-plugin-alarm

Android のネイティブ [`AlarmManager`](https://developer.android.com/reference/android/app/AlarmManager) API を Tauri アプリから利用するプラグインです。指定した時刻にアラームを設定し、発火時にシステム通知を表示します。

## 対応プラットフォーム

| プラットフォーム | サポート |
|----------------|---------|
| Android        | ✅      |
| iOS            | ❌      |
| macOS          | ❌      |
| Windows        | ❌      |
| Linux          | ❌      |

---

## セットアップ

### 1. Rust 依存関係の追加

`src-tauri/Cargo.toml` にプラグインを追加します：

```toml
[dependencies]
tauri-plugin-alarm = { path = "../../tauri-plugin-alarm" }
```

### 2. プラグインを Tauri に登録

`src-tauri/src/lib.rs`：

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_alarm::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3. タuri 権限の設定

`src-tauri/tauri.conf.json` の `plugins` セクションに権限を追加します：

```json
{
  "plugins": {
    "alarm": {
      "permissions": [
        "allow-set_alarm",
        "allow-cancel_alarm",
        "allow-list_alarms",
        "allow-check_exact_alarm_permission",
        "allow-open_exact_alarm_settings"
      ]
    }
  }
}
```

### 4. フロントエンド API のインストール

```sh
npm install tauri-plugin-alarm-api
# または
pnpm add tauri-plugin-alarm-api
```

---

## Android パーミッション

このプラグインの `AndroidManifest.xml` が以下のパーミッションをアプリに自動マージします。追加の設定は不要です。

| パーミッション | 必要な理由 |
|---------------|------------|
| `POST_NOTIFICATIONS` | アラーム発火時に通知を表示（Android 13 / API 33 以上） |
| `SCHEDULE_EXACT_ALARM` | 正確な時刻にアラームを発火（Android 12 / API 31 以上） |
| `RECEIVE_BOOT_COMPLETED` | 端末再起動後にアラームを自動復元 |

### 正確なアラーム（Android 12+）について

Android 12（API 31）以上では、`SCHEDULE_EXACT_ALARM` はユーザーが設定画面で許可する必要があります。

```typescript
const { canScheduleExactAlarms } = await checkExactAlarmPermission()
if (!canScheduleExactAlarms) {
  // 設定画面へ誘導
  await openExactAlarmSettings()
}
```

許可がない場合、プラグインは自動的に **不正確なアラーム**（`set` / `setAndAllowWhileIdle`）へフォールバックします。

---

## API リファレンス

### `setAlarm(options: SetAlarmOptions): Promise<AlarmInfo>`

アラームをスケジュールします。同じ `id` で呼び出すと既存のアラームを上書きします。

```typescript
import { setAlarm } from 'tauri-plugin-alarm-api'

const alarm = await setAlarm({
  id: 1,
  title: '朝のアラーム',
  message: 'おはようございます！',
  triggerAtMs: Date.now() + 8 * 60 * 60 * 1000,  // 8 時間後
})
```

#### `SetAlarmOptions`

| フィールド | 型 | 必須 | デフォルト | 説明 |
|-----------|-----|------|-----------|------|
| `id` | `number` | ✅ | — | アラームの一意な ID（同じ ID で上書き） |
| `title` | `string` | ✅ | — | 通知タイトル |
| `message` | `string` | | — | 通知本文 |
| `triggerAtMs` | `number` | ✅ | — | 発火時刻（Unix タイムスタンプ ms） |
| `alarmType` | `AlarmType` | | `"RTC_WAKEUP"` | アラームタイプ（下表参照） |
| `exact` | `boolean` | | `true` | 正確なアラームを使用する |
| `allowWhileIdle` | `boolean` | | `true` | Doze モード中でも発火する |
| `repeatIntervalMs` | `number` | | — | 繰り返し間隔 ms（省略で一度だけ発火） |

#### `AlarmType`

| 値 | 説明 |
|----|------|
| `"RTC_WAKEUP"` | 指定した時刻にデバイスをウェイクアップして発火（推奨） |
| `"RTC"` | 指定した時刻に発火（スリープ中は発火しない） |
| `"ELAPSED_REALTIME_WAKEUP"` | 起動からの経過時間でウェイクアップして発火 |
| `"ELAPSED_REALTIME"` | 起動からの経過時間で発火（スリープ中は発火しない） |

---

### `cancelAlarm(id: number): Promise<void>`

スケジュール済みのアラームをキャンセルします。

```typescript
import { cancelAlarm } from 'tauri-plugin-alarm-api'

await cancelAlarm(1)
```

---

### `listAlarms(): Promise<AlarmInfo[]>`

現在スケジュールされているすべてのアラームを返します。

```typescript
import { listAlarms } from 'tauri-plugin-alarm-api'

const alarms = await listAlarms()
alarms.forEach(a => console.log(a.id, a.title, new Date(a.triggerAtMs)))
```

#### `AlarmInfo`

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `id` | `number` | アラーム ID |
| `title` | `string` | 通知タイトル |
| `message` | `string?` | 通知本文 |
| `triggerAtMs` | `number` | 発火時刻（Unix タイムスタンプ ms） |
| `alarmType` | `AlarmType` | アラームタイプ |
| `exact` | `boolean` | 正確なアラームかどうか |
| `repeatIntervalMs` | `number?` | 繰り返し間隔 ms |

---

### `checkExactAlarmPermission(): Promise<CheckPermissionResult>`

正確なアラームをスケジュールする権限があるか確認します。Android 11 以下では常に `true` を返します。

```typescript
import { checkExactAlarmPermission } from 'tauri-plugin-alarm-api'

const { canScheduleExactAlarms } = await checkExactAlarmPermission()
console.log(canScheduleExactAlarms) // true / false
```

---

### `openExactAlarmSettings(): Promise<void>`

正確なアラームの権限設定画面を開きます（Android 12 以上のみ有効）。Android 11 以下では何もしません。

```typescript
import { openExactAlarmSettings } from 'tauri-plugin-alarm-api'

await openExactAlarmSettings()
```

---

## 使用例

### 基本的なアラームの設定とキャンセル

```typescript
import { setAlarm, cancelAlarm, listAlarms } from 'tauri-plugin-alarm-api'

// 1 分後にアラームをセット
await setAlarm({
  id: 100,
  title: 'テストアラーム',
  message: '1 分が経過しました',
  triggerAtMs: Date.now() + 60_000,
})

// 一覧表示
const alarms = await listAlarms()
console.log(`スケジュール中: ${alarms.length} 件`)

// キャンセル
await cancelAlarm(100)
```

### 権限チェック付きアラーム設定

```typescript
import {
  checkExactAlarmPermission,
  openExactAlarmSettings,
  setAlarm,
} from 'tauri-plugin-alarm-api'

async function scheduleAlarm() {
  const { canScheduleExactAlarms } = await checkExactAlarmPermission()

  if (!canScheduleExactAlarms) {
    // ユーザーを設定画面へ誘導
    await openExactAlarmSettings()
    return
  }

  await setAlarm({
    id: 1,
    title: '起床',
    triggerAtMs: Date.now() + 8 * 60 * 60 * 1000,
    exact: true,
    allowWhileIdle: true,
  })
}
```

### 毎日繰り返すアラーム

```typescript
import { setAlarm } from 'tauri-plugin-alarm-api'

// 毎日この時刻から 24 時間ごとに発火
await setAlarm({
  id: 200,
  title: 'デイリーリマインダー',
  triggerAtMs: Date.now() + 5_000,        // 5 秒後に初回発火
  repeatIntervalMs: 24 * 60 * 60 * 1000, // 以降 24 時間ごと
})
```

---

## Android バージョン別の動作

| Android バージョン | `exact: true` の動作 |
|--------------------|----------------------|
| Android 5 以下 (API < 21) | `setExact()` |
| Android 6–11 (API 23–30) | `setExactAndAllowWhileIdle()` |
| Android 12+ (API 31+) | 権限あり: `setExactAndAllowWhileIdle()`<br>権限なし: `setAndAllowWhileIdle()`（フォールバック） |

> **注意**: Android 4.4（API 19）以上では繰り返しアラーム（`repeatIntervalMs` 指定時）は常に不正確になります。これは Android の制約です。

---

## 端末再起動後のアラーム復元

このプラグインはアラーム情報を `SharedPreferences` に保存し、`BootReceiver` を通じて端末再起動後に自動的にアラームを再スケジュールします。アプリ更新後（`MY_PACKAGE_REPLACED`）も同様に復元されます。

---

## テスト

### Rust

```sh
cargo test
```

### Android ユニットテスト（デバイス不要）

```sh
cd android && ./gradlew test
```

### Android 計測テスト（デバイス / エミュレータ必要）

```sh
cd android && ./gradlew connectedAndroidTest
```

---

## リリース

`v*` タグを push すると GitHub Actions が自動で npm publish します。

```sh
# package.json のバージョンを更新してからタグを作成・push
git tag v0.2.0
git push origin v0.2.0
```

### 初回セットアップ（メンテナ向け）

1. https://www.npmjs.com → Access Tokens → **Generate New Token（Automation タイプ）**
2. GitHub リポジトリの Settings → Secrets and variables → Actions → `NPM_TOKEN` に登録
