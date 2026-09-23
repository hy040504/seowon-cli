export type AnnouncementType = "general" | "patch" | "urgent";
export type AnnouncementStatus = "draft" | "published" | "hidden";

export interface AnnouncementSummary {
  id: string;
  title: string;
  type: AnnouncementType;
  publishedAt: string | null;
  createdAt: string;
  isRead: boolean;
}

export interface Announcement extends AnnouncementSummary {
  contentHtml: string;
  targetProjects: string[];
  status: AnnouncementStatus;
  authorId: string;
  updatedAt: string;
  expiresAt: string | null;
}

export interface AnnouncementAsset {
  id: string;
  filename: string;
  mime: string;
  size: number;
}
