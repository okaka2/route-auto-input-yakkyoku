/**
 * 「本物のログイン」ではない、簡易的な合言葉によるロック画面。
 * このアプリはサーバーを持たない静的サイトのため、コード(このファイル)は
 * 誰でも見られる。合言葉もソースコードにそのまま書いてあるため、開発者ツールで
 * 見ればすぐに分かってしまい、本物のセキュリティにはならない。あくまで、
 * URLを知らない人が中身をすぐには見られないようにする程度の目隠し。
 *
 * 一度正しい合言葉を入れたブラウザでは、以後は自動で通過する(localStorageに記録)。
 */

import { renderMessage } from './views/common';

const SITE_PASSWORD = 'houmon-ph2026';
const UNLOCK_KEY = 'route-auto-input-yakkyoku:unlocked';

export function checkPassword(input: string): boolean {
  return input === SITE_PASSWORD;
}

export function isUnlocked(): boolean {
  try {
    return window.localStorage.getItem(UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function unlock(): void {
  try {
    window.localStorage.setItem(UNLOCK_KEY, '1');
  } catch {
    // localStorageが使えない環境では諦める。次回もロック画面が出るだけ。
  }
}

export type PasswordGateHandlers = {
  onSubmit(password: string): void;
};

/** 合言葉を入力する画面。showError=trueのとき、直前の入力が違っていた旨を表示する。 */
export function renderPasswordGate(handlers: PasswordGateHandlers, showError: boolean): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen password-gate';

  const form = document.createElement('form');

  const title = document.createElement('h1');
  title.textContent = '合言葉を入力してください';
  form.append(title);

  if (showError) {
    form.append(renderMessage({ kind: 'error', text: '合言葉が違います。' }));
  }

  // 見た目のラベルは付けない(見出しで用途は分かるため)。aria-labelでスクリーンリーダー
  // 向けの名前だけ付ける。ラベル要素で囲むと、visually-hiddenで隠すときに中の入力欄まで
  // 一緒に見えなくなってしまうため、visually-hiddenなラベルでは囲まない。
  const input = document.createElement('input');
  input.type = 'password';
  input.dataset.testid = 'password-input';
  input.setAttribute('aria-label', '合言葉');
  input.autocomplete = 'off';
  input.autofocus = true;
  form.append(input);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'primary block';
  submit.dataset.testid = 'password-submit';
  submit.textContent = '開く';
  form.append(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onSubmit(input.value);
  });

  container.append(form);
  return container;
}
