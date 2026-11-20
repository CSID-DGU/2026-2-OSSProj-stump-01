// 수종 카드 찾기 단위 테스트. 실제 데이터 파일(Src/content/species-cards.json)을 읽는다.
import { describe, expect, it } from 'vitest';
import { findSpeciesCard } from './species-cards.js';

describe('findSpeciesCard', () => {
  it('가로수 데이터의 수종 이름(aliases)으로 카드를 찾는다', () => {
    expect(findSpeciesCard('은행나무')?.id).toBe('ginkgo');
    expect(findSpeciesCard('은행나무 암나무')?.id).toBe('ginkgo');
    expect(findSpeciesCard('왕벚나무')?.name).toBe('벚나무');
  });

  it('카드에는 화면에 보일 내용과 출처가 있고, 찾기용 aliases 는 뺀다', () => {
    const card = findSpeciesCard('느티나무')!;
    expect(card).toMatchObject({ name: '느티나무', source: '수종 정보: 국립수목원 국가생물종지식정보시스템 참고' });
    expect(card.features.length).toBeGreaterThan(0);
    expect(Object.keys(card.seasons)).toEqual(['spring', 'summer', 'autumn', 'winter']);
    expect(card).not.toHaveProperty('aliases');
  });

  it('상위 10종 밖의 수종은 카드가 없다(null)', () => {
    expect(findSpeciesCard('산딸나무')).toBeNull();
  });
});
