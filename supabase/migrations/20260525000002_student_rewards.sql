-- Student rewards table: tutors award emojis to students after lessons
CREATE TABLE IF NOT EXISTS student_rewards (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id  UUID        REFERENCES lessons(id) ON DELETE SET NULL,
  tutor_id   UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  emoji      TEXT        NOT NULL,
  theme      TEXT        NOT NULL DEFAULT 'fruits',
  earned_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS student_rewards_student_idx
  ON student_rewards(student_id, earned_at DESC);

ALTER TABLE student_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "student_own_rewards_select" ON student_rewards
  FOR SELECT USING (auth.uid() = student_id);

CREATE POLICY "tutor_insert_rewards" ON student_rewards
  FOR INSERT WITH CHECK (auth.uid() = tutor_id);

-- Add reward_theme column to tutor workspace settings
ALTER TABLE tutor_workspace_settings
  ADD COLUMN IF NOT EXISTS reward_theme TEXT DEFAULT 'fruits';
