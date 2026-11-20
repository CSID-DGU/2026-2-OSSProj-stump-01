// #4 수종별 기본 콘텐츠 카드. 내용은 Src/content/species-cards.json(#77, 오승현)에 있고 여기서는 읽어서 찾기만 한다.
// 나무의 trees.species 값이 어떤 카드의 aliases 에 있으면 그 카드를 쓴다. 상위 10종 밖이면 카드가 없다(Src/content/README.md).
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 화면에 함께 보여 줄 출처 문구 (Src/content/README.md 출처)
const SOURCE = '수종 정보: 국립수목원 국가생물종지식정보시스템 참고';

type CardFile = {
  cards: {
    id: string;
    name: string;
    aliases: string[];
    scientificName: string;
    family: string;
    leafType: string;
    seoulCount: number;
    rank: number;
    summary: string;
    features: string[];
    seasons: { spring: string; summer: string; autumn: string; winter: string };
  }[];
};

export type SpeciesCard = Omit<CardFile['cards'][number], 'aliases'> & { source: string };

// citizen/ 에서 돌든 빌드한 dist/citizen/ 에서 돌든 Src/content 를 찾는다
const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = basename(dirname(here)) === 'dist' ? dirname(dirname(here)) : dirname(here);
const CARD_FILE = join(backendRoot, '..', 'content', 'species-cards.json');

// 서버를 켤 때 한 번 읽어 수종 이름 → 카드 표를 만든다
const cardBySpecies = new Map<string, SpeciesCard>();
for (const { aliases, ...card } of (JSON.parse(readFileSync(CARD_FILE, 'utf8')) as CardFile).cards) {
  for (const species of aliases) cardBySpecies.set(species, { ...card, source: SOURCE });
}

/** 가로수 데이터의 수종 이름으로 카드를 찾는다. 없으면 null */
export function findSpeciesCard(species: string): SpeciesCard | null {
  return cardBySpecies.get(species) ?? null;
}
