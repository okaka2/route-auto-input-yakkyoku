import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import {
  createInitialState,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  setSearchQuery,
  toggleSelection,
} from '../src/state';
import type { AppState, Patient } from '../src/types';
import { validatePatientInput, validateSelection } from '../src/validation';
import { googleMapsProvider } from '../src/mapProviders';
import { renderDialog } from '../src/views/dialogs';
import { renderPatientForm } from '../src/views/patientFormView';
import { renderPatientList } from '../src/views/patientListView';
import { renderRouteMap } from '../src/views/routeMapView';
import { renderRouteOrder } from '../src/views/routeOrderView';
import { renderSelectionBar } from '../src/views/selectionBar';
import { renderSettings } from '../src/views/settingsView';
import { renderTabBar } from '../src/views/tabBar';

// 画面に出してはいけない、業種特有の表現と、以前のアプリ名。
// 「利用者」「患者」「薬局」は、薬局版ではアプリ名・初期設定のラベル(defaultLabels.ts)で
// 使うため解禁している。
const FORBIDDEN = ['在宅', '医療', 'ルート自動入力'];

function expectClean(label: string, text: string): void {
  for (const word of FORBIDDEN) {
    expect(text, `${label} に「${word}」が含まれている`).not.toContain(word);
  }
}

const noop = () => undefined;
const listHandlers = {
  onSearch: noop,
  onClearSearch: noop,
  onToggleSelect: noop,
  onSortChange: noop,
  onToggleSelectAll: noop,
  onToggleLabelFilter: noop,
  onNew: noop,
  onOpenMenu: noop,
  onOpenSettings: noop,
};
const dialogHandlers = {
  onEdit: noop,
  onDuplicate: noop,
  onRequestDelete: noop,
  onConfirmDelete: noop,
  onConfirmDeleteSelected: noop,
  onClose: noop,
};

function places(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

function selected(patients: Patient[]): AppState {
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

describe('画面の文言(禁止語が出ない)', () => {
  it('一覧: 空・通常・選択・検索なし・上限・メッセージ・検索語あり', () => {
    const many = places(MAX_SELECTION + 1);
    let atLimit = createInitialState(many);
    for (const place of many.slice(0, MAX_SELECTION)) {
      atLimit = toggleSelection(atLimit, place.id);
    }
    const states: AppState[] = [
      createInitialState([]),
      createInitialState(places(3)),
      toggleSelection(createInitialState(places(3)), places(3)[0]!.id),
      setSearchQuery(createInitialState(places(3)), 'どこにもない'),
      setSearchQuery(createInitialState(places(3)), '場所'),
      atLimit,
      { ...createInitialState(places(1)), message: { kind: 'error', text: 'x' } },
    ];
    states.forEach((state, index) => {
      expectClean(`一覧#${index}`, renderPatientList(state, listHandlers).outerHTML);
    });
  });

  it('ダイアログ: 「⋯」メニュー・削除の確認・一括削除の確認', () => {
    const patients = places(2);
    const base = createInitialState(patients);
    expectClean('メニュー', renderDialog(openRowMenu(base, patients[0]!.id), dialogHandlers)!.outerHTML);
    expectClean('削除の確認', renderDialog(openDeleteConfirm(base, patients[0]!.id), dialogHandlers)!.outerHTML);
    const twoSelected = { ...base, selectedIds: patients.map((p) => p.id) };
    expectClean(
      '一括削除の確認',
      renderDialog(openDeleteSelectedConfirm(twoSelected), dialogHandlers)!.outerHTML,
    );
  });

  it('登録・編集フォーム: 新規・編集・下書き・メッセージ', () => {
    const handlers = { onSave: noop, onCancel: noop };
    const patient = createPatient('場所1', '東京都1-1');
    const labels = ['場所ラベル'];
    expectClean('新規', renderPatientForm(null, null, null, labels, handlers).outerHTML);
    expectClean('編集', renderPatientForm(patient, null, null, labels, handlers).outerHTML);
    expectClean('下書き', renderPatientForm(null, { name: 'a', address: 'b' }, null, labels, handlers).outerHTML);
    expectClean(
      'メッセージ',
      renderPatientForm(null, null, { kind: 'error', text: 'x' }, labels, handlers).outerHTML,
    );
  });

  it('訪問順: 0件・1件・複数件・同じ住所', () => {
    const handlers = { onMove: noop, onAddStops: noop, onOpenMap: noop, onBack: noop };
    const same = places(2).map((place) => ({ ...place, address: '東京都1-1' }));
    for (const [label, state] of [
      ['0件', createInitialState([])],
      ['1件', selected(places(1))],
      ['3件', selected(places(3))],
      ['同じ住所', selected(same)],
    ] as const) {
      expectClean(`訪問順(${label})`, renderRouteOrder(state, handlers).outerHTML);
    }
  });

  it('地図: 0件・1本・分割・開いた後', () => {
    const handlers = { onOpenRoute: noop, onBack: noop, onChooseStops: noop, onShare: noop };
    const at = new Date(2026, 8, 21, 14, 32).toISOString();
    for (const [label, state, opened] of [
      ['0件', createInitialState([]), new Map<number, string>()],
      ['1本', selected(places(3)), new Map<number, string>()],
      ['分割', selected(places(12)), new Map<number, string>()],
      ['開いた後', selected(places(12)), new Map<number, string>([[0, at]])],
    ] as const) {
      expectClean(`地図(${label})`, renderRouteMap(state, opened, googleMapsProvider, handlers).outerHTML);
    }
  });

  it('設定・タブ・選択バー', () => {
    expectClean(
      '設定',
      renderSettings(createInitialState(places(2)), {
        onExport: noop,
        onImport: noop,
        onImportCsv: noop,
        onAddLabel: noop,
        onDeleteLabel: noop,
        onBack: noop,
      }).outerHTML,
    );
    expectClean('タブ', renderTabBar('list', true, { onSelect: noop }).outerHTML);
    expectClean('選択バー', renderSelectionBar(3, { onNext: noop, onDeleteSelected: noop })!.outerHTML);
  });

  it('検証メッセージ', () => {
    for (const result of [
      validatePatientInput('', 'x'),
      validatePatientInput('x', ''),
      validateSelection(0),
      validateSelection(MAX_SELECTION + 1),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expectClean('検証メッセージ', result.message);
      }
    }
  });
});

describe('ソースコード中の文字列(禁止語が出ない)', () => {
  // src 配下の全ての .ts を、文字列として読む。コメントは除いて、文字列リテラルだけを調べる。
  const sources = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function stringLiterals(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
    return withoutComments.match(pattern) ?? [];
  }

  it('画面に出る文字列に、禁止語を使っていない', () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBeGreaterThan(10);
    for (const [path, source] of entries) {
      for (const literal of stringLiterals(source)) {
        expectClean(`${path} の文字列 ${literal}`, literal);
      }
    }
  });
});
