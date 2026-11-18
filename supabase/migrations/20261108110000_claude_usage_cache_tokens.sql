-- 8 Nov 2026 (worksheet C7, prompt caching for the camera labels): log cache tokens per call.
alter table claude_usage add column if not exists cache_write_tokens integer;
alter table claude_usage add column if not exists cache_read_tokens integer;
