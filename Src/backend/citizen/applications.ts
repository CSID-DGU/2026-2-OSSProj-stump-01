// #6 돌보미 신청서 제출 (시민)
// 제출은 시민-BE, 심사(승인·반려, 반려 사유)는 구청-BE(district/applications.ts)가 한다(CLAUDE.md 경계 규칙).
// 신청서 한 행은 나무 한 그루다. 여러 그루를 한 번에 내면 그루마다 신청서가 생기고, 구청은 그루마다 따로 심사한다.
// 항목은 구청 「나무돌보미(Adopt a Tree) 신청서(안)」 양식을 따른다. 입양대상지는 가로수뿐이라 칸이 없다.
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../common/auth.js';
import { getPool } from '../common/db.js';
import { HttpError } from '../common/errors.js';
import { treeNameSql } from '../common/tree-name.js';

// ── 기준값 ──
const MAX_TREES_PER_APPLICATION = 10; // 한 번에 신청할 수 있는 나무 수 (임시값)
const PERIOD_YEARS = 1; // 활동 기간. 양식: "1년을 기본으로 체결"
const MAX_HEADCOUNT = 1000; // 신청 인원 상한 (임시값)
const NAME_MAX_LENGTH = 100;
const ADDRESS_MAX_LENGTH = 200;
const MOTIVATION_MAX_LENGTH = 500;
const LONG_TEXT_MAX_LENGTH = 2000; // 활동계획·단체 소개
const TIME_ZONE = 'Asia/Seoul'; // "오늘"은 한국 시간 달력 기준

// 양식의 참여유형: 개인/가족, 기업, 시민단체, 종교단체, 마을공동체, 기타
const PARTICIPATION_TYPES = ['individual', 'company', 'civic_group', 'religious_group', 'village_community', 'other'] as const;
type ParticipationType = (typeof PARTICIPATION_TYPES)[number];

/** 오늘 날짜(한국 시간) 'YYYY-MM-DD' */
function seoulToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

/** 활동 종료일: 시작일부터 PERIOD_YEARS년 뒤의 전날. 예 2030-03-01 → 2031-02-28 */
function periodEndOf(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + PERIOD_YEARS);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ── 요청 형식 ──
const requiredText = (max: number) => z.string().trim().min(1).max(max);
// 비워 두면 null 로 저장한다
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const applicationBody = z
  .object({
    treeIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(MAX_TREES_PER_APPLICATION)
      .refine((ids) => new Set(ids).size === ids.length, '같은 나무를 두 번 넣을 수 없다.'),
    periodStart: z.iso.date(), // 'YYYY-MM-DD' 라 문자열 비교가 곧 날짜 비교다
    applicantName: requiredText(NAME_MAX_LENGTH), // 성명 또는 단체명
    contactPerson: optionalText(NAME_MAX_LENGTH), // 기업·단체의 담당부서·담당자
    headcount: z.number().int().min(1).max(MAX_HEADCOUNT),
    postalCode: z.string().regex(/^\d{5}$/, '우편번호는 5자리 숫자다.'),
    address: requiredText(ADDRESS_MAX_LENGTH),
    phone: z.string().trim().regex(/^0\d{1,2}-?\d{3,4}-?\d{4}$/, '연락처는 전화번호 형식이어야 한다.'),
    participationType: z.enum(PARTICIPATION_TYPES),
    motivation: requiredText(MOTIVATION_MAX_LENGTH), // 신청사유
    activityPlan: requiredText(LONG_TEXT_MAX_LENGTH), // 별첨 2. 활동계획서 (형식 자유)
    organizationIntro: optionalText(LONG_TEXT_MAX_LENGTH), // 별첨 1. 기업/단체 소개서
    agreed: z.literal(true, '참여 안내 사항에 동의해야 신청할 수 있다.'),
  })
  .refine((b) => b.periodStart >= seoulToday(), {
    path: ['periodStart'],
    message: '시작일은 오늘이거나 그 뒤여야 한다.',
  })
  .refine((b) => b.participationType === 'individual' || b.contactPerson !== null, {
    path: ['contactPerson'],
    message: '기업·단체는 담당부서와 담당자를 적어야 한다.',
  });

// ── 응답 형식 ──
type ApplicationStatus = 'pending' | 'approved' | 'rejected' | 'ended';

export type MyApplicationView = {
  id: number;
  status: ApplicationStatus;
  periodStart: string;
  periodEnd: string;
  applicantName: string | null;
  contactPerson: string | null;
  headcount: number | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  participationType: ParticipationType | null;
  motivation: string | null;
  activityPlan: string | null;
  organizationIntro: string | null;
  agreedAt: string | null;
  rejectReason: string | null; // 반려됐을 때 구청이 남긴 사유
  createdAt: string;
  reviewedAt: string | null;
  tree: {
    id: number;
    code: string | null;
    name: string; // "은행나무, 소파로 3번" (common/tree-name.ts)
    species: string;
    district: string;
    dong: string | null;
    roadName: string | null;
    address: string | null;
  };
};

