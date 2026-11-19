import test from 'node:test';
import assert from 'node:assert/strict';
import { LBC_COD_COP_DESTINATIONS } from '../src/data/lbcCodCopDestinations.js';
import { getLbcDestinationCode, isLbcDestinationSupported, lbcDestinationCount } from '../src/lib/lbcServiceability.js';

test('LBC COD/COP destination snapshot contains unique, well-formed options', () => {
    assert.equal(lbcDestinationCount(), 1600);
    assert.equal(new Set(LBC_COD_COP_DESTINATIONS.map(([code]) => code)).size, LBC_COD_COP_DESTINATIONS.length);
    for (const [code, label] of LBC_COD_COP_DESTINATIONS) {
        assert.match(code, /^\d{9,10}$/);
        assert.match(label, /^[A-Z0-9 .'-]+ - [A-Z0-9 .'-]+$/);
    }
});

test('destination lookup matches LBC IDs and Philippine city-name variations', () => {
    assert.equal(getLbcDestinationCode({ name: 'City of Makati', psgc10DigitCode: '1380300000' }, 'Metro Manila'), '1380300000');
    assert.equal(isLbcDestinationSupported('1380300000', 'Metro Manila', 'Makati'), true);

    assert.equal(getLbcDestinationCode({ name: 'Parang', psgc10DigitCode: '1903811000' }, 'Maguindanao'), '1908709000');
    assert.equal(getLbcDestinationCode({ name: 'City of Cotabato' }, 'Cotabato City (Special)'), '1908703000');
    assert.equal(getLbcDestinationCode({ name: 'Bontoc', psgc10DigitCode: '1404404000' }, 'Mountain Province'), null);
});

test('a valid destination code cannot be reused for a different city or province', () => {
    assert.equal(isLbcDestinationSupported('1380300000', 'Metro Manila', 'Makati'), true);
    assert.equal(isLbcDestinationSupported('1380300000', 'Metro Manila', 'Quezon City'), false);
    assert.equal(isLbcDestinationSupported('1380300000', 'Cebu', 'Makati'), false);
    assert.equal(isLbcDestinationSupported('unknown', 'Metro Manila', 'Makati'), false);
});
