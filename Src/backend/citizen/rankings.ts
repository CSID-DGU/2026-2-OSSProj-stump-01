// #15 참여 보상 API: 내 활동 통계·배지, 순위 켜기/끄기, 활동 순위·공식 순위. 집계는 rewards.ts 가 한다.
// 스탬프·새 배지는 활동 기록을 남길 때 POST /records 응답의 reward 로도 온다(records.ts).
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { activityRanking, monthlyMvp, myBadges, myStats, officialRanking, seoulMonth } from './rewards.js';

const rankingQuery = z.object({ type: z.enum(['activity', 'official']).default('activity') });
const visibilityBody = z.object({ visible: z.boolean() });

// ── 내 통계·배지·순위 공개 (/me) ──
export const meRewardsRouter = Router();
meRewardsRouter.use(authenticate);

meRewardsRouter.get('/stats', async (req, res) => {
  res.json(await myStats(getPool(), req.user!.id));
});

meRewardsRouter.get('/badges', async (req, res) => {
  res.json({ badges: await myBadges(getPool(), req.user!.id) });
});

// 순위 켜기/끄기. 끄면 활동·공식 순위와 이달의 MVP 목록에서 빠진다
meRewardsRouter.put('/ranking', async (req, res) => {
  const { visible } = visibilityBody.parse(req.body);
  await getPool().query('UPDATE users SET ranking_hidden = $1 WHERE id = $2', [!visible, req.user!.id]);
  res.json({ visible });
});

// ── 순위 (/rankings) ──
export const rankingsRouter = Router();
rankingsRouter.use(authenticate);

rankingsRouter.get('/', async (req, res) => {
  const { type } = rankingQuery.parse(req.query);
  const db = getPool();
  const userId = req.user!.id;
  const month = seoulMonth();
  if (type === 'activity') {
    res.json({ type, month, ...(await activityRanking(db, month, userId)) });
  } else {
    res.json({ type, ...(await officialRanking(db, userId)), mvp: { month, winners: await monthlyMvp(db, month, userId) } });
  }
});
