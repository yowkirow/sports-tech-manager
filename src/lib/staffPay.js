// Staff pay is an expense too (owner request, November 2026). Recording a payout under Production
// also writes one General expense with the payout's ID, amount and time (worker/production-api.ts;
// migration 0021 for earlier payouts). It stays matched to the append-only payout: the Worker lets
// only its reimbursement status change (worker/business-api.ts).
export const STAFF_PAY_CATEGORY = 'Print staff pay';

export const STAFF_PAY_LOCKED_HINT = 'Staff payouts recorded under Production can’t be edited or deleted.';

export const isStaffPayExpense = (transaction) =>
    transaction?.type === 'expense' && typeof transaction.details?.payoutId === 'string';
