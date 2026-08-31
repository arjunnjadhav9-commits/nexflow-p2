// js/notifications.js — Step 4
// Shared insert + fan-out helpers for p2_notifications. Plain bare-global
// script (no ES modules anywhere in this codebase — same convention as
// js/movement-purpose.js), loaded via <script src="js/notifications.js">
// after js/supabase-client.js on dispatch.html, production-issue.html and
// rm-dispatch.html.
//
// sendNotification() inserts one queued row, then fires the notify Edge
// Function fire-and-forget (no await at the call site) — mirrors the
// check-low-stock-instant call pattern it replaces. Insert errors are
// swallowed silently; notifications must never block the UI.

async function sendNotification(supabase, type, title, body, metadata = {}) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const tenantId = user.user_metadata?.tenant_id || user.id;

        const { data, error } = await supabase
            .from('p2_notifications')
            .insert({ tenant_id: tenantId, type, title, body, metadata, status: 'queued' })
            .select('id')
            .single();

        if (error || !data) return;

        fetch('https://jhqxvpihauvhfclosuxn.supabase.co/functions/v1/notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
            body: JSON.stringify({ notification_id: data.id })
        }).catch(() => {});
    } catch (e) {
        // never block the calling page's confirm flow
    }
}

// Replicates check-low-stock-instant's exact comparison (v_p2_stock_balance,
// current_stock < min_stock_level, min_stock_level not null) — always
// re-queries fresh rather than trusting a page-local materials array, since
// on rm-dispatch.html/production-issue.html that array can be stale
// (pre-deduction) at the point a dispatch/issue confirms.
async function checkAndNotifyLowStock(supabase, materialIds) {
    if (!materialIds || materialIds.length === 0) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const tenantId = user.user_metadata?.tenant_id || user.id;

    const { data: rows, error } = await supabase
        .from('v_p2_stock_balance')
        .select('raw_material_id, name, current_stock, unit, min_stock_level')
        .eq('tenant_id', tenantId)
        .in('raw_material_id', materialIds)
        .not('min_stock_level', 'is', null);

    if (error || !rows) return;

    const lowItems = rows.filter(r => r.current_stock < r.min_stock_level);

    for (const item of lowItems) {
        await sendNotification(
            supabase,
            'low_stock',
            `Low stock: ${item.name}`,
            `${item.name} is at ${item.current_stock} ${item.unit} — below minimum of ${item.min_stock_level} ${item.unit}.`,
            {
                raw_material_id: item.raw_material_id,
                material_name: item.name,
                current_qty: item.current_stock,
                min_stock_level: item.min_stock_level
            }
        );
    }
}
