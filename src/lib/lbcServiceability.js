import { LBC_COD_COP_DESTINATIONS } from '../data/lbcCodCopDestinations.js';

const normalize = value => String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, '')
    .toUpperCase()
    .replace(/\bSTO\b/g, 'SANTO')
    .replace(/\bSTA\b/g, 'SANTA')
    .replace(/\bCITY OF\b/g, '')
    .replace(/\bCITY\b/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const destinations = LBC_COD_COP_DESTINATIONS.map(([code, label]) => {
    const separator = label.indexOf(' - ');
    return { code, province: label.slice(0, separator), city: label.slice(separator + 3) };
});
const destinationByCode = new Map(destinations.map(destination => [destination.code, destination]));
const destinationsByCity = new Map();
for (const destination of destinations) {
    const city = normalize(destination.city);
    destinationsByCity.set(city, [...(destinationsByCity.get(city) || []), destination]);
}

function provinceMatches(destination, province, city) {
    const destinationProvince = normalize(destination.province);
    const sourceProvince = normalize(province);
    const normalizedCity = normalize(city);
    if (sourceProvince === destinationProvince) return true;
    if (sourceProvince === 'METRO MANILA' && destinationProvince === 'NATIONAL CAPITAL REGION NCR') return true;
    if (sourceProvince === 'MAGUINDANAO' && destinationProvince === 'MAGUINDANAO DEL NORTE') return true;
    if (normalizedCity === 'COTABATO' && sourceProvince.includes('COTABATO') && destinationProvince === 'MAGUINDANAO DEL NORTE') return true;
    if (normalizedCity === 'ISABELA' && sourceProvince.includes('ISABELA') && destinationProvince === 'BASILAN') return true;
    if (normalizedCity === 'ISABELA' && sourceProvince === 'ZAMBOANGA PENINSULA' && destinationProvince === 'BASILAN') return true;
    return false;
}

export const LBC_UNSERVICEABLE_NOTICE =
    'LBC does not list this city or municipality for delivery from Makati. Please contact SportsTech about delivery options.';

export function getLbcDestinationCode(city, province) {
    if (!city || typeof city.name !== 'string' || !province) return null;
    const psgcCode = String(city.psgc10DigitCode ?? '').replace(/^0+/, '');
    const direct = destinationByCode.get(psgcCode);
    if (direct && normalize(direct.city) === normalize(city.name) && provinceMatches(direct, province, city.name)) {
        return direct.code;
    }

    const cityName = normalize(city.name);
    const matches = (destinationsByCity.get(cityName) || []).filter(destination =>
        normalize(destination.city) === cityName && provinceMatches(destination, province, city.name));
    return matches.length === 1 ? matches[0].code : null;
}

export function isLbcDestinationSupported(code, province, city) {
    if (typeof code !== 'string' || !province || !city) return false;
    const destination = destinationByCode.get(code);
    return !!destination
        && normalize(destination.city) === normalize(city)
        && provinceMatches(destination, province, city);
}

export function lbcDestinationCount() {
    return destinations.length;
}
