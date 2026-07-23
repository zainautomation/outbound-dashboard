import { NextRequest, NextResponse } from 'next/server'
import { findClientByCredentials, getClients, isAdmin, toSummary } from '@/lib/clients'
import type { AuthResponse } from '@/lib/types'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  if (isAdmin(username, password)) {
    const body: AuthResponse = {
      role: 'admin',
      username,
      clients: getClients().map(toSummary),
    }
    return NextResponse.json(body)
  }

  const client = findClientByCredentials(username, password)
  if (client) {
    const body: AuthResponse = { role: 'user', username, clientId: client.id }
    return NextResponse.json(body)
  }

  return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
}
