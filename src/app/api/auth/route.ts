import { NextRequest, NextResponse } from 'next/server'
import { authResponse } from '@/lib/authorize'
import { findClientByCredentials, isAdmin } from '@/lib/clients'
import {
  clearSessionCookie,
  createSessionToken,
  readSession,
  setSessionCookie,
  verifySessionToken,
} from '@/lib/session'

/** GET: restore the signed-in session from its cookie (used on page load). */
export async function GET(req: NextRequest) {
  const session = readSession(req)
  const body = session && authResponse(session)
  if (!body) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  return NextResponse.json(body)
}

/** POST: sign in with username + password; sets the session cookie. */
export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  const token = isAdmin(username, password)
    ? createSessionToken({ role: 'admin', username })
    : (() => {
        const client = findClientByCredentials(username, password)
        return client ? createSessionToken({ role: 'user', username, clientId: client.id }) : null
      })()

  const session = verifySessionToken(token ?? undefined)
  const body = session && authResponse(session)
  if (!token || !body) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  const res = NextResponse.json(body)
  setSessionCookie(res, token)
  return res
}

/** DELETE: sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  clearSessionCookie(res)
  return res
}
