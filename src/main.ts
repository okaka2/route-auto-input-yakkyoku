import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import { decodeCsvBytes, planCsvImport } from './csvImport';
import {
  deletePatient,
  deletePatients,
  listLabels,
  listPatients,
  mergePatients,
  replaceAllPatients,
  saveLabels,
  savePatient,
} from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
import { openUrl } from './openRoute';
import { checkPassword, isUnlocked, renderPasswordGate, unlock } from './passwordGate';
import { createPatient, updatePatientFields } from './patient';
import { splitIntoRoutes } from './routeSplitter';
import { clearSession, loadSession, saveSession } from './session';
import { registerServiceWorkerUpdates } from './swUpdate';
import {
  clearSelection,
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  selectAllVisible,
  selectedPatients,
  setSearchQuery,
  setSortOrder,
  toggleLabelFilter,
  toggleSelection,
  visiblePatients,
  withLabels,
  withMessage,
  withPatients,
  withScreen,
} from './state';
import type { AppState, Message, Patient, SortOrder } from './types';
import { validatePatientInput, validateSelection } from './validation';
import { renderDialog } from './views/dialogs';
import { renderPatientForm, type PatientFormDraft } from './views/patientFormView';
import { renderPatientList } from './views/patientListView';
import { renderRouteOrder } from './views/routeOrderView';
import { renderRouteMap } from './views/routeMapView';
import { renderSelectionBar } from './views/selectionBar';
import { renderSettings } from './views/settingsView';
import { renderTabBar, type Step } from './views/tabBar';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません。');
}

// ロックの状態に関係なく、新しいバージョンが出ていれば自動で反映する。
registerServiceWorkerUpdates();

// Escキーでダイアログを閉じる。document に付けるのは、ダイアログの背景など
// フォーカスを持てない場所をクリックすると activeElement が document.body へ移り
// (#app の外)、root へ付けたリスナーにはEscキーが届かなくなるため(#app はイベントの
// targetの子孫ではなく祖先になり、バブリングでは到達しない)。
// テストで main.ts を読み込み直すたびに document へリスナーが積み重ならないよう、
// window に前回のハンドラーを覚えておき、新しく付ける前に外す。
type WindowWithEscapeHandler = typeof window & {
  __routeAutoInputEscapeHandler?: (event: KeyboardEvent) => void;
};
const globalWindow = window as WindowWithEscapeHandler;
if (globalWindow.__routeAutoInputEscapeHandler) {
  document.removeEventListener('keydown', globalWindow.__routeAutoInputEscapeHandler);
}
function handleEscapeKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state.dialog !== null) {
    event.preventDefault();
    closeAnyDialog();
  }
}
globalWindow.__routeAutoInputEscapeHandler = handleEscapeKeydown;
document.addEventListener('keydown', handleEscapeKeydown);

// Googleマップへ遷移して戻ってきたときのために、選択・訪問順・開いたルートを
// localStorageから復元する(Ruling 7)。復元できた場合、開いたルートがあれば地図の画面、
// なければ訪問順の画面から始める。
const restoredSession = loadSession();
let state: AppState = restoredSession
  ? {
      ...createInitialState([]),
      selectedIds: restoredSession.selectedIds,
      // 開いたルートがあれば、地図アプリから戻ってきた状況。次に開くルートがすぐ分かるよう、
      // 地図の画面から始める。なければ、これまでどおり訪問順の画面から始める。
      screen: { name: restoredSession.opened.length > 0 ? 'map' : 'order' },
    }
  : createInitialState([]);
// 開いたルートの番号と、開いた日時(ISO 8601。日時が分からない古い記録から復元したものは '')。
const openedRoutes = new Map<number, string>(
  (restoredSession?.opened ?? []).map((route) => [route.index, route.at] as const),
);

// 保存に失敗した直後の入力値。入力内容を画面に残すため(spec §8)、
// openedRoutesと同様にAppStateの外で保持する。
let formDraft: PatientFormDraft | null = null;

// 保存/削除の二重実行防止(ボタンを連打してもDBへ二重に書き込まない)。
let savingPatient = false;
const deletingPatientIds = new Set<string>();
let deletingSelected = false;

