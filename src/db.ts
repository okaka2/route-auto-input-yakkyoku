import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { DEFAULT_LABELS } from './defaultLabels';
import type { Patient } from './types';

const DB_NAME = 'route-auto-input-yakkyoku';
const DB_VERSION = 2;
const STORE = 'patients';
const META_STORE = 'meta';
const LABELS_KEY = 'labels';

interface RouteAutoInputDB extends DBSchema {
  patients: {
    key: string;
    value: Patient;
    indexes: { createdAt: string };
  };
  /** ラベルの一覧など、1件だけの設定的な値を置く場所。キーを直接指定して読み書きする。 */
  meta: {
    key: string;
    value: string[];
  };
}

let connection: Promise<IDBPDatabase<RouteAutoInputDB>> | null = null;

function getDb(): Promise<IDBPDatabase<RouteAutoInputDB>> {
  connection ??= openDB<RouteAutoInputDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (oldVersion < 2) {
        db.createObjectStore(META_STORE);
      }
    },
  });
  return connection;
}

/**
 * テストでデータベースを作り直すために接続を閉じる。
 * 接続を開いたままにすると deleteDB がブロックされるため、必ず close する。
 */
export async function closeDbForTest(): Promise<void> {
  if (connection === null) {
    return;
  }
  const db = await connection;
  db.close();
  connection = null;
}

/** ラベル機能より前に保存された記録はlabelsを持たないため、読み出すときに補う。 */
function normalizePatient(patient: Patient): Patient {
  return patient.labels === undefined ? { ...patient, labels: [] } : patient;
}

/** 登録が新しい順に返す。 */
export async function listPatients(): Promise<Patient[]> {
  const db = await getDb();
  const ascending = await db.getAllFromIndex(STORE, 'createdAt');
  return ascending.reverse().map(normalizePatient);
}

export async function savePatient(patient: Patient): Promise<void> {
  const db = await getDb();
  await db.put(STORE, patient);
}

export async function deletePatient(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/** 複数件まとめて削除する。 */
export async function deletePatients(ids: readonly string[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const id of ids) {
    await tx.store.delete(id);
  }
  await tx.done;
}

/** 既存データを全消去してから入れ替える。 */
export async function replaceAllPatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}

/** 既存データを残したまま、同じidは上書きして取り込む。 */
export async function mergePatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}

/**
 * 今あるラベルの名前の一覧(追加した順)。
 * まだ一度も保存したことがなければ(undefined)、初期設定のラベルを返す(読むだけで、
 * この時点ではDBには書き込まない)。全部削除して空配列を保存した場合はundefinedには
 * ならないため、初期設定には戻らない。ラベルの追加・削除(saveLabels)で初めてDBに書かれる。
 */
export async function listLabels(): Promise<string[]> {
  const db = await getDb();
  const labels = await db.get(META_STORE, LABELS_KEY);
  return labels ?? [...DEFAULT_LABELS];
}

/** ラベルの一覧を丸ごと置き換える。 */
export async function saveLabels(labels: readonly string[]): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, [...labels], LABELS_KEY);
}
