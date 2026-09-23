import { buildGoogleMapsUrl, type MapUrlOptions } from './googleMapsUrl';

/**
 * 地図サービスの差し替え口。画面は MapProvider だけを知り、URLの作り方や
 * ボタンに出すサービス名(label)は、ここで決まる。
 * Apple Maps などに対応するときは、この型の値を1つ足して DEFAULT_MAP_PROVIDER を
 * 切り替えるか、選べるようにする。
 */
export type MapProvider = {
  id: string;
  /** 「〇〇で開く」の〇〇に入る、サービスの表示名 */
  label: string;
  /**
   * 訪問順に並んだ住所から、地図を開くURLを作る。1件なら地点検索、2件以上なら経路。
   * options.fromCurrentLocation なら、開いた人の現在地から出発する経路にする(共有用)。
   */
  buildUrl(addresses: readonly string[], options?: MapUrlOptions): string;
};

export const googleMapsProvider: MapProvider = {
  id: 'google',
  label: 'Googleマップ',
  buildUrl: buildGoogleMapsUrl,
};

export const DEFAULT_MAP_PROVIDER: MapProvider = googleMapsProvider;
