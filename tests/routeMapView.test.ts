import { describe, expect, it, vi } from 'vitest';
import { MAX_STOPS_PER_ROUTE } from '../src/config';
import { googleMapsProvider, type MapProvider } from '../src/mapProviders';
import { createPatient } from '../src/patient';
import { splitIntoRoutes } from '../src/routeSplitter';
import { createInitialState } from '../src/state';
import type { AppState, Patient } from '../src/types';
import { renderRouteMap, type RouteMapHandlers } from '../src/views/routeMapView';

const handlers = (): RouteMapHandlers => ({
  onOpenRoute: vi.fn(),
  onBack: vi.fn(),
  onChooseStops: vi.fn(),
  onShare: vi.fn(),
});

function makeStops(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

/**
 * ルート分割の挙動を見るテスト用に、選択件数の上限(MAX_SELECTION)にかかわらず
 * 好きな件数を選択済みにした状態を、直接組み立てる。
 */
function stateWithSelection(count: number): AppState {
  const patients = makeStops(count);
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

const render = (
  state: AppState,
  opened: ReadonlyMap<number, string> = new Map(),
  spies: RouteMapHandlers = handlers(),
  provider: MapProvider = googleMapsProvider,
) => renderRouteMap(state, opened, provider, spies);

const cards = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="route-card"]')];
const openButtons = (element: HTMLElement) =>
  element.querySelectorAll<HTMLButtonElement>('[data-testid="open-route"]');

// 上限の2倍なら、必ず2本以上に分かれる。
const SPLIT_COUNT = MAX_STOPS_PER_ROUTE * 2;
const routeCountFor = (count: number) => splitIntoRoutes(makeStops(count), MAX_STOPS_PER_ROUTE).length;

const OPENED_AT = new Date(2026, 8, 21, 14, 32).toISOString();

describe('renderRouteMap: 全体', () => {
  it('見出しは「地図を開く」', () => {
    expect(render(stateWithSelection(2)).querySelector('h1')?.textContent).toBe('地図を開く');
  });

  it('戻るボタンで onBack が呼ばれる', () => {
    const spies = handlers();
    render(stateWithSelection(2), new Map(), spies)
      .querySelector<HTMLButtonElement>('[data-testid="back-button"]')!
      .click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...stateWithSelection(2), message: { kind: 'error' as const, text: 'エラー' } };
    expect(render(state).querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('選択件数を「N件の訪問先が選択されています。」で出す', () => {
    const element = render(stateWithSelection(3));
    expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain(
      '3件の訪問先が選択されています。',
    );
  });
});

describe('renderRouteMap: ルートの分割', () => {
  it('上限ちょうどなら、カードは1枚で、分割の説明は出ない', () => {
    const element = render(stateWithSelection(MAX_STOPS_PER_ROUTE));
    expect(cards(element)).toHaveLength(1);
    expect(element.textContent).not.toContain('に分割します');
  });

  it('上限を超えると、ルートの本数ぶんのカードが並び、分割の説明に本数と上限が入る', () => {
    const expectedCount = routeCountFor(SPLIT_COUNT);
    expect(expectedCount).toBeGreaterThan(1);
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(cards(element)).toHaveLength(expectedCount);
    const summary = element.querySelector('[data-testid="map-summary"]')?.textContent ?? '';
    expect(summary).toContain(`${expectedCount}つのルートに分割します。`);
    expect(summary).toContain(`1つのルートは最大${MAX_STOPS_PER_ROUTE}地点までです。`);
    expect(summary).toContain('上から順に開いてください。');
  });

  it('カードに、ルート番号・地点数・名前の並びを出す', () => {
    const stops = makeStops(SPLIT_COUNT);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    const element = render(state);
    routes.forEach((route, index) => {
      const card = cards(element)[index]!;
      expect(card.querySelector('.route-title')?.textContent).toBe(`ルート${index + 1}`);
      expect(card.querySelector('.route-count')?.textContent).toBe(`${route.length}地点`);
      expect(card.querySelector('.route-names')?.textContent).toBe(
        route.map((patient) => patient.name).join(' → '),
      );
    });
  });

  it('境目の訪問先は、前後どちらのルートにも含まれる', () => {
    const stops = makeStops(MAX_STOPS_PER_ROUTE + 1);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    expect(routes).toHaveLength(2);
    const element = render(state);
    const boundary = routes[0]![routes[0]!.length - 1]!.name;
    expect(cards(element)[0]!.textContent).toContain(boundary);
    expect(cards(element)[1]!.textContent).toContain(boundary);
  });
});

describe('renderRouteMap: 開いたルートの状態', () => {
  it('何も開いていなければ、最初のルートが「次に開く」で、残りは後回しの表示', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    for (const state of states.slice(1)) {
      expect(state).toBe('later');
    }
  });

  it('「次に開く」のカードだけに、そのラベルが付く', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const labelled = cards(element).filter((card) => card.querySelector('.route-next-label') !== null);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(cards(element)[0]);
    expect(labelled[0]!.querySelector('.route-next-label')?.textContent).toBe('次に開く');
  });

  it('開いたルートは、「✓ Googleマップで開きました」と開いた日時を表示する', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    const status = card.querySelector('[data-testid="route-status"]')?.textContent ?? '';
    expect(status).toContain('✓ Googleマップで開きました');
    expect(status).toContain('9/21 14:32');
  });

  it('開いたルートのボタンは「もう一度開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.textContent).toBe('もう一度開く');
  });

  it('最初のルートを開いたら、2番目が「次に開く」になる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('done');
    expect(states[1]).toBe('next');
  });

  it('すべて開いたら、「次に開く」は無く、すべて「開きました」になる', () => {
    const count = routeCountFor(SPLIT_COUNT);
    const opened = new Map(Array.from({ length: count }, (_, i) => [i, OPENED_AT] as const));
    const element = render(stateWithSelection(SPLIT_COUNT), opened);
    expect(cards(element).every((card) => card.dataset.state === 'done')).toBe(true);
    expect(element.querySelector('.route-next-label')).toBeNull();
  });

  it('日時が空(古い記録)なら、開いたことは出すが日時は出さない', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, '']]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    expect(card.querySelector('[data-testid="route-status"]')?.textContent).toContain('開きました');
    expect(card.querySelector('.route-time')).toBeNull();
  });

  it('途中のルートだけ開いていても、最初の未開封が「次に開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[1, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    expect(states[1]).toBe('done');
  });
});

