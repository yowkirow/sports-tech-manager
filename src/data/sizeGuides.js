/**
 * Size Guide Configuration
 * 
 * To add a new brand:
 * 1. Add a new key to the BRAND_SIZE_GUIDES object (use lowercase brand name).
 * 2. Provide an array of objects with 's' (size), 'c' (chest), and 'h' (height).
 */

export const BRAND_SIZE_GUIDES = {
    'six zero': [
        { s: 'S', c: '18"', h: '25"' },
        { s: 'M', c: '19"', h: '26"' },
        { s: 'L', c: '20"', h: '27"' },
        { s: 'XL', c: '21"', h: '28"' },
        { s: '2XL', c: '22"', h: '29"' },
    ],
    'sypik': [
        { s: 'XS', c: '18"', h: '25"' },
        { s: 'S', c: '19"', h: '26"' },
        { s: 'M', c: '20"', h: '27"' },
        { s: 'L', c: '21"', h: '28"' },
        { s: 'XL', c: '22"', h: '29"' },
        { s: '2XL', c: '23"', h: '30"' },
    ],
    // DEFAULT / GENERIC GUIDE
    'default': [
        { s: 'XS', c: '18.5"', h: '25.5"' },
        { s: 'S', c: '19.5"', h: '26.5"' },
        { s: 'M', c: '20.5"', h: '27.5"' },
        { s: 'L', c: '21.5"', h: '28.5"' },
        { s: 'XL', c: '22.5"', h: '29.5"' },
        { s: '2XL', c: '23.5"', h: '30.5"' },
    ]
};

export const getSizeGuideForBrand = (brandName) => {
    const key = (brandName || '').toLowerCase();
    return BRAND_SIZE_GUIDES[key] || BRAND_SIZE_GUIDES['default'];
};
