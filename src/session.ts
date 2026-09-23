/**
 * Googleマップへ遷移して戻ってきたとき(iOSがPWAをメモリから追い出した場合を含む)に
 * 選択・訪問順・開いたルートを復元するための一時記録。`localStorage` に保存する
 * (`sessionStorage` はページの再読み込みでも失われうるため使わない)。
 *
 * 保存するのは訪問先のid(UUID)・開いたルートの番号と日時・タイムスタンプのみ。
 * 氏名・住所は絶対に書き込まない。
 */

export type OpenedRoute = {
  /** ルートの番号(0始まり) */
  index: number;
  /** 開いた日時(ISO 8601)。日時が分からない古い記録から復元したものは '' */
  at: string;
};

export type SessionRecord = {
  /** 訪問順に並んだ、選択中の訪問先のid */
  selectedIds: string[];
  opened: OpenedRoute[];
  /** 記録した日時(ISO 8601)。12時間で期限切れにする */
  timestamp: string;
};

const STORAGE_KEY = 'route-auto-input-yakkyoku:session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isOpenedRoute(value: unknown): value is OpenedRoute {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const route = value as Record<string, unknown>;
  return Number.isInteger(route.index) && typeof route.at === 'string';
}

/**
 * 保存された値を SessionRecord に直す。形式が合わなければ null。
 * 古い形式(開いたルートの番号だけの `openedRouteIndexes`)も読み、日時は '' にする。
 */
function toSessionRecord(value: unknown): SessionRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.selectedIds) ||
    !record.selectedIds.every((id) => typeof id === 'string') ||
    typeof record.timestamp !== 'string'
  ) {
    return null;
  }

  let opened: OpenedRoute[];
  if (Array.isArray(record.opened)) {
    if (!record.opened.every(isOpenedRoute)) {
      return null;
    }
    opened = record.opened.map((route) => ({ index: route.index, at: route.at }));
  } else if (
    Array.isArray(record.openedRouteIndexes) &&
    record.openedRouteIndexes.every((index) => typeof index === 'number')
  ) {
    opened = record.openedRouteIndexes.map((index) => ({ index, at: '' }));
  } else {
    return null;
  }

  return { selectedIds: record.selectedIds as string[], opened, timestamp: record.timestamp };
}

/** 保存に失敗しても(プライベートブラウズ等で使えない場合も)例外を投げない。 */
export function saveSession(record: SessionRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorageが使えない環境では諦める。復元できないだけで、他の動作には影響しない。
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上。
  }
}

/**
 * 記録を読み込む。次のいずれかに該当すれば `null` を返す:
 * 記録がない、壊れている(形式が合わない)、`now` から12時間より古い。
 * 訪問先のidがまだ存在するかどうかはここでは確認しない
 * (`withPatients` がDB再読み込み時に自動で選択から外すため)。
 */
export function loadSession(now: Date = new Date()): SessionRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = toSessionRecord(JSON.parse(raw));
    if (parsed === null) {
      return null;
    }
    const savedAt = new Date(parsed.timestamp).getTime();
    if (Number.isNaN(savedAt) || now.getTime() - savedAt > MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