// 「⋯」から開いたダイアログを、編集・複製・削除以外で閉じたとき、フォーカスを戻す行のid。
let dialogReturnId: string | null = null;

function setState(next: AppState): void {
  state = next;
  render();
}

function syncSession(): void {
  if (state.selectedIds.length === 0) {
    clearSession();
    return;
  }
  saveSession({
    selectedIds: state.selectedIds,
    opened: [...openedRoutes].map(([index, at]) => ({ index, at })),
    timestamp: new Date().toISOString(),
  });
}

/**
 * DBから患者を読み直す。message を渡したときだけ、表示中のメッセージを差し替える。
 * 省略したとき(起動直後の読み込みなど)は今のメッセージを保つ。保たないと、読み込みが
 * 終わった瞬間に、操作の結果として出たばかりのエラーや案内を消してしまう。
 */
async function reloadPatients(message?: Message): Promise<void> {
  try {
    const [patients, labels] = await Promise.all([listPatients(), listLabels()]);
    const next = withLabels(withPatients(state, patients), labels);
    // withPatients は selectedIds を filter するだけで、要素を足したり並べ替えたりはしない。
    // よって長さが減っていれば、選択していた訪問先のどれかが読み直しで消えたということ。
    // そのルートの内容はもう変わっているので、開いた印は古くなる前に消す。
    if (next.selectedIds.length !== state.selectedIds.length) {
      openedRoutes.clear();
    }
    setState({
      ...next,
      ...(message === undefined ? {} : { message }),
    });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}

function currentEditingPatient(): Patient | null {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return null;
  }
  const id = screen.patientId;
  return state.patients.find((patient) => patient.id === id) ?? null;
}

async function handleSave(name: string, address: string, labels: string[]): Promise<void> {
  if (savingPatient) {
    // 保存中の二重タップ。何もしない(2件目のUUIDが発行されるのを防ぐ)。
    return;
  }
  const validation = validatePatientInput(name, address);
  if (!validation.ok) {
    formDraft = { name, address, labels };
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  savingPatient = true;
  try {
    const existing = currentEditingPatient();
    const patient =
      existing === null
        ? createPatient(name, address, new Date(), labels)
        : updatePatientFields(existing, name, address, new Date(), labels);
    if (existing !== null && state.selectedIds.includes(existing.id)) {
      // 選択中(=ルートに入っている)訪問先の編集。住所が変わったかもしれないので、
      // そのルートについて開いた印は古くなる前に消す。
      openedRoutes.clear();
    }
    await savePatient(patient);
    formDraft = null;
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    formDraft = { name, address, labels };
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  } finally {
    savingPatient = false;
  }
}

async function handleDelete(id: string): Promise<void> {
  if (deletingPatientIds.has(id)) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  if (!state.patients.some((patient) => patient.id === id)) {
    closeAnyDialog();
    return;
  }
  deletingPatientIds.add(id);
  // 確認は、ここへ来る前に、確認のダイアログで「削除」を押した時点で済んでいる。
  dialogReturnId = null;
  setState(closeDialog(state));
  try {
    await deletePatient(id);
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingPatientIds.delete(id);
  }
}

function handleSortChange(order: SortOrder): void {
  setState(setSortOrder(state, order));
}

/** 一覧の「全選択」/「全解除」。今どちらの表示かは選択の内容から決まるので、ここでも同じ判定をする。 */
function handleToggleSelectAll(): void {
  const visible = visiblePatients(state);
  const allSelected = visible.length > 0 && visible.every((patient) => state.selectedIds.includes(patient.id));
  setState(allSelected ? clearSelection(state) : selectAllVisible(state));
}

function handleToggleLabelFilter(label: string): void {
  setState(toggleLabelFilter(state, label));
}

async function handleAddLabel(name: string): Promise<void> {
  if (state.labels.includes(name)) {
    setState(withMessage(state, { kind: 'error', text: 'そのラベルはすでにあります。' }));
    return;
  }
  try {
    await saveLabels([...state.labels, name]);
    await reloadPatients({ kind: 'info', text: `「${name}」を追加しました。` });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'ラベルを追加できませんでした。' }));
  }
}

