// 여러 목록 API가 같이 쓰는 형식 (Src/backend/openapi.yaml)

/** 목록 응답: { items, total, limit, offset } */
export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
};

export type Person = {
  id: number;
  nickname: string;
  realName: string | null;
};
