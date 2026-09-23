/** SSV 최상위 파라미터 맵 */
export type SsvParams = Record<string, string>;

/** SSV 데이터 행 */
export type SsvRow = Record<string, string> & {
  _rowType?: string; // N/U/O/I 등 Nexacro 행 타입
};

/** SSV 데이터셋 */
export interface SsvDataset {
  id: string; // 데이터셋 id
  columns: string[]; // 컬럼 이름
  rows: SsvRow[]; // 행 목록
}

/** 파싱된 SSV 문서 */
export interface SsvDocument {
  encoding: string; // 선언 인코딩
  params: SsvParams; // 최상위 파라미터
  datasets: SsvDataset[]; // 데이터셋 목록
  raw: string; // 원본 본문
}

/** 데이터셋 인코딩 옵션 */
export interface EncodeSsvDatasetOptions {
  id: string; // 데이터셋 id
  columns: string[]; // 컬럼 이름
  rows: Array<Record<string, string | undefined | null>>; // 인코딩할 행
  columnType?: string; // 컬럼 타입 표기. 기본 STRING(256)
  uppercaseType?: boolean; // 요청용 대문자 타입 사용 여부
}
