import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { APP_DESCRIPTION, APP_NAME } from './src/appInfo.ts';

/** index.html の %APP_NAME% を、ビルド時・開発サーバー起動時に APP_NAME へ置き換える。 */
const appNameInHtml: Plugin = {
  name: 'app-name-in-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
};

export default defineConfig({
  base: '/route-auto-input-yakkyoku/',
  plugins: [
    appNameInHtml,
    VitePWA({
      registerType: 'autoUpdate',
      // 自前でmain.tsからregisterSW()を呼び、更新が見つかったら自動で1回だけ
      // 再読み込みするようにするため、既定の(ただ登録するだけの)自動注入は使わない。
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_DESCRIPTION,
        lang: 'ja',
        start_url: '/route-auto-input-yakkyoku/',
        scope: '/route-auto-input-yakkyoku/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0b57d0',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // injectRegister: false にすると、vite-plugin-pwaがregisterType: 'autoUpdate'向けに
        // 自動で付けてくれるこの2つの設定が付かなくなるため、ここで明示する。
        // 付けないと、新しいservice workerが「待機中」のまま有効化されず、
        // main.tsのregisterSW()が待っている'activated'イベントが一生発火しない
        // (=更新しても、いつまでも古い版のまま)。
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    // Vitest は標準では CSS を処理せず、?raw で読んでも空文字になる。
    // 色のコントラスト検査(tests/styles.test.ts)で styles.css を読めるようにする。
    css: { include: [/styles.css/] },
  },
});
