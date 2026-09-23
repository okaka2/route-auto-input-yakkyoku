import { describe, expect, it } from 'vitest';
import { buildGoogleMapsUrl } from '../src/googleMapsUrl';

describe('buildGoogleMapsUrl', () => {
  it('2件なら経路URLを作り、経由地は付けない', () => {
    const url = new URL(buildGoogleMapsUrl(['東京都千代田区1-1', '大阪市北区2-2']));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('東京都千代田区1-1');
    expect(url.searchParams.get('destination')).toBe('大阪市北区2-2');
    expect(url.searchParams.get('waypoints')).toBeNull();
    expect(url.searchParams.get('travelmode')).toBe('driving');
  });

  it('3件なら中間の1件を経由地にする', () => {
    const url = new URL(buildGoogleMapsUrl(['A市1', 'B市2', 'C市3']));
    expect(url.searchParams.get('origin')).toBe('A市1');
    expect(url.searchParams.get('waypoints')).toBe('B市2');
    expect(url.searchParams.get('destination')).toBe('C市3');
  });

  it('5件なら経由地3件を縦棒で連結する', () => {
    const url = new URL(buildGoogleMapsUrl(['A', 'B', 'C', 'D', 'E']));
    expect(url.searchParams.get('waypoints')).toBe('B|C|D');
  });

  it('縦棒はURL文字列上でエンコードされる', () => {
    const raw = buildGoogleMapsUrl(['A', 'B', 'C']);
    expect(raw).not.toContain('|');
  });

  it('日本語と空白を含む住所が往復して元に戻る', () => {
    const address = '東京都 千代田区 一番町 1-1 マンション 101';
    const url = new URL(buildGoogleMapsUrl([address, '大阪府']));
    expect(url.searchParams.get('origin')).toBe(address);
  });

  it('1件なら地点検索URLを作る', () => {
    const url = new URL(buildGoogleMapsUrl(['東京都千代田区1-1']));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('住所の前後の空白は取り除かれる', () => {
    const url = new URL(buildGoogleMapsUrl([' 東京都 ', ' 大阪府 ']));
    expect(url.searchParams.get('origin')).toBe('東京都');
  });

  it('空の住所が含まれると例外を投げる', () => {
    expect(() => buildGoogleMapsUrl(['東京都', '   '])).toThrow();
  });

  it('0件なら例外を投げる', () => {
    expect(() => buildGoogleMapsUrl([])).toThrow();
  });

  it('例外メッセージに住所を含めない', () => {
    try {
      buildGoogleMapsUrl(['東京都千代田区1-1', '   ']);
      expect.unreachable('例外が投げられるはず');
    } catch (error) {
      expect((error as Error).message).not.toContain('千代田');
    }
  });
});

describe('buildGoogleMapsUrl: 開いた人の現在地から出発する(fromCurrentLocation)', () => {
  it('出発地を付けず、最後を目的地、それ以外を経由地にする', () => {
    const url = new URL(buildGoogleMapsUrl(['A', 'B', 'C'], { fromCurrentLocation: true }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('origin')).toBeNull();
    expect(url.searchParams.get('waypoints')).toBe('A|B');
    expect(url.searchParams.get('destination')).toBe('C');
    expect(url.searchParams.get('travelmode')).toBe('driving');
  });

  it('1件でも地点検索ではなく、現在地からの経路にする', () => {
    const url = new URL(buildGoogleMapsUrl(['A'], { fromCurrentLocation: true }));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('destination')).toBe('A');
    expect(url.searchParams.get('waypoints')).toBeNull();
  });
});
