// #66 단체 계정 (환경단체·학교·기업이 회원 활동을 단체 이름으로 묶어 본다)
// - 가입(회원 계정)은 하나로 두고, 가입한 시민이 단체를 만들거나 초대 코드로 단체에 연결한다
// - 단체 관리자는 users.role 이 아니라 organization_members.role = 'admin' 으로 판단한다(#3). 관리자도 자기 나무를 돌보는 돌보미다
// - 단체는 회원 기록을 읽고 묶어 볼 뿐 상태를 바꾸지 않는다(CLAUDE.md 경계 규칙)
import { randomInt } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool, withTransaction, type Db } from '../common/db.js';
import { HttpError, notFound } from '../common/errors.js';
import { summarizeOrganization, type MemberRow, type OrgActivityRow, type OrganizationSummary } from './organization-summary.js';

// ── 기준값 ──
const NAME_MAX_LENGTH = 50; // 단체 이름
const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I 는 뺀다
const INVITE_CODE_TRIES = 5; // 우연히 겹치면 다시 만든다

// ── 요청 형식 ──
const idParam = z.object({ id: z.coerce.number().int().positive() });
const createBody = z.object({ name: z.string().trim().min(1).max(NAME_MAX_LENGTH) });
const joinBody = z.object({ inviteCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,16}$/, '초대 코드 형식이 아니다.') });
const summaryQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '달은 YYYY-MM 형식이다.') });

// ── 응답 형식 ──
export type MyOrganizationView = {
  id: number;
  name: string;
  role: 'admin' | 'member';
  memberCount: number;
  inviteCode?: string; // 관리자에게만 보인다 (회원을 초대할 때 쓴다)
  joinedAt: string;
};

export type OrganizationSummaryView = OrganizationSummary & { organization: { id: number; name: string }; month: string };

function makeInviteCode(): string {
  return Array.from({ length: INVITE_CODE_LENGTH }, () => INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)]).join('');
}

const isUniqueViolation = (err: unknown, constraint: string) =>
  typeof err === 'object' && err !== null && 'constraint' in err && err.constraint === constraint;

/** 시민 계정만 단체를 만들고 가입한다 (구청 담당자는 단체에 속하지 않는다) */
function requireCitizen(req: Express.Request) {
  if (req.user!.role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 단체를 만들거나 가입할 수 있다.');
  return req.user!.id;
}

/** 한 사람이 본 그 단체 (역할·회원 수, 관리자면 초대 코드) */
async function myOrganization(db: Db, userId: number, organizationId: number): Promise<MyOrganizationView> {
  const { rows } = await db.query<{ id: number; name: string; invite_code: string; role: 'admin' | 'member'; joined_at: Date; member_count: number }>(
    `SELECT o.id, o.name, o.invite_code, m.role, m.joined_at,
            (SELECT count(*)::int FROM organization_members x WHERE x.organization_id = o.id) AS member_count
     FROM organizations o JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $1
     WHERE o.id = $2`,
    [userId, organizationId],
  );
  const r = rows[0]!;
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    memberCount: r.member_count,
    ...(r.role === 'admin' ? { inviteCode: r.invite_code } : {}),
    joinedAt: r.joined_at.toISOString(),
  };
}

// ── 라우터 (/organizations) ──
export const organizationsRouter = Router();
organizationsRouter.use(authenticate);

