import { createHash, createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest, NextResponse } from 'next/server'
import { getAdminCredentials, getClients } from './clients'

/**
 * Login survives a page refresh through a signed, httpOnly session cookie.
 * The browser never holds the password after sign-in; every data route
 * resolves the caller from this cookie instead.
 *
 * The cookie is `base64url(payload).base64url(hmac)`. The signing secret is
 * SESSION_SECRET when set; otherwise it is derived from every configured
 * credential, so changing any password signs everyone out.
 */

export const SESSION_COOKIE = 'zt_session'
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60

type Identity = { role: 'admin'; username: string } | { role: 'user'; username: string; clientId: string }

export type SessionClaims = Identity & { exp: number }

function secret(): string {
  const configured = process.env.SESSION_SECRET?.trim()
  if (configured) return configured
  const admin = getAdminCredentials()
  const material = [
    admin ? `${admin.username}:${admin.password}` : '',
    ...getClients().map(c => `${c.id}:${c.username}:${c.password}`),
  ].join('|')
  return createHash('sha256').update(`zutomate-session|${material}`).digest('hex')
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function createSessionToken(claims: Identity): string {
  const payload = { ...claims, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${sign(data)}`
}

/** Returns the claims of a valid, unexpired token whose identity still exists. */
export function verifySessionToken(token: string | undefined): SessionClaims | null {
  if (!token) return null
  const [data, signature] = token.split('.')
  if (!data || !signature) return null

  const expected = Buffer.from(sign(data))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  let claims: SessionClaims
  try {
    claims = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof claims.exp !== 'number' || claims.exp < Date.now() / 1000) return null

  // A removed client or renamed admin loses access even with a valid signature.
  if (claims.role === 'admin') {
    const admin = getAdminCredentials()
    return admin && admin.username === claims.username ? claims : null
  }
  const client = getClients().find(c => c.id === claims.clientId)
  return client && client.username === claims.username ? claims : null
}

export function readSession(req: NextRequest): SessionClaims | null {
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value)
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
}
