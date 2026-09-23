import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../src/appInfo';
import { serializeBackup } from '../src/backup';
import { unlock } from '../src/passwordGate';

// window.location.href への実遷移を避ける(jsdomは未実装で警告を出すうえ、
// テスト間でナビゲーションが発生すると副作用が漏れる)。main.tsはopenUrlを
// './openRoute'から読み込んでいるので、そのモジュールごと差し替える。
vi.mock('../src/openRoute', () => ({ openUrl: vi.fn() }));

const SESSION_KEY = 'route-auto-input-yakkyoku:session';

async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2000, interval: 5 });
}

const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const rows = () => document.querySelectorAll('[data-testid="patient-row"]');

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  window.localStorage.clear();
  // ロック画面自体を検証するテスト以外は、ロックを経由せずアプリの中身を直接検証したいので、
  // 既定で解錠しておく。
  unlock();
  await deleteDB('route-auto-input-yakkyoku');
  // vi.resetModules() はモジュールの読み込みキャッシュを消すだけで、
  // vi.mock('../src/openRoute', ...) が作ったモック関数の呼び出し履歴は
  // テストをまたいで残る。呼び出し回数を検証するテストのために、ここでクリアする。
  const { openUrl } = await import('../src/openRoute');
  vi.mocked(openUrl).mockClear();
});

afterEach(async () => {
  // spyOn をテスト間に持ち越さない(持ち越すと、前のテストで記録された呼び出しのせいで、
  // 待つべき処理を待たずに検証が通ってしまう)。
  vi.restoreAllMocks();
  // main.tsが内部で使っている(今のモジュールキャッシュ上の)db接続を閉じる。
  // 閉じないと次のbeforeEachのdeleteDBがブロックされる。
  const db = await import('../src/db');
  await db.closeDbForTest();
});

describe('入力内容の保持(#2)', () => {
  it('保存に失敗しても入力した氏名は画面に残る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    const nameInput = el<HTMLInputElement>('[data-testid="name-input"]')!;
    nameInput.value = '山田 太郎';
    // 住所は空のまま保存 → 検証エラーになる
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('山田 太郎');
    expect(el('.message')?.textContent).toContain('住所を入力してください');
  });

  it('編集中の入力も保存に失敗すれば元の保存値に戻らず入力中の値が残る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('鈴木 一郎', '大阪府大阪市1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    const nameInput = el<HTMLInputElement>('[data-testid="name-input"]')!;
    const addressInput = el<HTMLInputElement>('[data-testid="address-input"]')!;
    expect(nameInput.value).toBe('鈴木 一郎');
    nameInput.value = '鈴木 一郎(編集中)';
    addressInput.value = '';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('鈴木 一郎(編集中)');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('');
  });

  it('新規登録に切り替えると前の失敗時の入力は引き継がない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '途中の入力';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click(); // 住所なしで失敗

    el<HTMLButtonElement>('[data-testid="cancel-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('');
  });
});

