// 퀴즈 출제·채점 단위 테스트. 마지막 묶음은 실제 데이터 파일(Src/content/quiz-bank.json)을 확인한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeQuiz, pickQuestions, type QuizBank, type QuizQuestion } from './quiz.js';

const question = (id: string, area: string, answer = 0): QuizQuestion => ({
  id,
  area,
  cardId: `${area}-card`,
  question: `${id} 문제`,
  choices: ['가', '나', '다', '라'],
  answer,
  explanation: `${id} 풀이`,
});

// 뽑기 시험용: 안전 3문항 중 2개 + 기록 2문항 중 1개
const smallBank: QuizBank = {
  quiz: {
    questionCount: 3,
    areas: [
      { id: 'safety', name: '안전', count: 2 },
      { id: 'record', name: '기록', count: 1 },
    ],
  },
  questions: [
    question('s1', 'safety'),
    question('s2', 'safety'),
    question('s3', 'safety'),
    question('r1', 'record'),
    question('r2', 'record'),
  ],
};

// 채점 시험용: 안전 3 + 기록 7 = 10문항, 정답은 모두 0번
const tenBank: QuizBank = {
  quiz: {
    questionCount: 10,
    areas: [
      { id: 'safety', name: '안전', count: 3 },
      { id: 'record', name: '기록', count: 7 },
    ],
  },
  questions: [
    ...['s1', 's2', 's3'].map((id) => question(id, 'safety')),
    ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((id) => question(id, 'record')),
  ],
};
const allCorrect = () => tenBank.questions.map((q) => ({ questionId: q.id, choice: 0 }));
const wrong = (answers: { questionId: string; choice: number }[], ids: string[]) =>
  answers.map((a) => (ids.includes(a.questionId) ? { ...a, choice: 1 } : a));

describe('pickQuestions', () => {
  it('영역마다 정해진 수만큼, 겹치지 않게, 영역 순서대로 뽑는다', () => {
    for (let n = 0; n < 20; n++) {
      const picked = pickQuestions(smallBank);
      expect(picked.map((q) => q.area)).toEqual(['safety', 'safety', 'record']);
      expect(new Set(picked.map((q) => q.id)).size).toBe(3);
    }
  });

  it('무작위 값에 따라 다른 문항이 나온다', () => {
    expect(pickQuestions(smallBank, () => 0).map((q) => q.id)).toEqual(['s1', 's2', 'r1']);
    expect(pickQuestions(smallBank, () => 0.99).map((q) => q.id)).toEqual(['s3', 's1', 'r2']);
  });
});

describe('gradeQuiz', () => {
  it('8문항 이상 맞히고 안전 문항을 모두 맞히면 통과한다', () => {
    const result = gradeQuiz(tenBank, wrong(allCorrect(), ['r1', 'r2']));
    expect(result).toMatchObject({ passed: true, score: 8, total: 10, safetyAllCorrect: true });
  });

  it('7문항이면 떨어진다', () => {
    expect(gradeQuiz(tenBank, wrong(allCorrect(), ['r1', 'r2', 'r3']))).toMatchObject({ passed: false, score: 7 });
  });

  it('9문항을 맞혀도 안전 문항을 하나 틀리면 떨어진다', () => {
    expect(gradeQuiz(tenBank, wrong(allCorrect(), ['s2']))).toMatchObject({
      passed: false,
      score: 9,
      safetyAllCorrect: false,
    });
  });

  it('문항마다 정답·풀이·다시 볼 카드를 돌려준다', () => {
    const result = gradeQuiz(tenBank, wrong(allCorrect(), ['s1']));
    if (typeof result === 'string') throw new Error(result);
    expect(result.results[0]).toEqual({
      questionId: 's1',
      area: 'safety',
      cardId: 'safety-card',
      choice: 1,
      answer: 0,
      correct: false,
      explanation: 's1 풀이',
    });
  });

  it('문항 수·영역별 수가 다르거나, 겹치거나, 없는 문항·보기면 거절한다', () => {
    const answers = allCorrect();
    expect(gradeQuiz(tenBank, answers.slice(0, 9))).toMatch(/10문항/);
    expect(gradeQuiz(tenBank, [...answers.slice(0, 9), answers[0]!])).toMatch(/두 번/);
    expect(gradeQuiz(tenBank, [...answers.slice(0, 9), { questionId: 'x9', choice: 0 }])).toMatch(/없는 문항/);
    expect(gradeQuiz(tenBank, [...answers.slice(0, 9), { questionId: 'r7', choice: 4 }])).toMatch(/보기 번호/);

    // 안전 2문항 + 기록 8문항: 쉬운 영역만 골라 내는 경우
    const lopsided: QuizBank = { ...tenBank, questions: [...tenBank.questions, question('r8', 'record')] };
    const picked = [...answers.filter((a) => a.questionId !== 's3'), { questionId: 'r8', choice: 0 }];
    expect(gradeQuiz(lopsided, picked)).toMatch(/안전 영역은 3문항/);
  });
});

describe('실제 문제은행 (Src/content)', () => {
  const contentDir = join(import.meta.dirname, '..', '..', 'content');
  const bank = JSON.parse(readFileSync(join(contentDir, 'quiz-bank.json'), 'utf8')) as QuizBank;
  const cards = JSON.parse(readFileSync(join(contentDir, 'education-cards.json'), 'utf8')) as { cards: { id: string }[] };

  it('영역별 문항 수를 더하면 출제 수이고, 영역마다 뽑을 만큼 문항이 있다', () => {
    expect(bank.quiz.areas.reduce((sum, a) => sum + a.count, 0)).toBe(bank.quiz.questionCount);
    for (const area of bank.quiz.areas) {
      expect(bank.questions.filter((q) => q.area === area.id).length).toBeGreaterThanOrEqual(area.count);
    }
    expect(bank.quiz.areas.some((a) => a.id === 'safety')).toBe(true);
  });

  it('문항 id 가 겹치지 않고, 정답 위치가 보기 안에 있고, 근거 카드가 있다', () => {
    const cardIds = new Set(cards.cards.map((c) => c.id));
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
    for (const q of bank.questions) {
      expect(q.answer, q.id).toBeLessThan(q.choices.length);
      expect(cardIds.has(q.cardId), q.id).toBe(true);
    }
  });

  it('뽑은 문항을 모두 맞히면 통과한다', () => {
    const picked = pickQuestions(bank);
    const result = gradeQuiz(bank, picked.map((q) => ({ questionId: q.id, choice: q.answer })));
    expect(result).toMatchObject({ passed: true, score: bank.quiz.questionCount });
  });
});
