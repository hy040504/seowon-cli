/** 프로그램 공지 분류: 일반 안내·패치·긴급 공지. */
export type AnnouncementType = "general" | "patch" | "urgent";
/** 공지 공개 상태: 작성 중·게시됨·숨김. */
export type AnnouncementStatus = "draft" | "published" | "hidden";

/** 공지 목록에 표시할 식별자·제목·분류·시각과 읽음 여부. */
export interface AnnouncementSummary {
  id: string; // 공지 식별자
  title: string; // 목록에 표시할 제목
  type: AnnouncementType; // 일반·패치·긴급 분류
  publishedAt: string | null; // 게시 시각. 게시 전이면 null
  createdAt: string; // 생성 시각
  isRead: boolean; // 현재 사용자가 읽었는지 여부
}

/** 공지 본문, 대상 프로젝트, 작성자와 공개·만료 정보를 포함하는 상세. */
export interface Announcement extends AnnouncementSummary {
  contentHtml: string; // HTML 공지 본문
  targetProjects: string[]; // 공지를 표시할 대상 프로젝트 목록
  status: AnnouncementStatus; // 작성·게시·숨김 상태
  authorId: string; // 작성자 식별자
  updatedAt: string; // 마지막 수정 시각
  expiresAt: string | null; // 만료 시각. 만료 설정이 없으면 null
}

/** 공지 첨부 파일의 식별자·파일명·MIME 형식과 바이트 크기. */
export interface AnnouncementAsset {
  id: string; // 첨부 식별자
  filename: string; // 첨부 파일명
  mime: string; // 파일의 MIME 형식
  size: number; // 파일 크기(바이트)
}
