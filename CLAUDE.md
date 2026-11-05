# Blood Book (Hematology LMS)

- อ่าน `DESIGN.md` ก่อนแก้ UI ใด ๆ และยึด tokens/ข้อห้ามในนั้น
- Netlify Functions + Netlify Database; migration ใน `netlify/database/migrations` ห้ามแก้ไฟล์ที่ deploy แล้ว ให้เพิ่มไฟล์ใหม่
- รันทดสอบด้วย `npm test` (PGlite) และ `npm run build` ก่อน commit
- เนื้อหาการแพทย์ทุกชิ้นเป็นร่างที่ต้องให้อาจารย์ตรวจ อ้างอิงระดับ guideline (ASH/ISTH/WHO) หรือตำรามาตรฐาน
