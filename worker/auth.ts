import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { HttpError } from './errors.ts';

export interface AccessConfiguration {
    ACCESS_TEAM_DOMAIN: string;
    ACCESS_AUDIENCE: string;
}

export interface AccessIdentity {
    subject: string;
    email: string;
}

export interface Member {
    id: string;
    email: string;
    role: 'owner' | 'reseller' | 'print_operator';
}

interface MemberRow extends Member {
    access_subject: string | null;
    active: number;
}

let cachedDomain: string | undefined;
let cachedKeySet: JWTVerifyGetKey | undefined;

function configuration(config: AccessConfiguration) {
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(config.ACCESS_TEAM_DOMAIN)
        || !/^[a-f0-9]{64}$/.test(config.ACCESS_AUDIENCE)) {
        throw new HttpError(503, 'access_not_configured', 'Sign-in is not configured for this environment.');
    }
    return { issuer: `https://${config.ACCESS_TEAM_DOMAIN}`, audience: config.ACCESS_AUDIENCE };
}

export async function verifyAccessIdentity(
    request: Request,
    config: AccessConfiguration,
    getKey?: JWTVerifyGetKey
): Promise<AccessIdentity> {
    const { issuer, audience } = configuration(config);
    // Private APIs may sit outside the edge-protected UI paths. The Access
    // cookie is still a JWT and must pass exactly the same signature/claim checks.
    const cookies = (request.headers.get('Cookie') || '').split(';')
        .map(part => part.trim()).filter(part => part.startsWith('CF_Authorization='));
    const token = request.headers.get('Cf-Access-Jwt-Assertion')
        || (cookies.length === 1 ? cookies[0]?.slice('CF_Authorization='.length) : undefined);
    if (!token || token.length > 16384) {
        throw new HttpError(401, 'sign_in_required', 'Sign in to access this workspace.');
    }
    if (!getKey) {
        if (cachedDomain !== issuer || !cachedKeySet) {
            cachedKeySet = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), {
                timeoutDuration: 5000,
                cooldownDuration: 30000,
                cacheMaxAge: 600000
            });
            cachedDomain = issuer;
        }
        getKey = cachedKeySet;
    }
    try {
        const { payload } = await jwtVerify(token, getKey, {
            issuer,
            audience,
            algorithms: ['RS256'],
            requiredClaims: ['exp', 'iat', 'sub', 'email', 'type']
        });
        if (payload.type !== 'app' || typeof payload.email !== 'string'
            || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)
            || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 256
            || typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) + 30) {
            throw new HttpError(401, 'invalid_identity', 'A valid individual account is required.');
        }
        return { subject: payload.sub, email: payload.email.toLowerCase() };
    } catch (error) {
        if (error instanceof HttpError) throw error;
        if (error instanceof errors.JWTExpired || error instanceof errors.JWTClaimValidationFailed
            || error instanceof errors.JWSSignatureVerificationFailed || error instanceof errors.JWSInvalid
            || error instanceof errors.JWTInvalid || error instanceof errors.JOSEAlgNotAllowed
            || error instanceof errors.JWKSNoMatchingKey) {
            throw new HttpError(401, 'invalid_session', 'Your sign-in could not be verified. Sign in again.');
        }
        throw new HttpError(503, 'identity_service_unavailable', 'Sign-in verification is temporarily unavailable.', {
            cause: error
        });
    }
}

export async function findMember(db: D1Database, identity: AccessIdentity): Promise<Member> {
    const row = await db.prepare(
        'SELECT id, email, access_subject, role, active FROM members WHERE email = ?'
    ).bind(identity.email).first<MemberRow>();
    if (!row || row.active !== 1 || !['owner', 'reseller', 'print_operator'].includes(row.role)) {
        throw new HttpError(403, 'access_denied', 'This account does not have workspace access.');
    }
    if (row.access_subject !== identity.subject) {
        if (row.access_subject !== null) {
            throw new HttpError(403, 'identity_changed', 'This account needs its identity mapping reviewed by the owner.');
        }
        // Only a pre-provisioned active membership can bind its first verified Access identity.
        const bound = await db.prepare(`
            UPDATE members SET access_subject = ?
            WHERE id = ? AND email = ? AND active = 1 AND access_subject IS NULL
            RETURNING id, email, access_subject, role, active
        `).bind(identity.subject, row.id, identity.email).first<MemberRow>();
        if (!bound) {
            const current = await db.prepare(
                'SELECT id, email, access_subject, role, active FROM members WHERE id = ? AND email = ?'
            ).bind(row.id, identity.email).first<MemberRow>();
            if (!current || current.active !== 1 || current.access_subject !== identity.subject
                || !['owner', 'reseller', 'print_operator'].includes(current.role)) {
                throw new HttpError(403, 'access_denied', 'This account does not have workspace access.');
            }
            return { id: current.id, email: current.email, role: current.role };
        }
        if (!['owner', 'reseller', 'print_operator'].includes(bound.role)) {
            throw new HttpError(403, 'access_denied', 'This account does not have workspace access.');
        }
        return { id: bound.id, email: bound.email, role: bound.role };
    }
    return { id: row.id, email: row.email, role: row.role };
}
