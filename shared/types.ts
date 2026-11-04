import type { Role } from "./taxonomy";

export type LabFlag = "ปกติ" | "สูง" | "ต่ำ";
export interface Lab { test: string; value: string; unit: string; range: string; flag: LabFlag }
export interface Option { key: string; text: string; rationale: string }
export type ItemStatus = "draft" | "review" | "approved" | "retired";

export interface ItemInput {
  topic: string;
  subtopic: string;
  level: string;
  vignette: string;
  labs: Lab[];
  leadIn: string;
  options: Option[];
  correctKey: string;
  explanation: string;
  reference: string;
}

export interface Item extends ItemInput {
  id: string;
  status: ItemStatus;
  version: number;
  authorId: string | null;
  authorName?: string | null;
  updatedAt: string;
}

/** What a learner sees before answering — no key, no rationales, no explanation. */
export interface LearnerQuestion {
  id: string;
  version: number;
  topic: string;
  subtopic: string;
  level: string;
  vignette: string;
  labs: Lab[];
  leadIn: string;
  options: { key: string; text: string }[];
}

export interface AnswerResult {
  correct: boolean;
  correctKey: string;
  choice: string;
  options: Option[];
  explanation: string;
  reference: string;
  /** Faculty reviewer who approved this version — shown to learners as the content sign-off. */
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  relatedNote?: { id: string; title: string } | null;
}

export interface TopicMastery { code: string; n: number; c: number; pct: number | null; enough: boolean }

export interface Me {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  mustChangePassword: boolean;
  leaderboardOptIn: boolean;
}

export interface Settings { minAnswersPerTopic: number; lowMastery: number; inactiveDays: number }
export const DEFAULT_SETTINGS: Settings = { minAnswersPerTopic: 2, lowMastery: 50, inactiveDays: 7 };
