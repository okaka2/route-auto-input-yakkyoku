import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPassword, isUnlocked, renderPasswordGate, unlock } from '../src/passwordGate';

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

beforeEach(() => {
  window.localStorage.clear();
});

describe('checkPassword', () => {
  it('正しい合言葉ならtrue', () => {
    expect(checkPassword('houmon-ph2026')).toBe(true);
  });

  it('違う合言葉ならfalse', () => {
    expect(checkPassword('違う')).toBe(false);
  });

  it('空文字ならfalse', () => {
    expect(checkPassword('')).toBe(false);
  });
});

describe('isUnlocked / unlock', () => {
  it('最初はロックされている(unlocked=false)', () => {
    expect(isUnlocked()).toBe(false);
  });

  it('unlock()を呼ぶと、以後isUnlocked()はtrueになる', () => {
    unlock();
    expect(isUnlocked()).toBe(true);
  });

  afterEach(() => {
    window.localStorage.clear();
  });
});

describe('renderPasswordGate', () => {
  it('見出しと、合言葉の入力欄・開くボタンを出す', () => {
    const element = renderPasswordGate({ onSubmit: vi.fn() }, false);
    expect(element.textContent).toContain('合言葉を入力してください');
    const input = q<HTMLInputElement>(element, 'password-input');
    expect(input.type).toBe('password');
    expect(input.getAttribute('aria-label')).toBe('合言葉');
    expect(q<HTMLButtonElement>(element, 'password-submit').textContent).toBe('開く');
  });

  it('入力欄は、visually-hiddenなラベルなどで隠されていない(見えなくなるバグの再発防止)', () => {
    const element = renderPasswordGate({ onSubmit: vi.fn() }, false);
    const input = q<HTMLInputElement>(element, 'password-input');
    for (let ancestor: HTMLElement | null = input; ancestor !== null; ancestor = ancestor.parentElement) {
      expect(ancestor.classList.contains('visually-hidden')).toBe(false);
    }
  });

  it('showError=falseのときは、エラーを出さない', () => {
    const element = renderPasswordGate({ onSubmit: vi.fn() }, false);
    expect(element.querySelector('.message')).toBeNull();
  });

  it('showError=trueのときは、合言葉が違う旨のエラーを出す', () => {
    const element = renderPasswordGate({ onSubmit: vi.fn() }, true);
    expect(element.querySelector('.message')?.textContent).toBe('合言葉が違います。');
  });

  it('入力して送信すると、入力値つきでonSubmitが呼ばれる(ページ遷移はしない)', () => {
    const handlers = { onSubmit: vi.fn() };
    const element = renderPasswordGate(handlers, false);
    document.body.append(element);
    try {
      const input = q<HTMLInputElement>(element, 'password-input');
      input.value = 'houmon-ph2026';
      const form = element.querySelector('form')!;
      const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
      form.dispatchEvent(submitEvent);
      expect(handlers.onSubmit).toHaveBeenCalledWith('houmon-ph2026');
      expect(submitEvent.defaultPrevented).toBe(true);
    } finally {
      element.remove();
    }
  });
});