describe('二重タップ防止(#7)', () => {
  it('保存ボタンを連打しても患者は1件しか作られない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田 太郎';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区1-1';
    const saveButton = el<HTMLButtonElement>('[data-testid="save-button"]')!;
    saveButton.click();
    saveButton.click();

    await waitFor(() => expect(rows()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toHaveLength(1);
  });

  it('削除の確認で「削除」を連打しても、削除は1回だけで、標準の確認ダイアログは出ない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    const confirmButton = el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!;
    confirmButton.click();
    confirmButton.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('セッションの永続化(#1)', () => {
  it('選択・訪問順・開いたルートがlocalStorageに残り、再起動後に地図の画面から復元される', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patientA = createPatient('患者A', '東京都千代田区1-1');
    const patientB = createPatient('患者B', '大阪府大阪市2-2');
    await savePatient(patientA);
    await savePatient(patientB);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));

    el<HTMLInputElement>(`input[data-id="${patientA.id}"]`)!.click();
    el<HTMLInputElement>(`input[data-id="${patientB.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const raw = window.localStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    expect(record.selectedIds).toEqual([patientA.id, patientB.id]);
    expect(record.opened).toEqual([{ index: 0, at: expect.any(String) }]);
    // 氏名・住所は書き込まれない
    expect(raw).not.toContain('患者A');
    expect(raw).not.toContain('東京都');

    // iOSがPWAをメモリから追い出して再起動した状況を模す:
    // localStorageとIndexedDBのデータはそのまま、JS側だけを作り直す。
    // 先にこのテストで開いたDB接続を閉じておかないと、次のbeforeEachの
    // deleteDBが(閉じられていない接続のせいで)ブロックされてしまう。
    const dbBeforeRestart = await import('../src/db');
    await dbBeforeRestart.closeDbForTest();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');

    // 開いたルートがあるので、次に開くルートがすぐ分かるよう、地図の画面から始まる
    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('12時間より古いセッションは復元せず一覧画面から始まる', async () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: ['stale-id'],
        openedRouteIndexes: [],
        timestamp: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
      }),
    );

    await import('../src/main');

    expect(el('h1')?.textContent).toBe(APP_NAME);
    expect(el('[data-testid="stop-row"]')).toBeNull();
    // 「次へ」は選択バーへ移り、未選択のときは出ないため、一覧画面が出ていることを
    // 「＋ 訪問先を登録」ボタンで確かめる。
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  });

  it('12時間以内のセッションは復元される', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('患者A', '東京都千代田区1-1');
    await savePatient(patient);
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: [patient.id],
        openedRouteIndexes: [],
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1));
  });

  it('選択を全て外すとセッション記録が消える', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('患者A', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    // クリックのたびに画面全体が再描画されて要素が作り直されるため、
    // 都度クエリし直す(古い要素参照のままクリックしない)。
    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('存在しなくなった患者idは復元時に選択から外れる(自己修復)', async () => {
    // DBには何もない状態で、患者idだけが記録されているケース。
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: ['deleted-id'],
        openedRouteIndexes: [],
        timestamp: new Date().toISOString(),
      }),
    );

    await import('../src/main');
    // 復元直後は(まだDBを読み込む前なので)訪問順の画面から始まる。
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    // DBを読み込むと、存在しない患者idはwithPatientsによって選択から外れる。
    // 選択が0件になるとセッション記録も消える。画面はorderのままだが
    // 「一覧へ戻る」から戻れる。
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(0);
      expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });
});

describe('開いたルートの印(#6)', () => {
  /** 訪問先を count 件登録し、すべて選んで、地図の画面からルートを1つ開いた状態にする。 */
  async function openFirstRoute(count: number): Promise<{ ids: string[] }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patients = Array.from({ length: count }, (_, i) =>
      createPatient(`場所${i + 1}`, `東京都千代田区${i + 1}-1`),
    );
    for (const patient of patients) {
      await savePatient(patient);
    }

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    for (const patient of patients) {
      el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    }
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
    return { ids: patients.map((patient) => patient.id) };
  }

  it('訪問順へ戻って、もう一度地図を開いても、開いたルートの印は残る', async () => {
    await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('訪問先の選択を変えると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選択を外す
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選び直す
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
    expect(el('[data-testid="route-card"]')?.getAttribute('data-state')).toBe('next');
  });

  it('訪問順を並べ替えると、開いたルートの印が消える', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="move-down"]')!.click(); // 1件目を下へ
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });

  it('先頭の▲は押せず、何も変わらないので、開いたルートの印は残る', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    // 先頭の▲は押せない(disabled)ので、押しても何も起きない。
    el<HTMLButtonElement>('[data-testid="move-up"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('選択中の別の訪問先を削除すると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${ids[1]}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(1));
    confirmSpy.mockRestore();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });

  it('選択中の訪問先の住所を編集すると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${ids[0]}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区9-9';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('保存しました'));

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });
});

describe('インポートの確認(cancel/confirm)', () => {
  async function seedOnePatientAndOpenSettings(): Promise<{ id: string }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('既存患者', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());
    return { id: patient.id };
  }

  function attachBackupFile(): void {
    const text = serializeBackup([]); // 空データへの全置換
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
  }

  it('確認でキャンセルすると取り込まれない', async () => {
    await seedOnePatientAndOpenSettings();
    attachBackupFile();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(1);
  });

  it('確認で許可すると取り込まれる(全置換で0件になる)', async () => {
    await seedOnePatientAndOpenSettings();
    attachBackupFile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(0);
  });
});

describe('CSVからの取り込み', () => {
  async function openSettings(): Promise<void> {
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(0));
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-csv-input"]')).not.toBeNull());
  }

  function attachCsvFile(text: string, name = 'list.csv'): void {
    const file = new File([text], name, { type: 'text/csv' });
    const input = el<HTMLInputElement>('[data-testid="import-csv-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
  }

  it('確認でキャンセルすると取り込まれない', async () => {
    await openSettings();
    attachCsvFile('名前,住所\n山田太郎,東京都千代田区1-1\n');
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(0);
  });

  it('確認で許可すると、読み取った名前・住所が追加される', async () => {
    await openSettings();
    attachCsvFile('名前,住所\n山田太郎,東京都千代田区1-1\n');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain('山田太郎');
  });

  it('名前の列が無いCSVでは、個人情報を含まないエラーを表示する', async () => {
    await openSettings();
    attachCsvFile('氏名以外,住所\na,b\n');

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('名前の列が見つかりませんでした。'));

    expect(el('.message')?.textContent).not.toContain('a,b');
  });

  it('ラベルが1つも無ければ、ラベルの付け方の欄は出ない', async () => {
    await openSettings();
    expect(el('[data-testid="csv-label-mode"]')).toBeNull();
  });

  it('「全部に同じラベルを付ける」を選んで取り込むと、新規分にそのラベルが付く', async () => {
    const { saveLabels } = await import('../src/db');
    await saveLabels(['エリアA']);
    await openSettings();
    // 起動直後の読み込みは非同期のため、ラベルの欄が実際に現れるまで待つ
    // (「訪問先0件」はラベル読み込み前から真なので、それだけでは待ったことにならない)。
    await waitFor(() => expect(el('[data-testid="csv-label-mode"]')).not.toBeNull());
    el<HTMLInputElement>('[data-testid="csv-label-mode-bulk"]')!.checked = true;
    el<HTMLInputElement>('[data-testid="csv-label-mode-bulk"]')!.dispatchEvent(new Event('change'));
    el<HTMLInputElement>('[data-testid="csv-label-checkbox"]')!.checked = true;
    attachCsvFile('名前,住所\n山田太郎,東京都千代田区1-1\n');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('.label-badge')?.textContent).toBe('エリアA');
  });

  it('「個別」のままだと、取り込んだ分にラベルは付かない', async () => {
    const { saveLabels } = await import('../src/db');
    await saveLabels(['エリアA']);
    await openSettings();
    attachCsvFile('名前,住所\n山田太郎,東京都千代田区1-1\n');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('.label-badge')).toBeNull();
  });

  it('重複した既存データにラベルが無ければ、一括ラベルで後付けされる', async () => {
    const { saveLabels, savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await saveLabels(['エリアA']);
    await savePatient(createPatient('山田太郎', '東京都千代田区1-1'));
    await openSettings();
    await waitFor(() => expect(el('[data-testid="csv-label-mode"]')).not.toBeNull());
    el<HTMLInputElement>('[data-testid="csv-label-mode-bulk"]')!.checked = true;
    el<HTMLInputElement>('[data-testid="csv-label-mode-bulk"]')!.dispatchEvent(new Event('change'));
    el<HTMLInputElement>('[data-testid="csv-label-checkbox"]')!.checked = true;
    attachCsvFile('名前,住所\n山田太郎,東京都千代田区1-1\n');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-csv-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(1);
    expect(el('.label-badge')?.textContent).toBe('エリアA');
  });
});

describe('ラベルの管理と絞り込み', () => {
  async function openSettings(): Promise<void> {
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(0));
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="label-name-input"]')).not.toBeNull());
  }

  it('ラベルを追加すると、一覧の並びに反映され、あとで見返せる', async () => {
    await openSettings();
    el<HTMLInputElement>('[data-testid="label-name-input"]')!.value = 'エリアA';
    el<HTMLButtonElement>('[data-testid="label-add-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('追加しました'));

    expect(el('[data-testid="label-name-input"]')).not.toBeNull(); // 設定画面のまま
    expect(document.body.textContent).toContain('エリアA');
  });

  it('ラベルを削除すると、付いていた訪問先からも外れる', async () => {
    const { saveLabels, savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await saveLabels(['エリアA']);
    await savePatient(createPatient('山田太郎', '東京都千代田区1-1', new Date(), ['エリアA']));
    await openSettings();
    // 起動直後の読み込みは非同期のため、削除ボタン(ラベルが読み込まれてから出る)を待つ。
    await waitFor(() => expect(el('[data-testid="label-delete-button"]')).not.toBeNull());
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="label-delete-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('削除しました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('.label-badge')).toBeNull();
  });

  it('一覧でラベルを絞り込むと、そのラベルの訪問先だけになる', async () => {
    const { saveLabels, savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await saveLabels(['エリアA', 'エリアB']);
    await savePatient(createPatient('山田太郎', '東京都千代田区1-1', new Date(), ['エリアA']));
    await savePatient(createPatient('鈴木花子', '大阪府大阪市2-2', new Date(), ['エリアB']));
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));

    el<HTMLButtonElement>('[data-testid="label-filter-button"]')!.click();
    const chips = document.querySelectorAll<HTMLButtonElement>('[data-testid="label-filter-chip"]');
    chips[0]!.click(); // エリアA

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]?.textContent).toContain('山田太郎');
  });
});

describe('起動直後の読み込み', () => {
  it('読み込みが終わっても、操作の結果として表示中のメッセージを消さない', async () => {
    await import('../src/main');
    // 起動直後のDB読み込みは、まだ終わっていない。この間に、すぐエラーが出る操作をする。
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    expect(el('.message')?.textContent).toContain('名前を入力してください');

    // 読み込みが終わるのを待つ(fake-indexeddb は数ミリ秒で終わる)。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(el('.message')?.textContent).toContain('名前を入力してください');
  });
});

describe('合言葉のロック画面', () => {
  // このdescribe内では、beforeEachのunlock()を打ち消して、未解錠から始める。
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('未解錠なら、ロック画面が出て、中身(一覧)は表示されない', async () => {
    await import('../src/main');
    expect(el('[data-testid="password-input"]')).not.toBeNull();
    expect(el('[data-testid="new-button"]')).toBeNull();
  });

  it('間違った合言葉では、エラーが出て、中身は表示されない', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'ちがう';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();

    expect(el('.message')?.textContent).toBe('合言葉が違います。');
    expect(el('[data-testid="new-button"]')).toBeNull();
  });

  it('正しい合言葉を入れると、中身(一覧)が表示される', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'houmon-ph2026';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();

    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(el('[data-testid="password-input"]')).toBeNull();
  });

  it('一度解錠すると、次に読み込んだとき(同じブラウザ)はロック画面を経由しない', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'houmon-ph2026';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    // 再起動を模して、モジュールを読み込み直す(localStorageはそのまま)。
    // 読み込み直す前に、今の接続を閉じておく(閉じないと次のdeleteDBがブロックされる)。
    const dbBeforeRestart = await import('../src/db');
    await dbBeforeRestart.closeDbForTest();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');

    expect(el('[data-testid="password-input"]')).toBeNull();
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  });
});

describe('地図の画面からルートを共有', () => {
  async function openMapWithOnePatient(): Promise<void> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田太郎', '東京都千代田区1-1');
    await savePatient(patient);
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        selectedIds: [patient.id],
        opened: [{ index: 0, at: '' }],
      }),
    );
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="share-routes"]')).not.toBeNull());
    // 起動直後の読み込みで訪問先が反映されるまで待つ(ルートのカードに名前が出る)。
    await waitFor(() => expect(document.body.textContent).toContain('山田太郎'));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('確認でキャンセルすると、共有しない', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('確認で許可すると、住所入りのGoogleマップのURLを共有する(名前は含めない)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const text = share.mock.calls[0]![0].text as string;
    expect(text).toContain('https://www.google.com/maps/dir/');
    expect(text).not.toContain('山田太郎');
  });

  it('「リンクをコピー」は、共有メニューがあっても使わずにコピーして案内する', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="copy-route-link"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toContain('コピーしました'));
    expect(String(writeText.mock.calls[0]![0])).toContain('https://www.google.com/maps/dir/');
    expect(share).not.toHaveBeenCalled();
  });

  it('「リンクをコピー」も、確認でキャンセルするとコピーしない', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="copy-route-link"]')!.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('共有メニューが無い端末では、コピーして案内する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share: undefined, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toContain('コピーしました'));
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('地図を開く画面', () => {
  async function seedOnePatient(): Promise<{ id: string }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('場所A', '東京都千代田区1-1');
    await savePatient(patient);
    return { id: patient.id };
  }

  function writeSession(record: object): void {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ timestamp: new Date().toISOString(), ...record }),
    );
  }

  it('開いたルートが記録されていれば、地図の画面から始まり、開いた日時を表示する', async () => {
    const { id } = await seedOnePatient();
    writeSession({
      selectedIds: [id],
      opened: [{ index: 0, at: new Date(2026, 8, 21, 14, 32).toISOString() }],
    });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('9/21 14:32');
  });

  it('古い形式(番号だけ)の記録でも、開いたルートがあれば地図の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], openedRouteIndexes: [0] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(el('[data-testid="route-status"]')).not.toBeNull());
    expect(el('.route-time')).toBeNull();
  });

  it('開いたルートが無ければ、これまでどおり訪問順の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1));
  });

  it('「もう一度開く」で、地図を開く遷移が呼ばれる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: new Date().toISOString() }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    const { openUrl } = await import('../src/openRoute');

    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(openUrl).mock.calls[0]?.[0])).toContain('google.com/maps');
  });

  it('戻るを押すと、訪問順の画面へ戻る', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="back-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('選択がなくなっていても地図の画面が開け、「訪問先を選ぶ」から一覧へ進める', async () => {
    writeSession({ selectedIds: ['gone-id'], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="choose-stops-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();

    // 一覧の画面へ移った(この時点の一覧は、まだ作り直していない古い画面)。
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(el('h1')?.textContent).not.toBe('地図を開く');
  });
});

describe('訪問先を選ぶ画面と下部のバー', () => {
  async function seedPlaces(count: number): Promise<string[]> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const ids: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      // 作成日時をミリ秒未満の粒度でも必ず増える値にする。createdAt が同じミリ秒になると、
      // listPatients() の並び順(createdAt降順、同値はUUID順にフォールバック)が不定になり、
      // 表示順を検証するテストが fake-indexeddb 上でまれに揺れるため。
      const patient = createPatient(`場所${i}`, `東京都千代田区${i}-1`, new Date(2026, 0, 1, 0, 0, i));
      await savePatient(patient);
      ids.push(patient.id);
    }
    return ids;
  }

  async function startWithPlaces(count: number): Promise<string[]> {
    const ids = await seedPlaces(count);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    return ids;
  }

  const checkbox = (id: string) => el<HTMLInputElement>(`input[data-id="${id}"]`)!;
  const openMenuFor = (id: string) =>
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${id}"]`)!.click();

  it('見出しにアプリ名を出す', async () => {
    // 起動直後のDB読み込みが終わるまで待つ(待たずに終えると、その読み込みが次のテストへ漏れる)。
    await startWithPlaces(1);
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('行全体をタップして選択でき、選択バーに件数が出て、もう一度タップすると外れる', async () => {
    const ids = await startWithPlaces(2);
    // 一覧は新しく登録した訪問先が先頭に来る(tests/db.test.ts)ため、
    // 一番上の行は最後に登録した訪問先になる。
    const displayedFirst = ids[ids.length - 1];
    expect(el('[data-testid="selection-bar"]')).toBeNull();

    el<HTMLElement>('.place-name')!.click(); // 行の名前の部分をタップ

    expect(checkbox(displayedFirst!).checked).toBe(true);
    expect(rows()[0]!.classList.contains('selected')).toBe(true);
    expect(el('[data-testid="selection-count"]')?.textContent).toBe('1件選択中');

    el<HTMLElement>('.place-name')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
  });

  it('選択バーの「訪問順を決める →」で、訪問順の画面へ進む', async () => {
    const [first] = await startWithPlaces(2);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('「⋯」を押すとメニューが開き、最初のボタンにフォーカスが移り、選択は変わらない', async () => {
    const [first] = await startWithPlaces(1);

    openMenuFor(first!);

    expect(el('[data-testid="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="dialog-edit"]'));
    expect(checkbox(first!).checked).toBe(false);
    expect(document.body.classList.contains('dialog-open')).toBe(true);
  });

  it('メニューを「キャンセル」で閉じると、フォーカスが元の「⋯」へ戻り、背後のスクロール止めも外れる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
    expect(document.body.classList.contains('dialog-open')).toBe(false);
  });

  it('Escキーでメニューが閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el('[data-testid="dialog-edit"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('ダイアログの背景側(フォーカスを持てない部分)を押してフォーカスが外れても、Escキーで閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    // フォーカスを持てない見出しなどをクリックすると、activeElement は document.body へ移る
    // (#app の外)。ここでは、その状況を blur() で再現し、Escキーを押しても閉じられることを
    // 確かめる。
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの外側(背景)を押すと閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLElement>('[data-testid="dialog-overlay"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「編集」で、その訪問先の編集フォームが開き、名前と住所が入っている', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「複製して登録」で、名前と住所を写した新規フォームが開き、保存すると別の訪問先として増える', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-duplicate"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');

    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(2));
    // 元の訪問先はそのまま残っている。
    expect(checkbox(first!)).not.toBeNull();
  });

  it('メニューの「削除」を押しても、すぐには削除せず、確認のダイアログが出る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    expect(el('#dialog-title')?.textContent).toBe('この訪問先を削除しますか?');
    expect(rows()).toHaveLength(1);
  });

  it('削除の確認で「キャンセル」すると、削除されず、フォーカスは「⋯」へ戻る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
  });

  it('削除の確認で「削除」を押すと、その訪問先が消えて、お知らせが出る', async () => {
    const [first, second] = await startWithPlaces(2);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(checkbox(second!)).not.toBeNull();
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('検索で絞り込め、0件のときは案内が出て、クリアボタンで元に戻り、検索欄にフォーカスが戻る', async () => {
    await startWithPlaces(3);
    const search = () => el<HTMLInputElement>('[data-testid="search-input"]')!;

    search().value = '場所2';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(1);

    search().value = 'どこにもない';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(0);
    expect(el('[data-testid="empty-text"]')?.textContent).toBe('該当する訪問先がありません');

    el<HTMLButtonElement>('[data-testid="search-clear"]')!.click();

    expect(rows()).toHaveLength(3);
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
  });

  it('下部のタブは3つのステップを示し、訪問先を選ぶまでは、訪問順と地図のタブを押せない', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('[data-testid="tab-list"]')?.getAttribute('aria-current')).toBe('step');
    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(true);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(true);

    checkbox(first!).click();

    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(false);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(false);
  });

  it('タブで、訪問順・地図・訪問先を選ぶ、の間を移動できる', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    expect(el('[data-testid="tab-order"]')?.getAttribute('aria-current')).toBe('step');

    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    expect(el('h1')?.textContent).toBe('地図を開く');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('タブで移動しても、開いたルートの印は消えない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('設定・登録の画面には、下部のタブを出さない', async () => {
    await startWithPlaces(1);
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();
  });

  it('選択バーは、訪問先を選んだ一覧の画面にだけ出て、訪問順の画面には出ない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    expect(el('[data-testid="selection-bar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();
  });

  it('選択バーとタブがあるとき、内容の下に十分な余白を取るクラスが付く', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('.app-shell')?.classList.contains('with-tabbar')).toBe(true);

    checkbox(first!).click();

    expect(el('.app-shell')?.classList.contains('with-selection')).toBe(true);
  });

  describe('並び替え', () => {
    it('名前順にすると、あいうえお順の見出しに並び替わる', async () => {
      const { savePatient } = await import('../src/db');
      const { createPatient } = await import('../src/patient');
      await savePatient(createPatient('うえだ', 'x'));
      await savePatient(createPatient('あべ', 'y'));
      await import('../src/main');
      await waitFor(() => expect(rows()).toHaveLength(2));

      const select = el<HTMLSelectElement>('[data-testid="sort-select"]')!;
      select.value = 'name';
      select.dispatchEvent(new Event('change'));

      await waitFor(() =>
        expect([...document.querySelectorAll('.place-name')].map((e) => e.textContent)).toEqual([
          'あべ',
          'うえだ',
        ]),
      );
    });
  });

  describe('全選択・全解除', () => {
    it('「全選択」を押すと、表示中の全件が選択される', async () => {
      await startWithPlaces(3);

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-count"]')?.textContent).toBe('3件選択中');
    });

    it('全選択した後、もう一度押す(全解除)と選択が外れる', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-bar"]')).toBeNull();
    });

    it('検索で絞り込んだ状態で全選択すると、絞り込んだ分だけ選ばれる', async () => {
      await startWithPlaces(3);
      const search = el<HTMLInputElement>('[data-testid="search-input"]')!;
      search.value = '場所2';
      search.dispatchEvent(new Event('input'));
      await waitFor(() => expect(rows()).toHaveLength(1));

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-count"]')?.textContent).toBe('1件選択中');
    });
  });

  describe('選択した複数件の一括削除', () => {
    it('選択バーの「削除」を押しても、すぐには削除せず、件数つきの確認ダイアログが出る', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      expect(el('#dialog-title')?.textContent).toBe('選択した2件を削除しますか?');
      expect(rows()).toHaveLength(2);
    });

    it('確認で「キャンセル」すると、削除されない', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

      expect(el('[data-testid="dialog"]')).toBeNull();
      expect(rows()).toHaveLength(2);
    });

    it('確認で「削除」すると、選択した分がまとめて削除され、選択も外れる', async () => {
      await startWithPlaces(3);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!.click();

      await waitFor(() => expect(el('.message')?.textContent).toContain('3件を削除しました'));
      expect(rows()).toHaveLength(0);
      expect(el('[data-testid="selection-bar"]')).toBeNull();
    });

    it('一部だけ選んで削除すると、選んだ分だけ消え、残りは残る', async () => {
      const ids = await startWithPlaces(3);
      checkbox(ids[0]!).click();

      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!.click();

      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(checkbox(ids[0]!)).toBeNull();
    });

    it('削除ボタンを連打しても、まとめて削除されるのは1回だけ', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      const confirmButton = el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!;
      confirmButton.click();
      confirmButton.click();

      await waitFor(() => expect(rows()).toHaveLength(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rows()).toHaveLength(0);
    });
  });
});