async function handleDeleteLabel(name: string): Promise<void> {
  if (!window.confirm(`「${name}」を削除しますか? このラベルが付いている訪問先からも外れます。`)) {
    return;
  }
  try {
    await saveLabels(state.labels.filter((label) => label !== name));
    const affected = state.patients.filter((patient) => patient.labels.includes(name));
    for (const patient of affected) {
      await savePatient({ ...patient, labels: patient.labels.filter((label) => label !== name) });
    }
    await reloadPatients({ kind: 'info', text: `「${name}」を削除しました。` });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'ラベルを削除できませんでした。' }));
  }
}

/** 選択バーの「削除」。まだ削除しない(確認のダイアログへ進む)。 */
function handleRequestDeleteSelected(): void {
  setState(openDeleteSelectedConfirm(state));
}

async function handleConfirmDeleteSelected(): Promise<void> {
  if (deletingSelected) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  const ids = state.selectedIds;
  if (ids.length === 0) {
    closeAnyDialog();
    return;
  }
  deletingSelected = true;
  setState(closeDialog(state));
  try {
    await deletePatients(ids);
    await reloadPatients({ kind: 'info', text: `${ids.length}件を削除しました。` });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingSelected = false;
  }
}

/** 「⋯」メニューを開く。閉じたとき、この行の「⋯」へフォーカスを戻すため、idを覚えておく。 */
function openMenu(id: string): void {
  dialogReturnId = id;
  setState(openRowMenu(state, id));
}

function closeAnyDialog(): void {
  setState(closeDialog(state));
}

function handleEdit(id: string): void {
  dialogReturnId = null;
  formDraft = null;
  setState(withScreen(state, { name: 'form', patientId: id }));
}

/** 名前と住所を写した状態の、新規登録フォームを開く(保存すると別の訪問先になる)。 */
function handleDuplicate(id: string): void {
  const source = state.patients.find((patient) => patient.id === id);
  if (!source) {
    closeAnyDialog();
    return;
  }
  dialogReturnId = null;
  formDraft = { name: source.name, address: source.address, labels: source.labels };
  setState(withScreen(state, { name: 'form', patientId: null }));
}

