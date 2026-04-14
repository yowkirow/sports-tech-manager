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
    let data = await fetchWithCache('all-provinces', `${PSGC_API}/provinces/`);
    
    // Add special independent cities that are not under any province in the API
    const specialCities = [
        { code: '129804000', name: 'Cotabato City (Special)', regionCode: '120000000' },
        { code: '099701000', name: 'Isabela City (Special)', regionCode: '090000000' }
    ];
    
    specialCities.forEach(city => {
        if (!data.some(p => p.code === city.code)) {
            data.push(city);
        }
    });
    
    data.sort((a, b) => a.name.localeCompare(b.name));
    return data;
};

export const getCitiesByProvince = async (provinceCode) => {
    // Handle our special injected cities
    if (provinceCode === '129804000') {
        return [{ code: '129804000', name: 'City of Cotabato' }];
    }
    if (provinceCode === '099701000') {
        return [{ code: '099701000', name: 'City of Isabela' }];
    }

    return fetchWithCache(`cities-${provinceCode}`, `${PSGC_API}/provinces/${provinceCode}/cities-municipalities/`);
};

export const getBarangays = async (cityCode) => {
    return fetchWithCache(`barangays-${cityCode}`, `${PSGC_API}/cities-municipalities/${cityCode}/barangays/`);
};
