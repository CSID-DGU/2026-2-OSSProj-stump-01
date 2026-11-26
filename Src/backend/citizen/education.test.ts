import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../common/db.js';
import { createUser, resetData } from '../test/fixtures.js';
import { quizBank } from './education.js';

const api = createApp();

beforeEach(resetData);
afterAll(closePool);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const answerOf = new Map(quizBank.questions.map((q) => [q.id, q.answer]));

/** 퀴즈를 받아 앞에서 wrongCount 문항만 틀리게 답한다 */
async function takeQuiz(token: string, wrongCount = 0) {
  const quiz = await request(api).get('/education/quiz').set(auth(token));
  const answers = (quiz.body.questions as { id: string }[]).map((q, i) => {
    const answer = answerOf.get(q.id)!;
    return { questionId: q.id, choice: i < wrongCount ? (answer + 1) % 4 : answer };
  });
  return request(api).post('/education/quiz').set(auth(token)).send({ answers });
}

const completedAt = async (userId: number) =>
  (await getPool().query('SELECT education_completed_at FROM users WHERE id = $1', [userId])).rows[0].education_completed_at;

describe('GET /education/cards', () => {
  it('로그인 없이 교육 카드를 영역 순서대로 준다', async () => {
    const res = await request(api).get('/education/cards');

    expect(res.status).toBe(200);
    expect(res.body.areas[0]).toEqual({ id: 'safety', name: '안전' });
    expect(res.body.cards.length).toBeGreaterThan(0);
    expect(res.body.cards[0]).toMatchObject({ area: 'safety', order: 1 });
  });
});

describe('GET /education/quiz', () => {
  it('10문항을 정답·풀이 없이 준다', async () => {
    const me = await createUser();
    const res = await request(api).get('/education/quiz').set(auth(me.token));

    expect(res.status).toBe(200);
    expect(res.body.passScore).toBe(8);
    expect(res.body.questions).toHaveLength(10);
    expect(res.body.questions.filter((q: { area: string }) => q.area === 'safety')).toHaveLength(3);
    expect(Object.keys(res.body.questions[0]).sort()).toEqual(['area', 'choices', 'id', 'question']);
  });

  it('로그인이 필요하다', async () => {
    expect((await request(api).get('/education/quiz')).status).toBe(401);
  });
});

describe('POST /education/quiz', () => {
  it('통과하면 교육 이수를 기록하고, 다시 통과해도 처음 이수 시각을 그대로 둔다', async () => {
    const me = await createUser();

    const first = await takeQuiz(me.token);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ passed: true, score: 10, total: 10, safetyAllCorrect: true });
    expect(first.body.results).toHaveLength(10);
    expect(first.body.educationCompletedAt).not.toBeNull();
    const firstAt = await completedAt(me.id);

    const again = await takeQuiz(me.token);
    expect(again.body.educationCompletedAt).toBe(first.body.educationCompletedAt);
    expect(await completedAt(me.id)).toEqual(firstAt);

    const meRes = await request(api).get('/auth/me').set(auth(me.token));
    expect(meRes.body.educationCompleted).toBe(true);
  });

  it('안전 문항을 하나 틀리면 9점이어도 떨어지고 이수를 기록하지 않는다', async () => {
    const me = await createUser();
    const res = await takeQuiz(me.token, 1); // 첫 문항은 안전 영역

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ passed: false, score: 9, safetyAllCorrect: false, educationCompletedAt: null });
    expect(res.body.results[0]).toMatchObject({ correct: false, area: 'safety' });
    expect(res.body.results[0].cardId).toBeTruthy(); // 다시 볼 카드
    expect(await completedAt(me.id)).toBeNull();
  });

  it('떨어져도 이미 이수했으면 이수 기록은 남는다', async () => {
    const me = await createUser();
    await takeQuiz(me.token);
    const res = await takeQuiz(me.token, 5);

    expect(res.body.passed).toBe(false);
    expect(res.body.educationCompletedAt).not.toBeNull();
  });

  it('문항 구성이 규칙과 다르면 400 INVALID_ANSWERS', async () => {
    const me = await createUser();
    const safety = quizBank.questions.filter((q) => q.area === 'safety');
    const answers = safety.slice(0, 8).map((q) => ({ questionId: q.id, choice: q.answer }));
    const others = quizBank.questions.filter((q) => q.area === 'operation').slice(0, 2);
    answers.push(...others.map((q) => ({ questionId: q.id, choice: q.answer })));

    const res = await request(api).post('/education/quiz').set(auth(me.token)).send({ answers });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ANSWERS');
    expect(await completedAt(me.id)).toBeNull();
  });

  it('로그인이 필요하다', async () => {
    expect((await request(api).post('/education/quiz').send({ answers: [] })).status).toBe(401);
  });
});
