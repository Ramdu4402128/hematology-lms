-- Hematology LMS — initial schema
-- Applied automatically by Netlify on deploy (before publish). Never edit after it has been applied;
-- add a new, later-timestamped migration instead.

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  display_name        text NOT NULL,
  password_hash       text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  active              boolean NOT NULL DEFAULT true,
  leaderboard_opt_in  boolean NOT NULL DEFAULT false,
  leaderboard_alias   text,
  failed_logins       integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  session_version     integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    text NOT NULL CHECK (role IN ('learner','advisor','faculty','school_admin')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE cohorts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  program    text NOT NULL DEFAULT '',
  starts_on  date,
  ends_on    date,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cohort_members (
  cohort_id uuid NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track     text NOT NULL DEFAULT '',
  PRIMARY KEY (cohort_id, user_id)
);
CREATE INDEX cohort_members_user ON cohort_members (user_id);

CREATE TABLE advisor_assignments (
  advisor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (advisor_id, learner_id),
  CHECK (advisor_id <> learner_id)
);
CREATE INDEX advisor_assignments_learner ON advisor_assignments (learner_id);

CREATE TABLE topics (
  code text PRIMARY KEY,
  name text NOT NULL,
  sort integer NOT NULL
);

CREATE TABLE subtopics (
  code       text PRIMARY KEY,
  topic_code text NOT NULL REFERENCES topics(code),
  name       text NOT NULL,
  sort       integer NOT NULL
);

INSERT INTO topics (code, name, sort) VALUES
  ('T1', 'Foundations & Physiology', 1),
  ('T2', 'RBC Disorders & Anemias', 2),
  ('T3', 'WBC & Malignant Disorders', 3),
  ('T4', 'Hemostasis & Thrombosis', 4),
  ('T5', 'Transfusion Medicine', 5),
  ('T6', 'BMT & Cellular Therapy', 6);

INSERT INTO subtopics (code, topic_code, name, sort) VALUES
  ('t1.hematopoiesis', 'T1', 'Hematopoiesis & Bone Marrow Architecture', 1),
  ('t1.lab-methods', 'T1', 'Diagnostic Laboratory Methods', 2),
  ('t2.anemia-approach', 'T2', 'Approach to Anemia', 1),
  ('t2.microcytic', 'T2', 'Microcytic Anemias', 2),
  ('t2.macrocytic', 'T2', 'Macrocytic Anemias', 3),
  ('t2.hemolytic.intrinsic', 'T2', 'Hemolytic › Intrinsic/Congenital', 4),
  ('t2.hemolytic.extrinsic', 'T2', 'Hemolytic › Extrinsic/Acquired', 5),
  ('t2.marrow-failure', 'T2', 'Bone Marrow Failure Syndromes', 6),
  ('t2.polycythemia', 'T2', 'Polycythemias', 7),
  ('t3.leukocyte-nonmalignant', 'T3', 'Non-Malignant Leukocyte Disorders', 1),
  ('t3.acute-leukemia', 'T3', 'Acute Leukemias', 2),
  ('t3.mpn', 'T3', 'Myeloproliferative Neoplasms', 3),
  ('t3.mds', 'T3', 'Myelodysplastic Syndromes', 4),
  ('t3.lpd-plasma-cell', 'T3', 'Lymphoproliferative & Plasma Cell', 5),
  ('t4.primary-hemostasis', 'T4', 'Primary Hemostasis & Platelet Disorders', 1),
  ('t4.coagulation', 'T4', 'Secondary Hemostasis & Coagulation', 2),
  ('t4.thrombosis', 'T4', 'Thromboembolism & Hypercoagulability', 3),
  ('t5.transfusion', 'T5', 'Transfusion Medicine', 1),
  ('t6.hsct-indications', 'T6', 'HSCT Indications & Donor Selection', 1),
  ('t6.hsct-process', 'T6', 'Collection, Conditioning & Engraftment', 2),
  ('t6.gvhd', 'T6', 'Graft-versus-Host Disease', 3),
  ('t6.complications', 'T6', 'Transplant Complications & Survivorship', 4),
  ('t6.cellular-therapy', 'T6', 'Cellular Therapy', 5);

CREATE SEQUENCE item_number_seq START 1001;

CREATE TABLE items (
  id           text PRIMARY KEY,
  topic        text NOT NULL REFERENCES topics(code),
  subtopic     text NOT NULL REFERENCES subtopics(code),
  level        text NOT NULL CHECK (level IN ('Preclinical','Clinical','Intern','Resident','Fellow')),
  item_type    text NOT NULL DEFAULT 'SBA',
  vignette     text NOT NULL DEFAULT '',
  labs         jsonb NOT NULL DEFAULT '[]'::jsonb,
  lead_in      text NOT NULL DEFAULT '',
  options      jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_key  text NOT NULL DEFAULT '',
  explanation  text NOT NULL DEFAULT '',
  reference    text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','retired')),
  version      integer NOT NULL DEFAULT 1,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  last_edited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz
);
CREATE INDEX items_status_topic ON items (status, topic);

CREATE TABLE item_reviews (
  id          bigserial PRIMARY KEY,
  item_id     text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decision    text NOT NULL CHECK (decision IN ('approve','revise','reject')),
  checks      jsonb NOT NULL DEFAULT '[]'::jsonb,
  comment     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_reviews_item ON item_reviews (item_id, created_at);

CREATE TABLE item_reports (
  id          bigserial PRIMARY KEY,
  item_id     text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason      text NOT NULL CHECK (reason IN ('wrong_key','ambiguous','outdated','typo','other')),
  detail      text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  resolution  text NOT NULL DEFAULT '',
  closed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz
);
CREATE INDEX item_reports_open ON item_reports (status, item_id);

CREATE TABLE attempts (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_version integer NOT NULL,
  choice       text NOT NULL CHECK (choice IN ('A','B','C','D','E')),
  is_correct   boolean NOT NULL,
  time_ms      integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attempts_user_time ON attempts (user_id, created_at DESC);
CREATE INDEX attempts_item ON attempts (item_id);

-- Question served to a learner but not yet answered; lets the server verify the answer
-- belongs to a question it actually handed out, and measure time on question.
CREATE TABLE pending_questions (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  item_id    text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  version    integer NOT NULL,
  served_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE feedback_notes (
  id         bigserial PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  visibility text NOT NULL CHECK (visibility IN ('learner','staff')),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_notes_learner ON feedback_notes (learner_id, created_at DESC);

CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES
  ('thresholds', '{"minAnswersPerTopic":2,"lowMastery":50,"inactiveDays":7}'::jsonb),
  ('school', '{"name":"โรงเรียนแพทย์"}'::jsonb);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  actor_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action    text NOT NULL,
  target    text NOT NULL DEFAULT '',
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at ON audit_log (at DESC);
