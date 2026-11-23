// 구청 모듈 라우터. app.ts에서 /admin 아래에 붙는다.
// 모든 경로는 구청 담당자만 쓰고, 자기 관리청(agency)의 데이터만 다룬다.
import { Router } from 'express';
import { authenticate, requireOfficer } from '../common/auth.js';
import { applicationsRouter } from './applications.js';
import { careGapsRouter } from './care-gaps.js';
import { dashboardRouter } from './dashboard.js';
import { exportsRouter } from './exports.js';
import { incidentReportsRouter } from './incident-reports.js';
import { monthlyReportsRouter } from './monthly-reports.js';
import { rentalItemsRouter, rentalsRouter } from './rentals.js';

export const districtRouter = Router();

districtRouter.use(authenticate, requireOfficer);

// 기능별 라우터는 이슈마다 여기에 붙인다.
districtRouter.use('/applications', applicationsRouter); // #68 신청 심사
districtRouter.use('/monthly-reports', monthlyReportsRouter); // #69 보고서 검토·봉사시간
districtRouter.use('/dashboard', dashboardRouter); // #71 한눈에 보기
districtRouter.use('/rental-items', rentalItemsRouter); // #70 물품·재고
districtRouter.use('/rentals', rentalsRouter); // #70 물품 신청 처리
districtRouter.use('/incident-reports', incidentReportsRouter); // #20 신고 처리 큐
districtRouter.use('/care-gaps', careGapsRouter); // #22 관리 사각지대·활동 공백
districtRouter.use('/exports', exportsRouter); // #73 상부 보고·표창 대상 내려받기
