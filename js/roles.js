const ROLE_PERMISSIONS = {
    owner:       ['dashboard','grn','issue','dispatch','rm_dispatch','dispatch_history','products','reports','invoices','scanner','settings','agent','manual'],
    supervisor:  ['dashboard','grn','issue','dispatch','rm_dispatch','dispatch_history','products','reports','invoices','scanner','agent','manual'],
    storekeeper: ['dashboard','grn','scanner','manual'],
    operator:    ['dashboard','issue','dispatch','rm_dispatch','dispatch_history','products','reports','manual'],
    accountant:  ['reports','invoices','manual'],
    staff:       ['dashboard','grn','scanner','manual']   // legacy DB value — same permissions as storekeeper
};

const ROLE_LABELS = {
    owner: 'Owner',
    supervisor: 'Supervisor',
    storekeeper: 'Storekeeper',
    operator: 'Operator',
    accountant: 'Accountant',
    staff: 'Storekeeper'   // legacy DB value, displayed as its modern equivalent
};

function canAccess(role, page) {
    const perms = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.storekeeper; // unknown role = least privilege
    return perms.includes(page);
}

function getRoleLabel(role) {
    return ROLE_LABELS[role] || role;
}
