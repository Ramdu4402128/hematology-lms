/** Sample review notes for demos. Must be checked by a hematologist before real use. */
export const DEMO_NOTES = [
  {
    topic: "T2", subtopic: "t2.microcytic", freeAccess: true,
    title: "แนวทางแยกโรค microcytic anemia",
    summary: "เริ่มจาก ferritin แล้วใช้ RBC count, RDW และประวัติครอบครัวช่วยแยก iron deficiency ออกจาก thalassemia trait และ anemia of inflammation",
    body: `## ขั้นแรก: ดู ferritin
- **ferritin ต่ำ** → iron deficiency แล้วต้องหาสาเหตุของการเสียเลือดหรือการดูดซึมผิดปกติเสมอ
- **ferritin ปกติหรือสูง** → คิดถึง thalassemia trait, anemia of inflammation และ sideroblastic anemia

## ลักษณะที่ช่วยแยก
| ลักษณะ | Iron deficiency | Thalassemia trait | Anemia of inflammation |
|---|---|---|---|
| RBC count | ต่ำ | ปกติถึงสูง | ต่ำ |
| RDW | สูง | ปกติหรือสูงเล็กน้อย | ปกติ |
| Ferritin | ต่ำ | ปกติ | ปกติถึงสูง |
| Mentzer index (MCV/RBC) | มากกว่า 13 | น้อยกว่า 13 | ไม่ช่วยแยก |

## ในบริบทประเทศไทย
- HbE และ α-/β-thalassemia trait พบบ่อย ให้ตรวจ **hemoglobin typing** (HPLC หรือ capillary electrophoresis)
- ถ้า hemoglobin typing ปกติ ยัง **ตัด α-thalassemia trait ไม่ได้** ต้องตรวจ DNA
- Mentzer index เป็นเครื่องมือคัดกรอง ไม่ใช่การวินิจฉัย
- ผู้ป่วยอาจมี iron deficiency ร่วมกับ thalassemia trait ได้ ซึ่งอาจทำให้ HbA2 ต่ำลวง`,
    refs: "[ผู้เขียนระบุแนวทางเวชปฏิบัติหรือตำราที่ใช้อ้างอิง]",
  },
  {
    topic: "T4", subtopic: "t4.primary-hemostasis", freeAccess: false,
    title: "TTP: สงสัยให้เร็ว รักษาให้ทัน",
    summary: "Microangiopathic hemolytic anemia ร่วมกับเกล็ดเลือดต่ำโดย PT/aPTT ปกติ ต้องนึกถึง TTP และเริ่ม plasma exchange โดยไม่รอผล ADAMTS13",
    body: `## เมื่อไรต้องนึกถึง
- **MAHA** (schistocytes, LDH สูง, haptoglobin ต่ำ, DAT ลบ) ร่วมกับ **เกล็ดเลือดต่ำ**
- อาจมีอาการทางสมอง ไตทำงานลดลงเล็กน้อย หรือไข้ แต่ **pentad ครบพบไม่บ่อย** อย่ารอให้ครบ
- PT/aPTT และ fibrinogen มักปกติ ช่วยแยกจาก DIC
- PLASMIC score ช่วยประเมินโอกาสของ ADAMTS13 ต่ำรุนแรง

## สิ่งที่ต้องทำ
1. ส่ง **ADAMTS13 activity และ inhibitor ก่อน** เริ่มให้พลาสมา
2. เริ่ม **therapeutic plasma exchange** โดยเร็ว ไม่ต้องรอผล
3. ให้ corticosteroid ร่วม และพิจารณา rituximab หรือ caplacizumab ตามแนวทางของ immune TTP
4. **หลีกเลี่ยงการให้เกล็ดเลือด** เว้นแต่มีเลือดออกรุนแรงที่คุกคามชีวิต

## โรคที่ต้องแยก
| โรค | จุดที่ช่วยแยก |
|---|---|
| DIC | PT/aPTT ยาว fibrinogen ต่ำ |
| HUS | ไตวายเด่น ประวัติท้องเสียจาก STEC |
| HELLP | ตั้งครรภ์ ค่าตับสูง |
| Malignant hypertension | ความดันสูงมาก |`,
    refs: "[ผู้เขียนระบุแนวทางเวชปฏิบัติหรือตำราที่ใช้อ้างอิง]",
  },
  {
    topic: "T5", subtopic: "t5.transfusion", freeAccess: false,
    title: "ABO compatibility: เม็ดเลือดแดงกับพลาสมาคิดกลับด้านกัน",
    summary: "เม็ดเลือดแดงดูแอนติเจนของผู้ให้เทียบกับแอนติบอดีของผู้รับ ส่วนพลาสมาดูแอนติบอดีของผู้ให้เทียบกับแอนติเจนของผู้รับ",
    body: `## หลักคิด
- **Red cells:** แอนติบอดีในพลาสมาของ *ผู้รับ* ต้องไม่ทำลายแอนติเจนบนเม็ดเลือดแดงของ *ผู้ให้* → หมู่ O เป็น universal donor
- **Plasma:** แอนติบอดีในพลาสมาของ *ผู้ให้* ต้องไม่ทำลายเม็ดเลือดแดงของ *ผู้รับ* → หมู่ AB เป็น universal donor ของพลาสมา

## ตารางจำ
| หมู่เลือดผู้ป่วย | Red cells ที่ให้ได้ | Plasma ที่ให้ได้ |
|---|---|---|
| O | O | O, A, B, AB |
| A | A, O | A, AB |
| B | B, O | B, AB |
| AB | AB, A, B, O | AB |

## เมื่อสงสัย acute hemolytic transfusion reaction
1. **หยุดให้เลือดทันที** เปิดเส้นด้วย normal saline
2. ตรวจสอบตัวผู้ป่วยและถุงเลือดซ้ำ ส่งถุงเลือดและตัวอย่างเลือดผู้ป่วยกลับธนาคารเลือด
3. ส่ง DAT, hemolysis markers, coagulation และติดตามปัสสาวะและการทำงานของไต`,
    refs: "[ผู้เขียนระบุแนวทางเวชปฏิบัติหรือตำราที่ใช้อ้างอิง]",
  },
];
