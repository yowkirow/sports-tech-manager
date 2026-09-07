import assert from 'node:assert/strict';
import test from 'node:test';
import { withLocalDate } from '../src/lib/transactionDate.js';

test('selects February correctly from the 31st without changing the time or input date', () => {
    const current = new Date(2026, 0, 31, 14, 35, 42, 123);
    const result = withLocalDate('2026-02-10', current);
    assert.deepEqual(
        [result.getFullYear(), result.getMonth(), result.getDate(), result.getHours(), result.getMinutes(), result.getSeconds(), result.getMilliseconds()],
        [2026, 1, 10, 14, 35, 42, 123]
    );
    assert.equal(current.getDate(), 31);
});

test('handles leap days and year boundaries', () => {
    assert.equal(withLocalDate('2024-02-29', new Date(2026, 11, 31)).getDate(), 29);
    const result = withLocalDate('2027-01-01', new Date(2026, 11, 31));
    assert.deepEqual([result.getFullYear(), result.getMonth(), result.getDate()], [2027, 0, 1]);
});

test('rejects missing or invalid calendar dates', () => {
    for (const value of ['', 'not-a-date', '2026-02-30', '2026-13-01', '2026-01-00']) {
        assert.throws(() => withLocalDate(value), RangeError);
    }
});
