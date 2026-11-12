// 구청 모듈 라우터. app.ts에서 /admin 아래에 붙는다.
// 모든 경로는 구청 담당자만 쓰고, 자기 관리청(agency)의 데이터만 다룬다.
import { Router } from 'express';
import { authenticate, requireOfficer } from '../common/auth.js';
import { applicationsRouter } from './applications.js';

export const districtRouter = Router();

districtRouter.use(authenticate, requireOfficer);

// 기능별 라우터는 이슈마다 여기에 붙인다.
districtRouter.use('/applications', applicationsRouter); // #68 신청 심사
