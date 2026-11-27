// #10 돌보미 교육·퀴즈 API. 교육 카드·문제은행은 Src/content/(#34, 오승현)에서 읽고, 출제·채점은 quiz.ts 가 한다.
// - 통과하면 users.education_completed_at 에 이수 시각을 남긴다. 이미 이수했으면 처음 시각을 그대로 둔다.
//   이 값은 신고 신뢰도(reports.is_trusted)에 쓰인다(db/ERD.md).
// - 응시 기록은 따로 저장하지 않는다. 몇 번이든 다시 볼 수 있다.
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { HttpError } from '../common/errors.js';
import { gradeQuiz, PASS_SCORE, pickQuestions, type QuizBank } from './quiz.js';

type EducationCardFile = {
  areas: { id: string; name: string }[];
  cards: { id: string; area: string; order: number; title: string; body: string; points: string[] }[];
};

// citizen/ 에서 돌든 빌드한 dist/citizen/ 에서 돌든 Src/content 를 찾는다 (species-cards.ts 와 같은 방식)
const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = basename(dirname(here)) === 'dist' ? dirname(dirname(here)) : dirname(here);
const contentDir = join(backendRoot, '..', 'content');

// 서버를 켤 때 한 번 읽는다
const education = JSON.parse(readFileSync(join(contentDir, 'education-cards.json'), 'utf8')) as EducationCardFile;
export const quizBank = JSON.parse(readFileSync(join(contentDir, 'quiz-bank.json'), 'utf8')) as QuizBank;

// 영역 순서 → 영역 안 순서로 늘어놓은 카드
const areaOrder = new Map(education.areas.map((a, i) => [a.id, i]));
const sortedCards = [...education.cards].sort(
  (a, b) => (areaOrder.get(a.area) ?? 0) - (areaOrder.get(b.area) ?? 0) || a.order - b.order,
);

// ── 요청 형식 ──
const submitBody = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), choice: z.number().int().min(0) }))
    .min(1)
    .max(50),
});

export const educationRouter = Router();

// 교육 카드 (로그인 없음)
educationRouter.get('/cards', (_req, res) => {
  res.json({ areas: education.areas, cards: sortedCards });
});

// 퀴즈 문항 뽑기. 정답·풀이는 빼고 준다
educationRouter.get('/quiz', authenticate, (_req, res) => {
  const questions = pickQuestions(quizBank).map(({ id, area, question, choices }) => ({ id, area, question, choices }));
  res.json({ passScore: PASS_SCORE, questions });
});

// 답 제출·채점. 통과하면 교육 이수를 기록한다
educationRouter.post('/quiz', authenticate, async (req, res) => {
  const { answers } = submitBody.parse(req.body);
  const result = gradeQuiz(quizBank, answers);
  if (typeof result === 'string') throw new HttpError(400, 'INVALID_ANSWERS', result);

  const { rows } = await getPool().query<{ education_completed_at: Date | null }>(
    result.passed
      ? 'UPDATE users SET education_completed_at = COALESCE(education_completed_at, now()) WHERE id = $1 RETURNING education_completed_at'
      : 'SELECT education_completed_at FROM users WHERE id = $1',
    [req.user!.id],
  );
  res.json({
    ...result,
    passScore: PASS_SCORE,
    educationCompletedAt: rows[0]?.education_completed_at?.toISOString() ?? null,
  });
});
