const DEFAULT_RUSH_FEE_PER_SHIRT = 100;

const money = cents => cents / 100;
const detailsOf = value => (value && typeof value === 'object' && value.details && typeof value.details === 'object' ? value.details : value);
const describe = value => {
    const source = detailsOf(value) || {};
    return source.name || source.itemName || source.id || value?.id || 'Item';
};

const toFiniteNumber = (value, label) => {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number.`);
    return number;
};

const toMoneyCents = (value, label, { allowNegative = false } = {}) => {
    const cents = Math.round(toFiniteNumber(value, label) * 100);
    if (!allowNegative && cents < 0) throw new Error(`${label} must be non-negative.`);
    return cents;
};

const toPositiveQuantity = (value, label) => {
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
        throw new Error(`${label} must be a positive safe integer.`);
    }
    return quantity;
};

const optionalMoneyCents = (value, label, fallback = 0, options) => (
    value === undefined || value === null || value === '' ? fallback : toMoneyCents(value, label, options)
);

const isShirtCategory = (category) => {
    const normalized = String(category || '').trim().toLowerCase();
    return !normalized || normalized === 'shirts' || normalized === 'blanks';
};

const getItemName = (product) => {
    const source = detailsOf(product) || {};
    return String(source.name || source.itemName || product?.name || product?.itemName || product?.description || '').trim();
};

export const isBallProduct = (product = {}) => {
    const source = detailsOf(product) || {};
    const category = String(source.category || product?.category || '').trim().toLowerCase();
    return category === 'balls' || getItemName(product).toLowerCase().includes('ball');
};

export const getBallUnitPrice = (quantity) => {
    const qty = toPositiveQuantity(quantity, 'Ball quantity');
    if (qty >= 100) return 70;
    if (qty >= 50) return 80;
    if (qty >= 21) return 90;
    return 100;
};

const getStoredUnitPriceCents = (item) => {
    const source = detailsOf(item) || {};
    return toMoneyCents(source.unitPrice ?? source.price ?? item?.unitPrice ?? item?.price, `${describe(item)} unit price`);
};

const getUnitPriceCents = (item, quantity) => (
    isBallProduct(item) && !item?.preserveUnitPrice
        ? toMoneyCents(getBallUnitPrice(quantity), `${describe(item)} unit price`)
        : getStoredUnitPriceCents(item)
);

export const getCartUnitPrice = (item, quantity = item?.quantity) => money(getUnitPriceCents(item, toPositiveQuantity(quantity, `${describe(item)} quantity`)));

const allocateCents = (totalCents, weights) => {
    if (!weights.length || totalCents <= 0) return weights.map(() => 0);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const exact = weights.map(weight => totalCents * (totalWeight > 0 ? weight / totalWeight : 1 / weights.length));
    const cents = exact.map(Math.floor);
    const remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
    exact
        .map((share, index) => ({ index, fraction: share - cents[index] }))
        .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
        .slice(0, remainder)
        .forEach(({ index }) => { cents[index] += 1; });
    return cents;
};

const normalizeDiscount = (discount, subtotalCents) => {
    if (discount == null) return { discount: null, discountCents: 0 };
    if (!discount || typeof discount !== 'object') throw new Error('Discount must be an object.');
    const type = String(discount.type || '').trim().toLowerCase();
    if (type === 'percent') {
        const value = toFiniteNumber(discount.value, 'Discount percent');
        if (value < 0 || value > 100) throw new Error('Discount percent must be between 0 and 100.');
        return { discount: { type, value }, discountCents: Math.round(subtotalCents * value / 100) };
    }
    if (type === 'fixed') {
        const cents = Math.min(subtotalCents, toMoneyCents(discount.value, 'Discount amount'));
        return { discount: { type, value: money(cents) }, discountCents: cents };
    }
    throw new Error('Discount type must be "percent" or "fixed".');
};

const normalizeOptions = (options = {}) => ({
    discount: options.discount ?? null,
    shippingFeeCents: optionalMoneyCents(options.shippingFee, 'Shipping fee'),
    isRushOrder: Boolean(options.isRushOrder),
    rushFeePerShirtCents: optionalMoneyCents(options.rushFeePerShirt ?? DEFAULT_RUSH_FEE_PER_SHIRT, 'Rush fee per shirt'),
    shippingLineId: options.shippingLineId
});

const getShippingLineId = (rows, shippingFeeCents, preferredId) => {
    if (!rows.length || shippingFeeCents <= 0) return preferredId;
    if (preferredId !== undefined && rows.some(row => row.id === preferredId)) return preferredId;
    const shared = rows.find(row => optionalMoneyCents(detailsOf(row)?.shippingShare, `${describe(row)} shipping share`) > 0);
    if (shared) return shared.id;
    const inferred = rows.find(row => {
        if (row.amountCents === null) return false;
        const details = detailsOf(row) || {};
        const baseline = optionalMoneyCents(details.originalAmount, `${describe(row)} original amount`)
            - optionalMoneyCents(details.discountShare, `${describe(row)} discount share`)
            + optionalMoneyCents(details.shippingDetails?.rushFee, `${describe(row)} rush fee`);
        return Math.abs(row.amountCents - baseline - shippingFeeCents) <= 1;
    });
    return inferred?.id ?? rows[0].id;
};

export const priceOrder = (items, options = {}) => {
    if (!Array.isArray(items)) throw new Error('Items must be an array.');
    if (!items.length) {
        return { items: [], subtotal: 0, discountAmount: 0, shippingFee: 0, rushFeeAmount: 0, total: 0 };
    }

    const normalizedOptions = normalizeOptions(options);
    const priced = items.map(item => {
        const quantity = toPositiveQuantity(item?.quantity, `${describe(item)} quantity`);
        const unitPriceCents = getUnitPriceCents(item, quantity);
        return {
            item,
            quantity,
            unitPriceCents,
            originalAmountCents: item.preserveOriginalAmount
                ? toMoneyCents(item.originalAmount, `${describe(item)} original amount`)
                : unitPriceCents * quantity,
            priceAdjustmentCents: optionalMoneyCents(item?.priceAdjustment, `${describe(item)} price adjustment`, 0, { allowNegative: true })
        };
    });

    const subtotalCents = priced.reduce((sum, item) => sum + item.originalAmountCents, 0);
    const { discountCents } = normalizeDiscount(normalizedOptions.discount, subtotalCents);
    const discountShares = allocateCents(discountCents, priced.map(item => item.originalAmountCents));
    const shippingLineId = normalizedOptions.shippingFeeCents <= 0
        ? normalizedOptions.shippingLineId
        : priced.some(({ item }) => item.id === normalizedOptions.shippingLineId)
            ? normalizedOptions.shippingLineId
            : priced[0].item.id;

    let rushFeeAmountCents = 0;
    let totalCents = 0;
    const resultItems = priced.map((entry, index) => {
        const category = entry.item?.category ?? detailsOf(entry.item)?.category;
        const rushFeeCents = normalizedOptions.isRushOrder && !isBallProduct(entry.item) && isShirtCategory(category)
            ? normalizedOptions.rushFeePerShirtCents * entry.quantity
            : 0;
        const shippingShareCents = normalizedOptions.shippingFeeCents > 0 && entry.item.id === shippingLineId ? normalizedOptions.shippingFeeCents : 0;
        const amountCents = entry.originalAmountCents - discountShares[index] + rushFeeCents + shippingShareCents + entry.priceAdjustmentCents;
        if (amountCents < 0) throw new Error(`${describe(entry.item)} amount cannot be negative.`);
        rushFeeAmountCents += rushFeeCents;
        totalCents += amountCents;
        return {
            ...entry.item,
            quantity: entry.quantity,
            unitPrice: money(entry.unitPriceCents),
            originalAmount: money(entry.originalAmountCents),
            discountShare: money(discountShares[index]),
            rushFee: money(rushFeeCents),
            shippingShare: money(shippingShareCents),
            amount: money(amountCents)
        };
    });

    return {
        items: resultItems,
        subtotal: money(subtotalCents),
        discountAmount: money(discountCents),
        shippingFee: money(normalizedOptions.shippingFeeCents),
        rushFeeAmount: money(rushFeeAmountCents),
        total: money(totalCents)
    };
};

const normalizePersistedDiscount = (discount) => {
    if (discount == null) return null;
    if (!discount || typeof discount !== 'object') throw new Error('Saved discount must be an object.');
    const type = String(discount.type || '').trim().toLowerCase();
    if (type === 'percent') {
        const value = toFiniteNumber(discount.value, 'Saved discount percent');
        if (value < 0 || value > 100) throw new Error('Saved discount percent must be between 0 and 100.');
        return { type, value };
    }
    if (type === 'fixed') return { type, value: money(toMoneyCents(discount.value, 'Saved discount amount')) };
    throw new Error('Saved discount type must be "percent" or "fixed".');
};

export const getOrderPricingOptions = (rows) => {
    if (!Array.isArray(rows)) throw new Error('Rows must be an array.');
    if (!rows.length) {
        return { discount: null, shippingFee: 0, isRushOrder: false, rushFeePerShirt: DEFAULT_RUSH_FEE_PER_SHIRT, shippingLineId: undefined };
    }

    const normalizedRows = rows.map((row, index) => {
        const details = detailsOf(row) || {};
        return {
            id: row?.id ?? details.id ?? `row-${index}`,
            details,
            amountCents: row?.amount === undefined || row?.amount === null || row?.amount === '' ? null : toMoneyCents(row.amount, `${describe(row)} amount`, { allowNegative: true })
        };
    });

    const snapshot = normalizedRows.map(row => row.details.pricing).find(pricing => Number(pricing?.version) === 1);
    if (snapshot) {
        const shippingFeeCents = optionalMoneyCents(snapshot.shippingFee, 'Saved shipping fee');
        return {
            discount: normalizePersistedDiscount(snapshot.discount),
            shippingFee: money(shippingFeeCents),
            isRushOrder: Boolean(snapshot.isRushOrder),
            rushFeePerShirt: money(optionalMoneyCents(snapshot.rushFeePerShirt ?? DEFAULT_RUSH_FEE_PER_SHIRT, 'Saved rush fee per shirt')),
            shippingLineId: getShippingLineId(normalizedRows, shippingFeeCents, snapshot.shippingLineId)
        };
    }

    const discountCents = normalizedRows.reduce((sum, row) => sum + optionalMoneyCents(row.details.discountShare, `${describe(row)} discount share`), 0);
    const shippingFeeCents = normalizedRows.reduce((max, row) => Math.max(max, optionalMoneyCents(row.details.shippingDetails?.shippingFee, `${describe(row)} shipping fee`)), 0);
    const rushFeeTotalCents = normalizedRows.reduce((sum, row) => sum + optionalMoneyCents(row.details.shippingDetails?.rushFee, `${describe(row)} rush fee`), 0);
    const rushableQty = normalizedRows.reduce((sum, row) => (
        !isBallProduct(row.details) && isShirtCategory(row.details.category)
            ? sum + (Number.isSafeInteger(Number(row.details.quantity)) && Number(row.details.quantity) > 0 ? Number(row.details.quantity) : 0)
            : sum
    ), 0);

    return {
        discount: discountCents > 0 ? { type: 'fixed', value: money(discountCents) } : null,
        legacyDiscount: discountCents > 0,
        shippingFee: money(shippingFeeCents),
        isRushOrder: normalizedRows.some(row => row.details.shippingDetails?.isRushOrder || row.details.isRushOrder || row.details.legacyIsRushOrder || row.details.legacyisRushOrder)
            || rushFeeTotalCents > 0,
        rushFeePerShirt: money(rushFeeTotalCents > 0 && rushableQty > 0 ? Math.round(rushFeeTotalCents / rushableQty) : DEFAULT_RUSH_FEE_PER_SHIRT * 100),
        shippingLineId: getShippingLineId(normalizedRows, shippingFeeCents)
    };
};
