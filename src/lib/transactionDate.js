export const withLocalDate = (date, baseDate = new Date()) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Select a valid date.');
    const [year, month, day] = date.split('-').map(Number);
    const result = new Date(baseDate);
    // Set all calendar fields together so a current day of 31 cannot overflow February.
    result.setFullYear(year, month - 1, day);
    if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
        throw new RangeError('Select a valid date.');
    }
    return result;
};
