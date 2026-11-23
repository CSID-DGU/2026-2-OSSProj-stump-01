// 물품 신청 화면의 기준값과 상태 이름 (#81). 물품은 신청 → 승인 → 수령으로 끝나고 반납이 없다.

export const MAX_QUANTITY = 5 // 한 번에 신청할 수 있는 수량 (서버와 같은 임시값)

export const RENTAL_STATUS = {
  requested: { label: '승인 대기', className: 'tc-status--wait', help: '' },
  approved: { label: '받으러 오세요', className: 'tc-status--done', help: '구청에서 물품을 받아 가세요.' },
  received: { label: '받음', className: 'tc-status--done', help: '' },
  rejected: { label: '반려', className: 'tc-status--alert', help: '' },
} as const
