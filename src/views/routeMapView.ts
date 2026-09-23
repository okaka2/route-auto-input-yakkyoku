import { MAX_STOPS_PER_ROUTE } from '../config';
import { formatDateTime } from '../format';
import type { MapProvider } from '../mapProviders';
import { splitIntoRoutes } from '../routeSplitter';
import { selectedPatients } from '../state';
import type { AppState, Patient } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type RouteMapHandlers = {
  onOpenRoute(routeIndex: number): void;
  onBack(): void;
  onChooseStops(): void;
  /** 「ルートを共有」。確認と共有(LINEなど)は呼び出し側が行う。 */
  onShare(): void;
  /** 「リンクをコピー」。共有メニューを使わず、URLをコピーする(PC向け)。 */
  onCopyLink(): void;
};

/** done: 開いた / next: 次に開く(最初の未開封) / later: それ以降 */
type CardState = 'done' | 'next' | 'later';

/**
 * 「地図を開く」画面。選んだ訪問先を、ルートごとのカードで表示する。
 * 上限を超えるときは、既存のルート分割で複数のカードになる。
 * 次に開くルートを最も目立たせ、開いたルートは「✓ 開きました」と日時で示す。
 *
 * @param opened 開いたルートの番号 → 開いた日時(ISO 8601。不明なら '')
 */
export function renderRouteMap(
  state: AppState,
  opened: ReadonlyMap<number, string>,
  provider: MapProvider,
  handlers: RouteMapHandlers,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('地図を開く', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const stops = selectedPatients(state);
  if (stops.length === 0) {
    container.append(renderEmpty(handlers));
    return container;
  }

  const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
  container.append(renderSummary(stops.length, routes.length));

  // 最初の未開封が「次に開く」。すべて開いていれば -1(「次に開く」は無い)。
  const nextIndex = routes.findIndex((_, index) => !opened.has(index));
  const cards = document.createElement('div');
  cards.className = 'route-cards';
  routes.forEach((route, index) => {
    const cardState: CardState = opened.has(index) ? 'done' : index === nextIndex ? 'next' : 'later';
    cards.append(renderRouteCard(route, index, cardState, opened.get(index) ?? '', provider, handlers));
  });
  container.append(cards, renderShare(handlers));
  return container;
}

/** 別の人に送るための共有ボタン。受け取った人はURLを開くだけで、同じルートの地図を使える。 */
function renderShare(handlers: RouteMapHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card share-card';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block';
  button.dataset.testid = 'share-routes';
  button.textContent = 'ルートを共有(LINEなど)';
  button.addEventListener('click', () => handlers.onShare());

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'block';
  copy.dataset.testid = 'copy-route-link';
  copy.textContent = 'リンクをコピー';
  copy.addEventListener('click', () => handlers.onCopyLink());

  const buttons = document.createElement('div');
  buttons.className = 'share-buttons';
  buttons.append(button, copy);

  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = '受け取った人は、URLを開くだけで同じルートの地図を使えます。案内は開いた人の現在地から始まります。';

  card.append(buttons, note);
  return card;
}

function renderEmpty(handlers: RouteMapHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card empty-card';

  const text = document.createElement('p');
  text.textContent = '訪問先が選ばれていません。';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'choose-stops-button';
  button.textContent = '訪問先を選ぶ';
  button.addEventListener('click', () => handlers.onChooseStops());

  card.append(text, button);
  return card;
}

function renderSummary(stopCount: number, routeCount: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card summary-card';
  card.dataset.testid = 'map-summary';

  const count = document.createElement('p');
  count.className = 'summary-count';
  count.textContent = `${stopCount}件の訪問先が選択されています。`;
  card.append(count);

  if (routeCount > 1) {
    const split = document.createElement('p');
    split.className = 'summary-split';
    split.textContent = `${routeCount}つのルートに分割します。1つのルートは最大${MAX_STOPS_PER_ROUTE}地点までです。上から順に開いてください。`;
    card.append(split);
  }
  return card;
}

function renderRouteCard(
  route: readonly Patient[],
  index: number,
  cardState: CardState,
  openedAt: string,
  provider: MapProvider,
  handlers: RouteMapHandlers,
): HTMLElement {
  const card = document.createElement('section');
  card.className = `route-card ${cardState}`;
  card.dataset.testid = 'route-card';
  card.dataset.state = cardState;
  card.dataset.id = String(index);

  const head = document.createElement('div');
  head.className = 'route-card-head';
  const title = document.createElement('h2');
  title.className = 'route-title';
  title.textContent = `ルート${index + 1}`;
  const count = document.createElement('span');
  count.className = 'route-count';
  count.textContent = `${route.length}地点`;
  head.append(title, count);
  if (cardState === 'next') {
    const label = document.createElement('span');
    label.className = 'route-next-label';
    label.textContent = '次に開く';
    head.append(label);
  }
  card.append(head);

  const names = document.createElement('p');
  names.className = 'route-names';
  names.textContent = route.map((patient) => patient.name).join(' → ');
  card.append(names);

  if (cardState === 'done') {
    const status = document.createElement('p');
    status.className = 'route-status';
    status.dataset.testid = 'route-status';
    const text = document.createElement('span');
    text.textContent = `✓ ${provider.label}で開きました`;
    status.append(text);
    const time = formatDateTime(openedAt);
    if (time !== '') {
      const timeElement = document.createElement('span');
      timeElement.className = 'route-time';
      timeElement.textContent = time;
      status.append(timeElement);
    }
    card.append(status);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'open-route';
  button.dataset.id = String(index);
  if (cardState === 'done') {
    button.textContent = 'もう一度開く';
    button.setAttribute('aria-label', `ルート${index + 1}をもう一度開く`);
  } else {
    button.className = cardState === 'next' ? 'primary block' : 'block';
    button.textContent = `${provider.label}で開く`;
    button.setAttribute('aria-label', `ルート${index + 1}を${provider.label}で開く`);
  }
  button.addEventListener('click', () => handlers.onOpenRoute(index));
  card.append(button);

  return card;
}