// 단체 만들기: 만든 사람이 관리자가 되고 초대 코드를 받는다
organizationsRouter.post('/', async (req, res) => {
  const userId = requireCitizen(req);
  const { name } = createBody.parse(req.body);

  const view = await withTransaction(async (db) => {
    for (let i = 0; i < INVITE_CODE_TRIES; i += 1) {
      try {
        await db.query('SAVEPOINT invite_code');
        const { rows } = await db.query<{ id: number }>('INSERT INTO organizations (name, invite_code) VALUES ($1, $2) RETURNING id', [
          name,
          makeInviteCode(),
        ]);
        await db.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'admin')`, [rows[0]!.id, userId]);
        return myOrganization(db, userId, rows[0]!.id);
      } catch (err) {
        if (!isUniqueViolation(err, 'organizations_invite_code_key')) throw err;
        await db.query('ROLLBACK TO SAVEPOINT invite_code'); // 코드가 겹쳤다. 다시 만든다
      }
    }
    throw new Error('초대 코드를 만들지 못했다.');
  });
  res.status(201).json(view);
});

// 초대 코드로 연결: 회원이 된다
organizationsRouter.post('/join', async (req, res) => {
  const userId = requireCitizen(req);
  const { inviteCode } = joinBody.parse(req.body);

  const view = await withTransaction(async (db) => {
    const { rows } = await db.query<{ id: number }>('SELECT id FROM organizations WHERE invite_code = $1', [inviteCode]);
    const org = rows[0];
    if (!org) throw notFound('초대 코드에 맞는 단체가 없다.');
    try {
      await db.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, [org.id, userId]);
    } catch (err) {
      if (isUniqueViolation(err, 'organization_members_org_user_key')) throw new HttpError(409, 'ALREADY_MEMBER', '이미 이 단체의 회원이다.');
      throw err;
    }
    return myOrganization(db, userId, org.id);
  });
  res.status(201).json(view);
});

// 내가 속한 단체
organizationsRouter.get('/me', async (req, res) => {
  const userId = req.user!.id;
  const pool = getPool();
  const { rows } = await pool.query<{ organization_id: number }>(
    'SELECT organization_id FROM organization_members WHERE user_id = $1 ORDER BY joined_at, id',
    [userId],
  );
  const organizations = await Promise.all(rows.map((r) => myOrganization(pool, userId, r.organization_id)));
  res.json({ organizations });
});

// 단체 리포트: 그 단체 관리자만. 그 달 회원 활동을 도로 구간별·회원별로 묶는다(읽기만)
organizationsRouter.get('/:id/summary', async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { month } = summaryQuery.parse(req.query);
  const pool = getPool();

  const { rows: orgs } = await pool.query<{ name: string; my_role: 'admin' | 'member' | null }>(
    `SELECT o.name, (SELECT m.role FROM organization_members m WHERE m.organization_id = o.id AND m.user_id = $2) AS my_role
     FROM organizations o WHERE o.id = $1`,
    [id, req.user!.id],
  );
  const org = orgs[0];
  if (!org) throw notFound('단체를 찾을 수 없다.');
  if (org.my_role !== 'admin') throw new HttpError(403, 'FORBIDDEN', '단체 관리자만 단체 리포트를 볼 수 있다.');

  const [members, activities] = await Promise.all([
    pool.query<{ user_id: number; nickname: string; role: 'admin' | 'member' }>(
      `SELECT m.user_id, u.nickname, m.role FROM organization_members m JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1`,
      [id],
    ),
    // 그 달(activity_date 는 한국 날짜) 회원의 활동 기록과 나무가 있는 구간
    pool.query<{ user_id: number; tree_id: number; district: string; place: string; date: string; minutes: number }>(
      `SELECT r.user_id, r.tree_id, t.district, COALESCE(t.road_name, t.dong, t.district) AS place,
              r.activity_date AS date, r.duration_min AS minutes
       FROM records r
       JOIN organization_members m ON m.user_id = r.user_id AND m.organization_id = $1
       JOIN trees t ON t.id = r.tree_id
       WHERE r.type = 'activity'
         AND r.activity_date >= to_date($2, 'YYYY-MM') AND r.activity_date < to_date($2, 'YYYY-MM') + interval '1 month'`,
      [id, month],
    ),
  ]);

  const memberRows: MemberRow[] = members.rows.map((m) => ({ userId: m.user_id, nickname: m.nickname, role: m.role }));
  const activityRows: OrgActivityRow[] = activities.rows.map((a) => ({
    userId: a.user_id,
    treeId: a.tree_id,
    district: a.district,
    place: a.place,
    date: a.date,
    minutes: a.minutes,
  }));
  const view: OrganizationSummaryView = {
    organization: { id, name: org.name },
    month,
    ...summarizeOrganization(memberRows, activityRows),
  };
  res.json(view);
});
