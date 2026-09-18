-- W2 — agent-uploads Storage bucket: private, never public, modeled on the existing
-- filing-packages bucket (same public=false shape, service-role/signed-URL access
-- only). Path convention: {tenant_id}/{proposal_id}/{n}.jpg. 90-day retention per
-- _ai/nexflow-agent.md §6.9 (no automated sweep built in this session -- not one of
-- the five listed build items; note as a follow-up).
--
-- Unlike filing-packages (no size/type restriction at the bucket level),
-- agent-uploads sets file_size_limit and allowed_mime_types as a server-side
-- backstop matching §6.9's client-side 5MB-post-compression / JPEG-PNG-WebP rules --
-- defense in depth, not a replacement for the client-side check.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agent-uploads', 'agent-uploads', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- No public SELECT policy, deliberately -- service role (agent-query, via
-- SB_SECRET_KEY) is the only writer and reader. No RLS policy grants
-- anon/authenticated access to this bucket's objects.
