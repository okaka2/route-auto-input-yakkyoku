import type { MapProvider } from './mapProviders';
import { splitIntoRoutes } from './routeSplitter';

/**
 * 訪問順に並んだ住所から、LINEなどで送るためのテキストを作る。
 * 受け取った人はURLを開くだけで、同じルートが入った地図を使える(このアプリは要らない)。
 *
 * - 1本目のルートは出発地を付けず、開いた人の現在地から案内を始める。
 * - ルートが分かれるときは、2本目以降は前のルートの最後の訪問先から続ける
 *   (分かれ目の地点は前後どちらのルートにも入っている。splitIntoRoutes を参照)。
 * - 渡すのは住所だけで、名前は含めない。
 */
export function buildShareText(
  addresses: readonly string[],
  maxStopsPerRoute: number,
  provider: MapProvider,
): string {
  const routes = splitIntoRoutes(addresses, maxStopsPerRoute);
  const urls = routes.map((route, index) => provider.buildUrl(route, { fromCurrentLocation: index === 0 }));

  if (urls.length === 1) {
    return [`訪問ルート(${addresses.length}件)`, urls[0]!].join('\n');
  }
  return [
    `訪問ルート(${addresses.length}件・${urls.length}本)`,
    ...urls.map((url, index) => `ルート${index + 1}: ${url}`),
  ].join('\n');
}

/** shared: 共有メニューで送った / copied: クリップボードにコピーした / cancelled: 共有メニューを閉じた */
export type ShareResult = 'shared' | 'copied' | 'cancelled';

/**
 * スマホでは標準の共有メニュー(LINEなどを選べる)を開く。
 * 共有メニューが無い環境(PCのブラウザなど)では、クリップボードにコピーする。
 */
export async function shareText(text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
      throw error;
    }
  }
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return 'copied';
  }
  throw new Error('この端末では共有できませんでした。');
}
