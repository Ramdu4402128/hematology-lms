/**
 * What each plan unlocks. Practice questions are free and unlimited for everyone — the product
 * sold is review content and study tools, never the question bank.
 */
export const FEATURES = {
  "notes.full": "อ่านสรุปเนื้อหาครบทุกหัวข้อ",
  "review.notebook": "สมุดทบทวนแบบนัดรอบ (ข้อที่พลาดวนกลับมาตามเวลา)",
  "analytics.subtopic": "วิเคราะห์ผลละเอียดราย subtopic",
} as const;
export type Feature = keyof typeof FEATURES;

export const FREE_INCLUDES = [
  "ฝึกข้อสอบได้ไม่จำกัดทุก Topic พร้อมเฉลยและเหตุผลทุกตัวเลือก",
  "Mastery ราย Topic และประวัติข้อที่ตอบผิด",
  "สรุปเนื้อหาบางหัวข้อ (ที่ทำเครื่องหมายเปิดฟรี) และบทนำของทุกหัวข้อ",
];

export const PLAN_FEATURES: Record<"free" | "plus", Feature[]> = {
  free: [],
  plus: ["notes.full", "review.notebook", "analytics.subtopic"],
};

export interface Entitlements {
  plan: "free" | "plus";
  features: Feature[];
  /** End of the latest active Plus grant; null when free or open-ended. */
  plusUntil: string | null;
  sources: { source: string; endsAt: string | null }[];
}

/** Notebook intervals (days) after each successful recall. */
export const REVIEW_INTERVALS = { firstRetry: 1, recallCheck: 3 } as const;
