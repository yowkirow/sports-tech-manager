// Subscriptions and other recurring expenses (owner request, November 2026). A subscription is a
// `recurring_expense` record with no amount of its own. The Worker records each charge as an
// ordinary expense on its charge day (worker/recurring-expenses.ts): every night just after
// midnight in Manila, and right after a subscription is added. Charges are keyed by subscription
// and day, so each is recorded once, and one the owner deletes stays deleted.

export const RECURRING_EXPENSE = 'recurring_expense';
export const SUBSCRIPTIONS_CATEGORY = 'Software/Subscriptions';
export const SUBSCRIPTION_NAME_MAX = 120;
export const SUBSCRIPTION_AMOUNT_MAX = 1_000_000;
// How far back or ahead a new subscription's first charge may be: at most a year of past charges.
export const FIRST_CHARGE_RANGE_MONTHS = 12;
export const FREQUENCIES = ['monthly', 'yearly'];

const CLUB_SLUG = 'downtown-dinks';
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_CHARGES = 1200;

const pad = value => String(value).padStart(2, '0');
const daysIn = (year, monthIndex) => new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

/** Today in the Philippines (UTC+8 all year), as YYYY-MM-DD. */
export const manilaToday = (now = new Date()) => new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);

export function isCalendarDay(value) {
    const match = typeof value === 'string' ? DAY.exec(value) : null;
    if (!match) return false;
    const [year, month, day] = match.slice(1).map(Number);
    return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= daysIn(year, month - 1);
}

/** The same day `months` later (or earlier), or that month's last day when it is shorter. */
export function addMonths(day, months) {
    const [year, month, date] = day.split('-').map(Number);
    const total = year * 12 + month - 1 + months;
    const targetYear = Math.floor(total / 12);
    const targetMonth = total - targetYear * 12;
    return `${targetYear}-${pad(targetMonth + 1)}-${pad(Math.min(date, daysIn(targetYear, targetMonth)))}`;
}

/** The subscription a `recurring_expense` record holds, or null when it is incomplete. */
export function readSubscription(details) {
    if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
    const { name, amount, subCategory, frequency, startsOn, club = null } = details;
    if (typeof name !== 'string' || !name.trim() || name.length > SUBSCRIPTION_NAME_MAX) return null;
    if (typeof amount !== 'number' || !(amount > 0) || amount > SUBSCRIPTION_AMOUNT_MAX
        || !/^\d+(\.\d{1,2})?$/.test(String(amount))) return null;
    if (typeof subCategory !== 'string' || !subCategory.trim() || subCategory.length > 128) return null;
    if (!FREQUENCIES.includes(frequency) || !isCalendarDay(startsOn) || (club !== null && club !== CLUB_SLUG)) return null;
    return { name, amount, subCategory, frequency, startsOn, club };
}

/** The charge days, in order: the first charge's day each month (or year), or the month's last day when shorter. */
export const chargeDay = (subscription, index) =>
    addMonths(subscription.startsOn, index * (subscription.frequency === 'yearly' ? 12 : 1));

/** Every charge day up to and including `through` (YYYY-MM-DD). */
export function chargeDaysThrough(subscription, through) {
    const days = [];
    for (let index = 0; index < MAX_CHARGES; index++) {
        const day = chargeDay(subscription, index);
        if (day > through) break;
        days.push(day);
    }
    return days;
}

/** The first charge day after `today`. */
export function nextChargeDay(subscription, today) {
    for (let index = 0; index < MAX_CHARGES; index++) {
        const day = chargeDay(subscription, index);
        if (day > today) return day;
    }
    return null;
}

/** What the subscriptions cost in a month, with yearly ones spread over twelve. */
export const monthlyCost = subscriptions => subscriptions
    .reduce((sum, { amount, frequency }) => sum + (frequency === 'yearly' ? amount / 12 : amount), 0);

/** A first charge must be within a year of today, so a typo can't record years of charges. */
export function firstChargeProblem(startsOn, today) {
    if (!isCalendarDay(startsOn)) return 'Choose the day of the first charge.';
    if (startsOn < addMonths(today, -FIRST_CHARGE_RANGE_MONTHS)) return 'The first charge can be at most a year ago.';
    if (startsOn > addMonths(today, FIRST_CHARGE_RANGE_MONTHS)) return 'The first charge can be at most a year from today.';
    return '';
}

export const formatDay = (day, { year = true } = {}) => {
    const [y, m, d] = day.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${year ? `, ${y}` : ''}`;
};

export const formatPeso = amount =>
    `₱${amount.toLocaleString('en-PH', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })}`;

const ordinal = n => {
    const tens = n % 100;
    const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th';
    return `${n}${suffix}`;
};

/** "Monthly on the 3rd", "Yearly on Mar 15", with the shorter-month rule spelled out when it applies. */
export function scheduleText({ frequency, startsOn }) {
    const [, month, day] = startsOn.split('-').map(Number);
    if (frequency === 'yearly') {
        return month === 2 && day === 29 ? 'Yearly on Feb 29 (Feb 28 in other years)' : `Yearly on ${MONTHS[month - 1]} ${day}`;
    }
    return day > 28 ? `Monthly on the ${ordinal(day)} (or the month’s last day)` : `Monthly on the ${ordinal(day)}`;
}

export const isSubscriptionCharge = transaction =>
    transaction?.type === 'expense' && typeof transaction.details?.recurringId === 'string';
