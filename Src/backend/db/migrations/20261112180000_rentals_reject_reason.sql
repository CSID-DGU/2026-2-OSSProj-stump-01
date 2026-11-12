-- migrate:up
-- #70 물품 반려 사유. 반려할 때 "재고 부족" 같은 사유를 남겨 신청자 알림에 함께 보낸다(선택 입력).
ALTER TABLE rentals ADD COLUMN reject_reason text;
ALTER TABLE rentals ADD CONSTRAINT rentals_reject_reason CHECK (status = 'rejected' OR reject_reason IS NULL);


-- migrate:down
ALTER TABLE rentals DROP CONSTRAINT rentals_reject_reason;
ALTER TABLE rentals DROP COLUMN reject_reason;
