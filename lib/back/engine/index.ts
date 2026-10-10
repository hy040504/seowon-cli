/**
 * 웹이 쓰는 학교 연동 엔진.
 *
 * seowon-client-api 에서 조회·로그인·시간표에 필요한 모듈만 가져왔다.
 * 웹 레이어는 여기서 공개한 팩토리·타입만 쓴다.
 * 수강신청 등록·희망바구니 담기·이러닝 시청 기록은 호출하지 않는다.
 */
export { EcampusClient, createEcampusClient } from "./ecampus/login.js";
export type { EcampusClientOptions, LoginResult } from "./ecampus/types/login.js";
export type {
  EcampusAssignmentDetail,
  EcampusAssignmentSubmitForm,
  EcampusClassroomItem,
  EcampusClassroomAttachment,
  EcampusDownloadedFile
} from "./ecampus/types/classroom.js";
export {
  parseEcampusAssignmentDetailHtml,
  parseEcampusAssignmentFileLinks,
  parseEcampusAssignmentSendType,
  parseEcampusAssignmentSubmitForm,
  parseEcampusAssignmentSubmittedFiles,
  collectEcampusAssignmentDownloadLinks,
  parseEcampusClassroomAttachmentsHtml
} from "./ecampus/classroom.js";

export { HopeBasketClient, createHopeBasketClient } from "./hope-basket/client.js";
export type { HopeBasketClientOptions } from "./hope-basket/types/basket.js";
export { renderHopeBasketTimetableSvg } from "./hope-basket/timetable.js";

export {
  CourseRegistrationClient,
  createCourseRegistrationClient
} from "./course-registration/client.js";
export type { CourseRegistrationClientOptions } from "./course-registration/types/registration.js";

export { ErpClient, createErpClient } from "./erp/client.js";
export type { ErpClientOptions } from "./erp/types/portal.js";
export type { ErpOverallGrades, ErpGradeTermBundle, ErpGradeSubject, ErpGradeTermTotal } from "./erp/types/grades.js";
