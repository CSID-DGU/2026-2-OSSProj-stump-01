// 나무 이름: "은행나무, 소파로 3번"
// 같은 길에 같은 수종이 수십~수백 그루라 수종과 길만으로는 나무를 구분할 수 없어서, 길 안 번호(trees.place_no)를 붙인다.
// - 길: 노선명 → 동 → 자치구 중 있는 것 (place_no 를 매기는 기준과 같다. 마이그레이션 20261124140000)
// - 번호를 매기기 전(적재 직후, assign_tree_codes() 전)이면 번호 없이 "은행나무, 소파로"
// 모든 응답이 같은 이름을 쓰도록 SQL 조각을 여기에 모은다. 이름 모양을 바꾸려면 이 파일만 고친다.

/** 테이블 별칭 t 의 나무 이름 SQL (text) */
export function treeNameSql(t: string): string {
  return `(${t}.species || ', ' || COALESCE(${t}.road_name, ${t}.dong, ${t}.district) || COALESCE(' ' || ${t}.place_no || '번', ''))`;
}