/** 選択バーの「訪問順を決める →」。 */
function handleNext(): void {
  const validation = validateSelection(state.selectedIds.length);
  if (!validation.ok) {
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  setState(withScreen(state, { name: 'order' }));
}

/** 下部のタブに出す3つのステップのうち、今の画面がどれか。設定・登録の画面は null(タブを出さない)。 */
function currentStep(): Step | null {
  switch (state.screen.name) {
    case 'list':
    case 'order':
    case 'map':
      return state.screen.name;
    default:
      return null;
  }
}

function handleSelectStep(step: Step): void {
  if (step === currentStep()) {
    return;
  }
  // 訪問先を選ぶまでは、訪問順と地図へは進めない。
  if (step !== 'list' && !hasSelection(state)) {
    return;
  }
  setState(withScreen(state, { name: step }));
}

function handleOpenRoute(routeIndex: number): void {
  const routes = splitIntoRoutes(selectedPatients(state), MAX_STOPS_PER_ROUTE);
  const route = routes[routeIndex];
  if (!route) {
    return;
  }
  try {
    const url = DEFAULT_MAP_PROVIDER.buildUrl(route.map((patient) => patient.address));
    openedRoutes.set(routeIndex, new Date().toISOString());
    render();
    openUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : '地図を開けませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

function handleExport(): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`route-auto-input-yakkyoku-${date}.json`, serializeBackup(state.patients, new Date(), state.labels));
    setState(withMessage(state, { kind: 'info', text: 'バックアップを書き出しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'バックアップを書き出せませんでした。' }));
  }
}

async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
  try {
    const { patients, labelDefinitions } = parseBackup(await readTextFile(file));
    const question =
      mode === 'replace'
        ? `今のデータ${state.patients.length}件を消して、${patients.length}件を取り込みます。よろしいですか?`
        : `${patients.length}件を今のデータに追加します。よろしいですか?`;
    if (!window.confirm(question)) {
      return;
    }
    if (mode === 'replace') {
      await replaceAllPatients(patients);
      await saveLabels(labelDefinitions);
    } else {
      await mergePatients(patients);
      // 追加(merge)モードでは、ラベルの定義は消さず、無いものだけ足す。
      await saveLabels([...new Set([...state.labels, ...labelDefinitions])]);
    }
    await reloadPatients({ kind: 'info', text: `${patients.length}件を取り込みました。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

/**
 * 外部のCSVファイルから、名前・住所(建物名を含む)だけを読み取って追加する。
 * 既存データは消さず、常に追加のみ。名前・住所が完全一致する行は自動でスキップする
 * (件数のみで、内容は確認ダイアログにもメッセージにも出さない)。
 *
 * labelsToApply(設定画面で「全部に同じラベルを付ける」を選んだ場合の選択結果。
 * 「個別」なら空配列)が渡されれば、新しく取り込む分すべてに付けるだけでなく、
 * 重複してスキップした行のうち、その既存の訪問先にまだラベルが無いものにも
 * 後付けする(既にラベルがある既存データは変えない)。
 */
async function handleImportCsv(file: File, labelsToApply: string[]): Promise<void> {
  try {
    const text = decodeCsvBytes(await file.arrayBuffer());
    const plan = planCsvImport(text, state.patients);
    const question =
      `${plan.toImport.length}件を今のデータに追加します。` +
      (plan.skippedDuplicate > 0 ? `(${plan.skippedDuplicate}件は既に登録済みのためスキップします)` : '');
    if (!window.confirm(question)) {
      return;
    }
    const newPatients = plan.toImport.map((row) => createPatient(row.name, row.address, new Date(), labelsToApply));
    const patientsById = new Map(state.patients.map((patient) => [patient.id, patient]));
    const backfilled =
      labelsToApply.length === 0
        ? []
        : plan.duplicateIdsWithoutLabel
            .map((id) => patientsById.get(id))
            .filter((patient): patient is Patient => patient !== undefined)
            .map((patient) => ({ ...patient, labels: labelsToApply }));
    await mergePatients([...newPatients, ...backfilled]);
    await reloadPatients({ kind: 'info', text: `${newPatients.length}件を取り込みました。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

function renderScreen(): HTMLElement {
  switch (state.screen.name) {
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onClearSearch: () => {
          setState(setSearchQuery(state, ''));
          // クリアボタンは消えるので、検索欄へフォーカスを戻す。
          root!.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
        },
        onToggleSelect: (id) => {
          const next = toggleSelection(state, id);
          // 選択が実際に変わったときだけ、開いたルートの印を消す(上限で選べなかったときは変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onSortChange: handleSortChange,
        onToggleSelectAll: handleToggleSelectAll,
        onToggleLabelFilter: handleToggleLabelFilter,
        onNew: () => {
          formDraft = null;
          setState(withScreen(state, { name: 'form', patientId: null }));
        },
        onOpenMenu: openMenu,
        onOpenSettings: () => setState(withScreen(state, { name: 'settings' })),
      });
    case 'form':
      return renderPatientForm(currentEditingPatient(), formDraft, state.message, state.labels, {
        onSave: (name, address, labels) => {
          void handleSave(name, address, labels);
        },
        onCancel: () => {
          formDraft = null;
          setState(withScreen(state, { name: 'list' }));
        },
      });
    case 'order':
      return renderRouteOrder(state, {
        onMove: (id, direction) => {
          const next = moveSelected(state, id, direction);
          // 順番が実際に変わったときだけ、開いたルートの印を消す(端の▲▼は何も変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onAddStops: () => setState(withScreen(state, { name: 'list' })),
        onOpenMap: () => setState(withScreen(state, { name: 'map' })),
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'map':
      return renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, {
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'order' })),
        onChooseStops: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'settings':
      return renderSettings(state, {
        onExport: handleExport,
        onImport: (file, mode) => {
          void handleImport(file, mode);
        },
        onImportCsv: (file, labelsToApply) => {
          void handleImportCsv(file, labelsToApply);
        },
        onAddLabel: (name) => {
          void handleAddLabel(name);
        },
        onDeleteLabel: (name) => {
          void handleDeleteLabel(name);
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
  }
}

/** 画面本体に、下部の固定バー(選択バーとタブ)とダイアログを重ねて、アプリ全体を作る。 */
function renderApp(): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.append(renderScreen());

  const step = currentStep();
  if (step !== null) {
    const selectionBar =
      step === 'list'
        ? renderSelectionBar(state.selectedIds.length, {
            onNext: handleNext,
            onDeleteSelected: handleRequestDeleteSelected,
          })
        : null;
    // 固定バーに、内容の最後が隠れないよう、余白を取るクラスを付ける。
    shell.classList.add(selectionBar ? 'with-selection' : 'with-tabbar');

    const stack = document.createElement('div');
    stack.className = 'bottom-stack';
    if (selectionBar) {
      stack.append(selectionBar);
    }
    stack.append(renderTabBar(step, hasSelection(state), { onSelect: handleSelectStep }));
    shell.append(stack);
  }

  const dialog = renderDialog(state, {
    onEdit: handleEdit,
    onDuplicate: handleDuplicate,
    onRequestDelete: (id) => setState(openDeleteConfirm(state, id)),
    onConfirmDelete: (id) => {
      void handleDelete(id);
    },
    onConfirmDeleteSelected: () => {
      void handleConfirmDeleteSelected();
    },
    onClose: closeAnyDialog,
  });
  if (dialog) {
    shell.append(dialog);
  }
  return shell;
}

/**
 * 画面全体を作り直すため、そのままでは検索欄に1文字打つたびにフォーカスが外れる。
 * 描画の前後でフォーカス位置を引き継ぐ。ダイアログは、開いたら最初のボタンへ、
 * 閉じたら開いた元の「⋯」へ、フォーカスを移す。
 */
function render(): void {
  const active = document.activeElement;
  const testid = active instanceof HTMLElement ? active.dataset.testid : undefined;
  const rowId = active instanceof HTMLElement ? active.dataset.id : undefined;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
  const hadDialog = root!.querySelector('[data-testid="dialog"]') !== null;

  root!.replaceChildren(renderApp());
  // ダイアログを開いている間は、背後をスクロールさせない。
  document.body.classList.toggle('dialog-open', state.dialog !== null);
  syncSession();

  const dialog = root!.querySelector<HTMLElement>('[data-testid="dialog"]');
  if (dialog) {
    dialog.querySelector<HTMLElement>('button')?.focus();
    return;
  }
  if (hadDialog && dialogReturnId !== null) {
    root!
      .querySelector<HTMLElement>(`[data-testid="row-menu"][data-id="${dialogReturnId}"]`)
      ?.focus();
    dialogReturnId = null;
    return;
  }

  if (testid === undefined) {
    return;
  }
  const selector =
    rowId === undefined
      ? `[data-testid="${testid}"]`
      : `[data-testid="${testid}"][data-id="${rowId}"]`;
  const restored = root!.querySelector<HTMLElement>(selector);
  if (!restored) {
    return;
  }
  restored.focus();
  if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
    restored.setSelectionRange(caret, caret);
  }
}

/** ロック画面を通過してから、いつもどおりアプリ本体を描画・読み込みする。 */
function startApp(): void {
  render();
  void reloadPatients();
}

/**
 * 合言葉の入力。正しければ解錠してアプリ本体へ、違えばエラーつきでロック画面を出し直す。
 * (本物のログインではない。src/passwordGate.ts を参照。)
 */
function handlePasswordSubmit(password: string): void {
  if (checkPassword(password)) {
    unlock();
    startApp();
    return;
  }
  root!.replaceChildren(renderPasswordGate({ onSubmit: handlePasswordSubmit }, true));
  root!.querySelector<HTMLInputElement>('[data-testid="password-input"]')?.focus();
}

if (isUnlocked()) {
  startApp();
} else {
  root!.replaceChildren(renderPasswordGate({ onSubmit: handlePasswordSubmit }, false));
}
