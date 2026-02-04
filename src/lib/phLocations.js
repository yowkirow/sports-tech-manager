export const PSGC_API = 'https://psgc.gitlab.io/api';

const fetchWithCache = async (key, url) => {
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached);

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('API Error');
        const data = await res.json();
        // Sort alphabetically
        data.sort((a, b) => a.name.localeCompare(b.name));
        sessionStorage.setItem(key, JSON.stringify(data));
        return data;
    } catch (err) {
        console.error(`Failed to fetch ${url}`, err);
        return [];
    }
};

// Region 130000000 is NCR (Metro Manila)
export const getMMCities = async () => {
    return fetchWithCache('mm-cities', `${PSGC_API}/regions/130000000/cities-municipalities/`);
};

export const getAllProvinces = async () => {
    return fetchWithCache('all-provinces', `${PSGC_API}/provinces/`);
};

export const getCitiesByProvince = async (provinceCode) => {
    return fetchWithCache(`cities-${provinceCode}`, `${PSGC_API}/provinces/${provinceCode}/cities-municipalities/`);
};

export const getBarangays = async (cityCode) => {
    return fetchWithCache(`barangays-${cityCode}`, `${PSGC_API}/cities-municipalities/${cityCode}/barangays/`);
};
