// js/movement-purpose.js — Step 2J
// Single source of truth for the 10 movement purpose values and their
// stock-effect flags. Consumed by dispatch.html and rm-dispatch.html
// for the purpose selector. 2K (s.143 clock) and any future consumer
// reads ownershipChanges/custodyChanges from here — never re-derive.
// kpml-network-plan.md §8.2 rule 3.

const MOVEMENT_PURPOSES = [
    { value: 'sale',                         label_en: 'Sale',                          label_mr: 'विक्री',                       ownershipChanges: true,  custodyChanges: true }, // default — every existing row reads as this
    { value: 'job_work_issue',               label_en: 'Job Work Issue',                label_mr: 'जॉब वर्क इश्यू',                 ownershipChanges: false, custodyChanges: true }, // principal → job worker, starts s.143 clock
    { value: 'job_work_return',              label_en: 'Job Work Return',               label_mr: 'जॉब वर्क रिटर्न',                ownershipChanges: false, custodyChanges: true }, // processed goods back to principal
    { value: 'unused_material_return',       label_en: 'Unused Material Return',        label_mr: 'न वापरलेला माल परत',            ownershipChanges: false, custodyChanges: true }, // unconsumed free-issue back, no processing, no job charge
    { value: 'scrap_return',                 label_en: 'Scrap Return',                  label_mr: 'स्क्रॅप रिटर्न',                 ownershipChanges: false, custodyChanges: true }, // declared waste back to principal
    { value: 'rework_return',                label_en: 'Rework Return',                 label_mr: 'रिवर्क रिटर्न',                  ownershipChanges: false, custodyChanges: true }, // principal → job worker, rejected goods
    { value: 'rework_dispatch',              label_en: 'Rework Dispatch',               label_mr: 'रिवर्क डिस्पॅच',                 ownershipChanges: false, custodyChanges: true }, // job worker → principal, after repair
    { value: 'capital_goods_issue',          label_en: 'Capital Goods Issue',           label_mr: 'कॅपिटल गुड्स इश्यू',             ownershipChanges: false, custodyChanges: true }, // tooling — 3yr clock, or none for exempt classes
    { value: 'inter_jobworker_transfer',     label_en: 'Inter-Jobworker Transfer',      label_mr: 'जॉब वर्कर दरम्यान ट्रान्सफर',     ownershipChanges: false, custodyChanges: true }, // job worker → another job worker, ITC-04 Table 5B
    { value: 'direct_supply_from_jobworker', label_en: 'Direct Supply From Job Worker', label_mr: 'जॉब वर्करकडून थेट पुरवठा',       ownershipChanges: true,  custodyChanges: true }  // s.143(1)(b) — closes clock without physical return
];

function getMovementPurpose(value) {
    return MOVEMENT_PURPOSES.find(p => p.value === value) || MOVEMENT_PURPOSES[0]; // unknown/missing = 'sale'
}
