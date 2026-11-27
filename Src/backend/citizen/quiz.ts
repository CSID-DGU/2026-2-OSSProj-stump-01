// #10 돌보미 교육 퀴즈의 출제·채점 규칙. 화면·API와 분리한 순수 함수다(CLAUDE.md).
// 문제은행 내용과 영역별 문항 수는 Src/content/quiz-bank.json(#34, 오승현)에 있다. 통과 기준은 여기서 정한다.

// ── 기준값 ──
export const PASS_SCORE = 8; // 10문항 중 이만큼 맞혀야 통과
export const SAFETY_AREA = 'safety'; // 이 영역 문항은 하나라도 틀리면 떨어진다

export type QuizQuestion = {
  id: string;
  area: string;
  cardId: string; // 근거 교육 카드. 틀렸을 때 다시 볼 카드
  question: string;
  choices: string[];
  answer: number; // 정답 보기의 위치(0부터)
  explanation: string;
};

export type QuizBank = {
  quiz: { questionCount: number; areas: { id: string; name: string; count: number }[] };
  questions: QuizQuestion[];
};

export type SubmittedAnswer = { questionId: string; choice: number };

export type GradedAnswer = {
  questionId: string;
  area: string;
  cardId: string;
  choice: number;
  answer: number;
  correct: boolean;
  explanation: string;
};

export type QuizResult = {
  passed: boolean;
  score: number;
  total: number;
  safetyAllCorrect: boolean;
  results: GradedAnswer[];
};

/** 영역마다 정해진 수만큼 무작위로 뽑는다. 영역 순서(안전 먼저)대로 늘어놓는다 */
export function pickQuestions(bank: QuizBank, random: () => number = Math.random): QuizQuestion[] {
  return bank.quiz.areas.flatMap((area) => {
    const pool = bank.questions.filter((q) => q.area === area.id);
    // 피셔-예이츠 섞기를 앞에서 count 개까지만 한다
    for (let i = 0; i < area.count; i++) {
      const j = i + Math.floor(random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    return pool.slice(0, area.count);
  });
}

/**
 * 제출한 답을 채점한다. 낸 문항 구성이 규칙(문항 수·영역별 수, 겹침 없음)과 다르면 문제점을 문자열로 돌려준다.
 * 출제 기록을 저장하지 않으므로, 쉬운 문항만 골라 내는 일을 이 검사로 막는다.
 */
export function gradeQuiz(bank: QuizBank, answers: SubmittedAnswer[]): QuizResult | string {
  if (answers.length !== bank.quiz.questionCount) return `${bank.quiz.questionCount}문항을 모두 답해야 한다.`;
  if (new Set(answers.map((a) => a.questionId)).size !== answers.length) return '같은 문항을 두 번 낼 수 없다.';

  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const results: GradedAnswer[] = [];
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) return `없는 문항이다: ${a.questionId}`;
    if (a.choice >= q.choices.length) return `보기 번호가 범위를 벗어났다: ${a.questionId}`;
    results.push({
      questionId: q.id,
      area: q.area,
      cardId: q.cardId,
      choice: a.choice,
      answer: q.answer,
      correct: a.choice === q.answer,
      explanation: q.explanation,
    });
  }
  for (const area of bank.quiz.areas) {
    if (results.filter((r) => r.area === area.id).length !== area.count) {
      return `${area.name} 영역은 ${area.count}문항이어야 한다.`;
    }
  }

  const score = results.filter((r) => r.correct).length;
  const safetyAllCorrect = results.every((r) => r.area !== SAFETY_AREA || r.correct);
  return { passed: score >= PASS_SCORE && safetyAllCorrect, score, total: results.length, safetyAllCorrect, results };
}
