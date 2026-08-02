UPDATE sessions
SET model = 'anthropic/' || model
WHERE model LIKE 'claude-%';
