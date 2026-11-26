// 구청 화면의 단체별 필터 (#71 한눈에 보기, #73 상부 보고, 처리 목록)
// 단체를 고르면 그 단체 회원(신청자·보고서 제출자·물품 신청자·신고자·돌보미)으로 좁힌다.
import { z } from 'zod';
import type { Db } from '../common/db.js';
import { notFound } from '../common/errors.js';

/** 요청의 organizationId (없으면 전체) */
export const organizationIdQuery = z.coerce.number().int().positive().optional();

/**
 * userCol 사용자가 param 단체의 회원인지 보는 SQL 조건. param이 NULL이면 항상 참(필터 없음).
 * 예: memberOfSql('a.user_id', '$5')
 */
export function memberOfSql(userCol: string, param: string): string {
  return `(${param}::bigint IS NULL OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = ${param} AND om.user_id = ${userCol}))`;
}

/** 단체 id·이름. id가 없으면 null, 없는 단체면 404 */
export async function findOrganization(db: Db, id: number | null | undefined): Promise<{ id: number; name: string } | null> {
  if (id === null || id === undefined) return null;
  const { rows } = await db.query<{ id: number; name: string }>('SELECT id, name FROM organizations WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('단체를 찾을 수 없다.');
  return rows[0];
}