// 제출 응답과 내 신청서 목록이 같은 모양을 쓰도록 SELECT를 하나로 둔다. $1 = 신청한 시민
// (양식 항목이 없는 행은 이 양식을 넣기 전에 만든 신청서다)
const SELECT_MY_APPLICATION = `
  SELECT a.id, a.status, a.period_start, a.period_end,
         a.applicant_name, a.contact_person, a.headcount, a.postal_code, a.address AS applicant_address, a.phone,
         a.participation_type, a.motivation, a.activity_plan, a.organization_intro, a.agreed_at,
         a.reject_reason, a.created_at, a.reviewed_at,
         t.id AS tree_id, t.code, ${treeNameSql('t')} AS tree_name, t.species, t.district, t.dong, t.road_name, t.address
  FROM caregiver_applications a
  JOIN trees t ON t.id = a.tree_id
  WHERE a.user_id = $1`;

type MyApplicationRow = {
  id: number;
  status: ApplicationStatus;
  period_start: string;
  period_end: string;
  applicant_name: string | null;
  contact_person: string | null;
  headcount: number | null;
  postal_code: string | null;
  applicant_address: string | null;
  phone: string | null;
  participation_type: ParticipationType | null;
  motivation: string | null;
  activity_plan: string | null;
  organization_intro: string | null;
  agreed_at: Date | null;
  reject_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  tree_id: number;
  code: string | null;
  tree_name: string;
  species: string;
  district: string;
  dong: string | null;
  road_name: string | null;
  address: string | null;
};

function toView(r: MyApplicationRow): MyApplicationView {
  return {
    id: r.id,
    status: r.status,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    applicantName: r.applicant_name,
    contactPerson: r.contact_person,
    headcount: r.headcount,
    postalCode: r.postal_code,
    address: r.applicant_address,
    phone: r.phone,
    participationType: r.participation_type,
    motivation: r.motivation,
    activityPlan: r.activity_plan,
    organizationIntro: r.organization_intro,
    agreedAt: r.agreed_at?.toISOString() ?? null,
    rejectReason: r.reject_reason,
    createdAt: r.created_at.toISOString(),
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    tree: {
      id: r.tree_id,
      code: r.code,
      name: r.tree_name,
      species: r.species,
      district: r.district,
      dong: r.dong,
      roadName: r.road_name,
      address: r.address,
    },
  };
}

// ── 라우터 (/applications) ──
export const applicationsRouter = Router();
applicationsRouter.use(authenticate);

// 신청서 제출: 고른 나무마다 대기(pending) 신청서를 만든다. 양식 항목은 그루마다 같은 값이 들어간다.
// INSERT 한 문장으로 넣으므로 한 그루라도 막히면 아무것도 저장되지 않는다.
//  - 이미 대기·승인 중인 나무가 섞임: 유일 인덱스 caregiver_applications_one_open → 409
//  - 없는 나무가 섞임: 외래 키 → 400
applicationsRouter.post('/', async (req, res) => {
  const { id: userId, role } = req.user!;
  if (role !== 'citizen') throw new HttpError(403, 'FORBIDDEN', '시민 계정만 돌보미를 신청할 수 있다.');
  const b = applicationBody.parse(req.body);

  const pool = getPool();
  // unnest: 나무 id 배열을 행으로 펼쳐 그루마다 한 행씩 넣는다
  const { rows: inserted } = await pool.query<{ id: number }>(
    `INSERT INTO caregiver_applications
       (user_id, tree_id, period_start, period_end, applicant_name, contact_person, headcount, postal_code,
        address, phone, participation_type, motivation, activity_plan, organization_intro, agreed_at)
     SELECT $1, tree_id, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now()
     FROM unnest($2::bigint[]) AS tree_id
     RETURNING id`,
    [
      userId,
      b.treeIds,
      b.periodStart,
      periodEndOf(b.periodStart),
      b.applicantName,
      b.contactPerson,
      b.headcount,
      b.postalCode,
      b.address,
      b.phone,
      b.participationType,
      b.motivation,
      b.activityPlan,
      b.organizationIntro,
    ],
  );
  const { rows } = await pool.query<MyApplicationRow>(`${SELECT_MY_APPLICATION} AND a.id = ANY($2::bigint[]) ORDER BY a.id`, [
    userId,
    inserted.map((r) => r.id),
  ]);
  res.status(201).json({ applications: rows.map(toView) });
});

// 내 신청서: 최신순. 반려됐으면 사유가 함께 온다
applicationsRouter.get('/me', async (req, res) => {
  const { rows } = await getPool().query<MyApplicationRow>(
    `${SELECT_MY_APPLICATION} ORDER BY a.created_at DESC, a.id DESC`,
    [req.user!.id],
  );
  res.json({ applications: rows.map(toView) });
});
