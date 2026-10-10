/**
 * Nexacro SSV 인코더/디코더.
 * sugangh API가 form-urlencoded 대신 RS/US 구분 본문을 요구해서 사용한다.
 */

import { escapeRegExp } from "../utils.js";
import type {
  EncodeSsvDatasetOptions,
  SsvDataset,
  SsvDocument,
  SsvParams,
  SsvRow
} from "./types/ssv.js";

export type {
  EncodeSsvDatasetOptions,
  SsvDataset,
  SsvDocument,
  SsvParams,
  SsvRow
} from "./types/ssv.js";

/** SSV Record Separator (0x1E) */
export const SSV_RS = "\u001e";

/** SSV Unit Separator (0x1F) */
export const SSV_US = "\u001f";

/** Nexacro 빈 셀. 빈 문자열을 그대로 보내면 컬럼 정렬이 깨질 수 있다 */
export const SSV_EMPTY = "\u0003";

/**
 * requestTimeStr 값을 생성한다
 * @param {number} [now=Date.now()] - 기준 시각(ms)
 * @returns {string} 서버가 기대하는 타임스탬프 문자열
 */
export function createSsvRequestTimeStr(now = Date.now()): string {
  return String(now);
}

/**
 * 빈 값을 Nexacro 빈 셀 표기로 바꾼다
 * @param {string | null | undefined} value - 원본 값
 * @returns {string} 인코딩용 셀 값
 */
export function toSsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return SSV_EMPTY;
  return String(value);
}

/**
 * Nexacro 빈 셀 표기를 일반 문자열로 복원한다
 * @param {string | null | undefined} value - SSV 셀 값
 * @returns {string} 복원된 문자열
 */
export function fromSsvCell(value: string | null | undefined): string {
  if (value === null || value === undefined || value === SSV_EMPTY) return "";
  return String(value);
}

/**
 * 파라미터와 데이터셋으로 요청 SSV 본문을 만든다
 * @param {SsvParams} [params={}] - 최상위 파라미터
 * @param {EncodeSsvDatasetOptions[]} [datasets=[]] - 포함할 데이터셋 목록
 * @returns {string} SSV 본문
 */
export function encodeSsvRequest(
  params: SsvParams = {},
  datasets: EncodeSsvDatasetOptions[] = []
): string {
  const parts: string[] = ["SSV:utf-8"];

  for (const [key, value] of Object.entries(params)) {
    parts.push(`${key}=${value ?? ""}`);
  }

  for (const dataset of datasets) {
    parts.push(`Dataset:${dataset.id}`);
    const typeLabel =
      dataset.uppercaseType === false ? "string(256)" : (dataset.columnType ?? "STRING(256)");
    const header = ["_RowType_", ...dataset.columns.map((column) => `${column}:${typeLabel}`)].join(
      SSV_US
    );
    parts.push(header);

    for (const row of dataset.rows) {
      const rowType = row._rowType ?? "N";
      const cells = dataset.columns.map((column) => toSsvCell(row[column]));
      parts.push([rowType, ...cells].join(SSV_US));
    }

    // 캡처된 클라이언트 요청과 동일하게 dataset 종료 빈 세그먼트를 남긴다
    parts.push("");
  }

  return parts.join(SSV_RS);
}

/**
 * 데이터셋 없이 파라미터만 있는 SSV 요청을 만든다
 * @param {SsvParams} params - 파라미터
 * @returns {string} SSV 본문
 */
export function encodeSsvParams(params: SsvParams): string {
  return encodeSsvRequest(params, []);
}

/**
 * SSV 본문을 문서 구조로 파싱한다
 * @param {string} body - 원본 본문
 * @returns {SsvDocument} 파싱 결과. SSV가 아니면 datasets가 비어 있다
 */
export function parseSsv(body: string): SsvDocument {
  const raw = body ?? "";
  if (!raw.startsWith("SSV:")) {
    return { encoding: "", params: {}, datasets: [], raw };
  }

  const parts = raw.split(SSV_RS);
  const encoding = parts[0]?.slice(4) || "utf-8";
  const params: SsvParams = {};
  const datasets: SsvDataset[] = [];
  let current: (SsvDataset & { sawColumns: boolean }) | null = null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part === undefined) continue;

    if (part.startsWith("Dataset:")) {
      current = { id: part.slice("Dataset:".length), columns: [], rows: [], sawColumns: false };
      datasets.push(current);
      continue;
    }

    if (!current) {
      const match = part.match(/^([^=:]+)(?::[^=]+)?=(.*)$/s);
      if (match?.[1]) {
        params[match[1]] = match[2] ?? "";
      }
      continue;
    }

    if (
      !current.sawColumns &&
      (part.startsWith("_RowType_") ||
        /:(?:STRING|string|bigdecimal|datetime|undefined|int)\b/i.test(part))
    ) {
      const cols = part.split(SSV_US);
      current.columns = cols.slice(1).map((column) => {
        const nameMatch = column.match(/^([^:]+):/);
        return nameMatch?.[1] ?? column;
      });
      current.sawColumns = true;
      continue;
    }

    if (part === "") continue;

    const values = part.split(SSV_US);
    const row: SsvRow = { _rowType: values[0] ?? "N" };
    current.columns.forEach((column, index) => {
      row[column] = fromSsvCell(values[index + 1]);
    });
    current.rows.push(row);
  }

  return { encoding, params, datasets, raw };
}

/**
 * 문서에서 데이터셋을 id로 찾는다
 * @param {SsvDocument} doc - 파싱된 문서
 * @param {string} id - 데이터셋 id
 * @returns {SsvDataset | undefined} 일치 데이터셋
 */
export function findSsvDataset(doc: SsvDocument, id: string): SsvDataset | undefined {
  return doc.datasets.find((dataset) => dataset.id === id);
}

/**
 * SSV ErrorCode를 숫자로 읽는다
 * @param {SsvDocument | SsvParams} source - 문서 또는 파라미터
 * @returns {number | undefined} 에러 코드
 */
export function readSsvErrorCode(source: SsvDocument | SsvParams): number | undefined {
  const params = isSsvDocument(source) ? source.params : source;
  const raw = params.ErrorCode ?? params.errorCode;
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Nexacro XML 응답 Parameter 값을 읽는다
 * @param {string} xml - XML 본문
 * @param {string} id - Parameter id
 * @returns {string} 값. 없으면 빈 문자열
 */
export function readNexacroXmlParameter(xml: string, id: string): string {
  const pattern = new RegExp(
    `<Parameter\\s+id="${escapeRegExp(id)}"[^>]*>([\\s\\S]*?)</Parameter>`,
    "i"
  );
  const match = xml.match(pattern);
  return match?.[1]?.trim() ?? "";
}

/**
 * Nexacro XML ErrorCode를 숫자로 읽는다
 * @param {string} xml - XML 본문
 * @returns {number | undefined} 에러 코드
 */
export function readNexacroXmlErrorCode(xml: string): number | undefined {
  const raw = readNexacroXmlParameter(xml, "ErrorCode");
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * SSV 문서 여부 타입 가드
 * @param {SsvDocument | SsvParams} source - 판별 대상
 * @returns {boolean} 문서 여부
 * @private
 */
function isSsvDocument(source: SsvDocument | SsvParams): source is SsvDocument {
  return (
    typeof source === "object" && source !== null && "datasets" in source && "params" in source
  );
}


