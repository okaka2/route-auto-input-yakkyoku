import { afterEach, describe, expect, it, vi } from 'vitest';
import { googleMapsProvider } from '../src/mapProviders';
import { buildShareText, copyText, shareText } from '../src/share';

describe('copyText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('共有メニューがあっても使わず、クリップボードにコピーする', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await copyText('本文');
    expect(writeText).toHaveBeenCalledWith('本文');
    expect(share).not.toHaveBeenCalled();
  });

  it('クリップボードが使えなければ例外を投げる', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyText('本文')).rejects.toThrow();
  });
});

const addresses = (count: number) => Array.from({ length: count }, (_, i) => `東京都${i + 1}-1`);

describe('buildShareText', () => {
  it('1本のルートなら、件数とURLを1つだけ書く', () => {
    const text = buildShareText(addresses(3), 10, googleMapsProvider);
    const lines = text.split('\n');
    expect(lines[0]).toBe('訪問ルート(3件)');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
  });

  it('1本目は出発地を付けず、開いた人の現在地から始める', () => {
    const text = buildShareText(addresses(3), 10, googleMapsProvider);
    const url = new URL(text.split('\n')[1]!);
    expect(url.searchParams.get('origin')).toBeNull();
    expect(url.searchParams.get('waypoints')).toBe('東京都1-1|東京都2-1');
    expect(url.searchParams.get('destination')).toBe('東京都3-1');
  });

  it('ルートが分かれるときは、本数と「ルートN:」付きのURLを並べる', () => {
    const text = buildShareText(addresses(7), 5, googleMapsProvider);
    const lines = text.split('\n');
    expect(lines[0]).toBe('訪問ルート(7件・2本)');
    expect(lines[1]).toMatch(/^ルート1: https:/);
    expect(lines[2]).toMatch(/^ルート2: https:/);
  });

  it('2本目以降は、前のルートの最後の訪問先を出発地にしてつなげる', () => {
    const text = buildShareText(addresses(7), 5, googleMapsProvider);
    const second = new URL(text.split('\n')[2]!.replace(/^ルート2: /, ''));
    expect(second.searchParams.get('origin')).toBe('東京都5-1');
    expect(second.searchParams.get('destination')).toBe('東京都7-1');
  });

  it('名前は含まない(住所だけを渡す)', () => {
    const text = buildShareText(['東京都1-1'], 10, googleMapsProvider);
    expect(text).not.toContain('山田');
  });
});

describe('shareText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('共有メニュー(navigator.share)があれば、それで共有する', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    expect(await shareText('本文')).toBe('shared');
    expect(share).toHaveBeenCalledWith({ text: '本文' });
  });

  it('共有メニューを閉じて取りやめたら、何もしなかった扱いにする', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('キャンセル', 'AbortError'));
    vi.stubGlobal('navigator', { share });
    expect(await shareText('本文')).toBe('cancelled');
  });

  it('共有メニューが無ければ(PCなど)、クリップボードにコピーする', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await shareText('本文')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('本文');
  });

  it('どちらも使えなければ例外を投げる', async () => {
    vi.stubGlobal('navigator', {});
    await expect(shareText('本文')).rejects.toThrow();
  });
});