describe('renderRouteMap: ボタン', () => {
  it('ボタンを押すと、ルート番号つきで onOpenRoute が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(SPLIT_COUNT), new Map(), spies);
    openButtons(element)[1]?.click();
    expect(spies.onOpenRoute).toHaveBeenCalledWith(1);
  });

  it('ボタンはルート番号を data-id に持つ(フォーカス復元用)', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    openButtons(element).forEach((button, index) => {
      expect(button.dataset.id).toBe(String(index));
    });
  });

  it('ボタンの文言は、地図サービスの名前から作る', () => {
    const provider: MapProvider = { ...googleMapsProvider, label: 'テスト地図' };
    const element = render(stateWithSelection(2), new Map(), handlers(), provider);
    expect(openButtons(element)[0]?.textContent).toBe('テスト地図で開く');
  });

  it('ボタンには、どのルートを開くのかが分かる名前(aria-label)を付ける', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.getAttribute('aria-label')).toBe('ルート1をもう一度開く');
    expect(openButtons(element)[1]?.getAttribute('aria-label')).toBe('ルート2をGoogleマップで開く');
  });

  it('「次に開く」のボタンは青(primary)で目立たせる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(openButtons(element)[0]?.classList.contains('primary')).toBe(true);
    expect(openButtons(element)[1]?.classList.contains('primary')).toBe(false);
  });
});

describe('renderRouteMap: 訪問先が選ばれていないとき', () => {
  it('案内と「訪問先を選ぶ」ボタンを出し、ルートのカードは出さない', () => {
    const spies = handlers();
    const element = render(createInitialState([]), new Map(), spies);
    expect(element.textContent).toContain('訪問先が選ばれていません');
    expect(cards(element)).toHaveLength(0);
    element.querySelector<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();
    expect(spies.onChooseStops).toHaveBeenCalledTimes(1);
  });

  it('共有ボタンは出さない', () => {
    const element = render(createInitialState([]));
    expect(element.querySelector('[data-testid="share-routes"]')).toBeNull();
  });
});

describe('renderRouteMap: ルートの共有', () => {
  it('「ルートを共有」ボタンを出し、押すと onShare が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(3), new Map(), spies);
    const button = element.querySelector<HTMLButtonElement>('[data-testid="share-routes"]')!;
    expect(button.textContent).toContain('ルートを共有');
    button.click();
    expect(spies.onShare).toHaveBeenCalledTimes(1);
  });

  it('共有すると、開いた人の現在地から始まることを添えて案内する', () => {
    const element = render(stateWithSelection(3));
    expect(element.textContent).toContain('現在地から');
  });
});
