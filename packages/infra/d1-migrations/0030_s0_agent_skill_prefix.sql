UPDATE user_agent_skill_preferences
SET skill_id = 'skill_s0_create_pr'
WHERE skill_id = 'skill_c0_create_pr';

UPDATE agent_skills
SET
  id = 'skill_s0_create_pr',
  slug = 's0-create-pr',
  name = 's0-create-pr',
  description = 'Create a GitHub pull request from a SolZero-managed repository. Use when the user asks to open, create, or submit a pull request for the current repository.',
  content_hash = 'builtin:s0-create-pr:v1'
WHERE id = 'skill_c0_create_pr';
