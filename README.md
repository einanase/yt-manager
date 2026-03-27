# YouTube Channel Manager

プレミアムなデザインで複数のYouTubeチャンネルを管理するWebアプリです。

## 使い方

### 1. ローカルサーバーの起動
このディレクトリで以下のコマンドを実行し、ブラウザで `http://localhost:8000` を開いてください。

```bash
python -m http.server 8000
```

### 2. 実際のYouTube APIとの連携
現在はモックデータが表示されています。実際のデータを使用するには以下の手順が必要です。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成します。
2. **YouTube Data API v3** を有効にします。
3. **OAuth 2.0 クライアント ID** または **API キー** を取得します。
4. `youtube.js` の `constructor` または `setApiKey` メソッドで、取得した情報を設定してください。

## ファイル構成
- `index.html`: アプリの構造
- `style.css`: プレミアム・デザインシステム（グラスモーフィズム）
- `app.js`: UIロジック、ステート管理、アニメーション
- `youtube.js`: YouTube API サービス層（データの取得・更新）
