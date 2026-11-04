-- Membership (self sign-up, entitlements, redeem codes), review content with certification,
-- and a spaced-repetition review notebook. Practice questions stay free for everyone.

-- New role: content certifier (ผู้รับรองเนื้อหา) — the only role that can publish review notes.
ALTER TABLE user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_role_check
  CHECK (role IN ('learner','advisor','faculty','content_reviewer','school_admin'));

-- Self sign-up profile and consent
ALTER TABLE users
  ADD COLUMN self_registered     boolean NOT NULL DEFAULT false,
  ADD COLUMN learner_level       text,
  ADD COLUMN institution_name    text,
  ADD COLUMN study_goal          text,
  ADD COLUMN terms_accepted_at   timestamptz,
  ADD COLUMN terms_version       text,
  ADD COLUMN marketing_opt_in    boolean NOT NULL DEFAULT false;

-- Access comes from grants, never a single flag on the user: purchase, trial, redeem code,
-- institution licence or a manual grant can all give Plus, each with its own window.
CREATE TABLE entitlement_grants (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan       text NOT NULL CHECK (plan IN ('plus')),
  source     text NOT NULL CHECK (source IN ('purchase','trial','redeem','institution','admin')),
  starts_at  timestamptz NOT NULL DEFAULT now(),
  ends_at    timestamptz,                 -- NULL = no end date
  revoked_at timestamptz,
  ref        text NOT NULL DEFAULT '',    -- order id, code, cohort id, note
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlement_grants_user ON entitlement_grants (user_id, ends_at);

CREATE TABLE redeem_codes (
  code          text PRIMARY KEY,           -- stored upper-case
  plan          text NOT NULL DEFAULT 'plus' CHECK (plan IN ('plus')),
  duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 3650),
  max_uses      integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count    integer NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  campaign      text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  disabled      boolean NOT NULL DEFAULT false
);

CREATE TABLE redemptions (
  code        text NOT NULL REFERENCES redeem_codes(code) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grant_id    bigint REFERENCES entitlement_grants(id) ON DELETE SET NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, user_id)
);

-- Review notes (สรุปเนื้อหา) per subtopic. Published only after a content certifier signs off.
CREATE SEQUENCE note_number_seq START 1;

CREATE TABLE review_notes (
  id            text PRIMARY KEY,            -- NOTE-0001
  topic         text NOT NULL REFERENCES topics(code),
  subtopic      text NOT NULL REFERENCES subtopics(code),
  title         text NOT NULL DEFAULT '',
  summary       text NOT NULL DEFAULT '',    -- shown to everyone, also as the locked preview
  body          text NOT NULL DEFAULT '',    -- markdown subset
  refs          text NOT NULL DEFAULT '',
  free_access   boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','published','retired')),
  version       integer NOT NULL DEFAULT 1,
  author_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  certified_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  certified_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_notes_status ON review_notes (status, topic);

CREATE TABLE note_reviews (
  id          bigserial PRIMARY KEY,
  note_id     text NOT NULL REFERENCES review_notes(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decision    text NOT NULL CHECK (decision IN ('certify','revise')),
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Spaced-repetition notebook (สมุดทบทวน). Kept for everyone so upgrading reveals the backlog;
-- scheduling and the due-queue are a Plus feature.
CREATE TABLE review_cards (
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id          text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  state            text NOT NULL CHECK (state IN ('to_review','recall_check','mastered')),
  due_at           timestamptz NOT NULL,
  lapses           integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz,
  PRIMARY KEY (user_id, item_id)
);
CREATE INDEX review_cards_due ON review_cards (user_id, state, due_at);

INSERT INTO settings (key, value) VALUES
  ('membership', '{"registrationOpen":true,"trialDays":7}'::jsonb),
  ('disclaimer', '{"version":"2026-11","text":"เนื้อหาในระบบนี้จัดทำเพื่อการศึกษาและทบทวนความรู้เท่านั้น ไม่ใช่คำแนะนำทางการแพทย์สำหรับผู้ป่วยรายใด และไม่ใช้แทนการตัดสินใจทางคลินิก แนวทางเวชปฏิบัติ หรือเอกสารกำกับยา ผู้ใช้ต้องตรวจสอบกับแหล่งอ้างอิงที่เป็นปัจจุบันก่อนนำไปใช้ เนื้อหาผ่านการรับรองโดยอาจารย์ผู้เชี่ยวชาญ ณ วันที่ระบุ และอาจปรับปรุงตามหลักฐานใหม่"}'::jsonb)
ON CONFLICT (key) DO NOTHING;
