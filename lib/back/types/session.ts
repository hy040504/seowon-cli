/**
 * 학생 웹 세션 타입.
 *
 * 이 객체와 학교 CookieJar 는 프로세스 메모리에만 있다. 파일로 저장하지 않는다.
 */
import type {
  CourseRegistrationClient,
  EcampusClassroomItem,
  EcampusClient,
  ErpClient,
  HopeBasketClient
} from "../engine/index.js";

import type { MaterialRow, NoticeRow } from "./classroom.js";
import type { WebErpOverallGrades } from "./grades.js";
import type { ScoreRow } from "./score.js";
import type { Snapshot } from "./snapshot.js";
import type { SugangCredentials, WebStudent } from "./student.js";
import type { WebTimetable } from "./timetable.js";

/**
 * 학생별 메모리 세션.
 * 비밀번호는 SSO 가 필요해서 `sugangCreds` 에만 잠시 둔다. 디스크에는 쓰지 않는다.
 */
export interface WebSession {
  id: string; // 세션 ID (쿠키 sw_sid)
  createdAt: number; // 생성 시각(ms)
  lastSeen: number; // 마지막 접근 시각(ms)
  student: WebStudent; // 학생 요약
  client: EcampusClient | null; // e-campus 클라이언트
  courseReg: CourseRegistrationClient | null; // 본신청 클라이언트. 등록·취소는 부르지 않음
  hope: HopeBasketClient | null; // 희망바구니 클라이언트. 담기·취소는 부르지 않음
  erp: ErpClient | null; // 통합정보시스템 클라이언트. 지난 성적 조회용
  sugangCreds: SugangCredentials | null; // 시간표 SSO용 자격. 유휴 만료 시 지움
  snapshot: Snapshot | null; // 과제·이러닝 캐시
  rawAssignments: Map<string, EcampusClassroomItem>; // 과제 상세/제출용 원본 (crsCreCd::id)
  rawMaterials: Map<string, EcampusClassroomItem>; // 자료 첨부용 원본 (crsCreCd::id)
  materials: MaterialRow[] | null; // 강의자료실 목록 캐시
  rawNotices: Map<string, EcampusClassroomItem>; // 공지 상세용 원본 (crsCreCd::id)
  notices: NoticeRow[] | null; // 과목 공지 목록 캐시
  timetable: WebTimetable | null; // 시간표 캐시
  scores: ScoreRow[] | null; // e-campus 현재 성적 캐시
  erpGrades: WebErpOverallGrades | null; // ERP 지난 성적 캐시 (학기 목록 + 선택한 학기 상세)
  clientIp: string; // 마지막 요청 IP
  emptyFileAssignments: Set<string>; // 제출 파일을 비워 미제출로 볼 과제 키(crsCreCd::id)
}

/** createSession 초기값. 캐시 필드는 생략하면 빈 값으로 채운다 */
export interface CreateSessionInit {
  student: WebStudent; // 학생 요약
  client?: EcampusClient | null; // e-campus 클라이언트
  courseReg?: CourseRegistrationClient | null; // 본신청 클라이언트
  hope?: HopeBasketClient | null; // 희망바구니 클라이언트
  erp?: ErpClient | null; // 통합정보시스템 클라이언트
  sugangCreds?: SugangCredentials | null; // 시간표 SSO 자격
  snapshot?: Snapshot | null; // 미리 채운 스냅샷
  rawAssignments?: Map<string, EcampusClassroomItem>; // 미리 채운 과제 원본
  rawMaterials?: Map<string, EcampusClassroomItem>; // 미리 채운 자료 원본
  rawNotices?: Map<string, EcampusClassroomItem>; // 미리 채운 공지 원본
  clientIp?: string; // 로그인 시점 IP
}
