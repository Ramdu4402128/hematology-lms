export interface Topic { code: string; name: string; subs: [string, string][] }

export const TOPICS: Topic[] = [
  { code: "T1", name: "Foundations & Physiology", subs: [["t1.hematopoiesis", "Hematopoiesis & Bone Marrow Architecture"], ["t1.lab-methods", "Diagnostic Laboratory Methods"]] },
  { code: "T2", name: "RBC Disorders & Anemias", subs: [["t2.anemia-approach", "Approach to Anemia"], ["t2.microcytic", "Microcytic Anemias"], ["t2.macrocytic", "Macrocytic Anemias"], ["t2.hemolytic.intrinsic", "Hemolytic › Intrinsic/Congenital"], ["t2.hemolytic.extrinsic", "Hemolytic › Extrinsic/Acquired"], ["t2.marrow-failure", "Bone Marrow Failure Syndromes"], ["t2.polycythemia", "Polycythemias"]] },
  { code: "T3", name: "WBC & Malignant Disorders", subs: [["t3.leukocyte-nonmalignant", "Non-Malignant Leukocyte Disorders"], ["t3.acute-leukemia", "Acute Leukemias"], ["t3.mpn", "Myeloproliferative Neoplasms"], ["t3.mds", "Myelodysplastic Syndromes"], ["t3.lpd-plasma-cell", "Lymphoproliferative & Plasma Cell"]] },
  { code: "T4", name: "Hemostasis & Thrombosis", subs: [["t4.primary-hemostasis", "Primary Hemostasis & Platelet Disorders"], ["t4.coagulation", "Secondary Hemostasis & Coagulation"], ["t4.thrombosis", "Thromboembolism & Hypercoagulability"]] },
  { code: "T5", name: "Transfusion Medicine", subs: [["t5.transfusion", "Transfusion Medicine"]] },
  { code: "T6", name: "BMT & Cellular Therapy", subs: [["t6.hsct-indications", "HSCT Indications & Donor Selection"], ["t6.hsct-process", "Collection, Conditioning & Engraftment"], ["t6.gvhd", "Graft-versus-Host Disease"], ["t6.complications", "Transplant Complications & Survivorship"], ["t6.cellular-therapy", "Cellular Therapy"]] },
];

export const SUBNAME: Record<string, string> = Object.fromEntries(TOPICS.flatMap((t) => t.subs));
export const SUB_TOPIC: Record<string, string> = Object.fromEntries(TOPICS.flatMap((t) => t.subs.map(([c]) => [c, t.code])));
export const LEVELS = ["Preclinical", "Clinical", "Intern", "Resident", "Fellow"] as const;
export type Level = (typeof LEVELS)[number];
export const KEYS = ["A", "B", "C", "D", "E"] as const;
export const RUBRIC = [
  "เนื้อหาถูกต้องตามแนวทางปัจจุบัน",
  "มีคำตอบที่ดีที่สุดเพียงข้อเดียว",
  "ตัวลวงสมเหตุสมผลและเป็นเรื่องเดียวกัน",
  "ไม่มี cue จากไวยากรณ์หรือความยาวตัวเลือก",
  "ความยากเหมาะกับระดับผู้เรียนที่แท็ก",
  "แท็กหัวข้อถูกต้อง",
  "เอกสารอ้างอิงเป็นปัจจุบัน",
];
export const ROLES = ["learner", "advisor", "faculty", "school_admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = {
  learner: "ผู้เรียน",
  advisor: "อาจารย์ผู้ดูแล",
  faculty: "อาจารย์รายวิชา",
  school_admin: "โรงเรียนแพทย์",
};
export const STATUS_LABEL: Record<string, string> = { draft: "Draft", review: "รอรีวิว", approved: "Approved", retired: "Retired" };
export const REPORT_REASONS: Record<string, string> = {
  wrong_key: "เฉลยอาจผิด",
  ambiguous: "โจทย์กำกวม / มีคำตอบได้มากกว่าหนึ่งข้อ",
  outdated: "เนื้อหาไม่เป็นปัจจุบัน",
  typo: "พิมพ์ผิด / ค่าแล็บผิด",
  other: "อื่น ๆ",
};
