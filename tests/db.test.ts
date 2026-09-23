import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  closeDbForTest,
  deletePatient,
  deletePatients,
  listLabels,
  listPatients,
  mergePatients,
  replaceAllPatients,
  saveLabels,
  savePatient,
} from '../src/db';
import { DEFAULT_LABELS } from '../src/defaultLabels';
import { createPatient, updatePatientFields } from '../src/patient';
import type { Patient } from '../src/types';

// 接続を閉じてから消す。開いたままだと deleteDB がブロックされ、
// 前のテストのデータが次のテストへ漏れる。
beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input-yakkyoku');
});

describe('患者の保存と取得', () => {
  it('保存した患者を取得できる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    expect(await listPatients()).toEqual([patient]);
  });

  it('登録が新しい患者が先頭に来る', async () => {
    const older = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const newer = createPatient('鈴木', '大阪府', new Date('2026-09-02T00:00:00.000Z'));
    await savePatient(older);
    await savePatient(newer);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木', '山田']);
  });

  it('同じidで保存すると上書きされる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await savePatient(updatePatientFields(patient, '山田 花子', '大阪府'));
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('山田 花子');
  });

  it('削除できる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await deletePatient(patient.id);
    expect(await listPatients()).toEqual([]);
  });

  it('ラベル機能より前に保存された(labelsを持たない)データも、空配列として読み出せる', async () => {
    const legacyPatient: Omit<Patient, 'labels'> & { labels?: string[] } = { ...createPatient('山田', '東京都') };
    delete legacyPatient.labels;
    await savePatient(legacyPatient as Patient);
    expect((await listPatients())[0]?.labels).toEqual([]);
  });

  it('複数件まとめて削除できる', async () => {
    const a = createPatient('山田', '東京都');
    const b = createPatient('鈴木', '大阪府');
    const c = createPatient('田中', '京都府');
    await savePatient(a);
    await savePatient(b);
    await savePatient(c);
    await deletePatients([a.id, c.id]);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木']);
  });
});

describe('インポート', () => {
  it('replaceAllPatientsは既存データを消してから入れ替える', async () => {
    await savePatient(createPatient('既存', '東京都'));
    const imported = [createPatient('取込1', '大阪府'), createPatient('取込2', '京都府')];
    await replaceAllPatients(imported);
    const stored = await listPatients();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.name).sort()).toEqual(['取込1', '取込2']);
  });

  it('mergePatientsは既存データを残したまま追加する', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([createPatient('追加', '大阪府')]);
    expect(await listPatients()).toHaveLength(2);
  });

  it('mergePatientsは同じidを上書きする', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([updatePatientFields(existing, '更新後', '大阪府')]);
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('更新後');
  });
});

describe('ラベルの保存', () => {
  it('初回(まだ一度も保存していない)は、初期設定のラベルが入っている', async () => {
    expect(await listLabels()).toEqual(DEFAULT_LABELS);
  });

  it('初回に読み出した初期設定のラベルは、DBにも保存され、以後も同じものが返る', async () => {
    await listLabels();
    await closeDbForTest();
    expect(await listLabels()).toEqual(DEFAULT_LABELS);
  });

  it('保存した内容がそのまま読み出せる(初期設定を上書きする)', async () => {
    await saveLabels(['エリアA', 'エリアB']);
    expect(await listLabels()).toEqual(['エリアA', 'エリアB']);
  });

  it('保存し直すと、前の内容は残らず置き換わる', async () => {
    await saveLabels(['エリアA', 'エリアB']);
    await saveLabels(['月曜担当']);
    expect(await listLabels()).toEqual(['月曜担当']);
  });

  it('全部削除して空配列を保存した場合は、初期設定に戻らない', async () => {
    await saveLabels([]);
    expect(await listLabels()).toEqual([]);
  });
});
