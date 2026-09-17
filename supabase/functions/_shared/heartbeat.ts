// Shared module: recordHeartbeat() — the one-line call a cron-triggered Edge
// Function makes at the end of a successful run so ops-digest (A3) can detect
// a cron that silently stopped firing. Deno-to-Deno import, same convention
// as _shared/ops.ts (this is not the browser<->Deno boundary CLAUDE.md says
// has no shared module system).
//
// Deliberately separate from opsAlert(): a heartbeat fires on every success,
// not on failure/anomaly, and needs no dedupe, no Telegram send, no severity —
// forcing it through opsAlert's dedupe-and-alert machinery would mean either
// spamming a row per successful run or awkwardly repurposing "most recent
// p2_ops_alerts row for this source" as a liveness proxy, which breaks the
// moment a job succeeds without writing an alert (the common case for most
// crons in this codebase). A plain upsert on job_name is what this actually is.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_SECRET_KEY') ?? ''
)

export type HeartbeatStatus = 'ok' | 'error'

// Never throws — same posture as opsAlert(). A heartbeat write failing must
// never fail the cron run it's reporting on.
export async function recordHeartbeat(
  jobName: string,
  status: HeartbeatStatus,
  errorReason?: string
): Promise<void> {
  try {
    const now = new Date().toISOString()
    const fields: Record<string, unknown> = {
      job_name: jobName,
      last_attempt_at: now,
      last_status: status,
      last_error: status === 'error' ? (errorReason ?? null) : null,
    }
    if (status === 'ok') {
      fields.last_success_at = now
    }
    const { error } = await supabase
      .from('p2_cron_heartbeat')
      .upsert(fields, { onConflict: 'job_name' })
    if (error) console.error('recordHeartbeat: upsert failed', jobName, error)
  } catch (err) {
    console.error('recordHeartbeat: unexpected error', jobName, err)
  }
}
