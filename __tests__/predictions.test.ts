import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    prediction: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    match: {
      findMany: vi.fn(),
    },
  },
}));

import { auth } from '@auth';
import { db } from '@/lib/db';
import { GET, POST } from './route';

const mockAuth = vi.mocked(auth);
const mockDb = vi.mocked(db);

function makeRequest(body?: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/predictions', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/predictions', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 200 with empty array when no predictions', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.prediction.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it('returns serialized predictions with ISO date strings', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const now = new Date('2025-06-01T12:00:00Z');
    mockDb.prediction.findMany.mockResolvedValue([
      {
        id: 'p1',
        userId: 'user1',
        matchId: 'm1',
        homeScore: 2,
        awayScore: 1,
        points: null,
        createdAt: now,
        updatedAt: now,
        match: {
          id: 'm1',
          round: 'Group',
          group: 'A',
          matchNumber: 1,
          kickoff: now,
          homeScore: null,
          awayScore: null,
          status: 'scheduled',
        },
      },
    ] as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json[0].createdAt).toBe(now.toISOString());
    expect(json[0].match.kickoff).toBe(now.toISOString());
  });
});

describe('POST /api/predictions', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeRequest({ predictions: [] }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty predictions array', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const res = await POST(makeRequest({ predictions: [] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No predictions provided');
  });

  it('returns 400 for invalid JSON', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const req = new NextRequest('http://localhost/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON');
  });

  it('returns 400 when all matches are locked (live/finished)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.match.findMany.mockResolvedValue([
      { id: 'm1', kickoff: new Date(Date.now() + 3600000), status: 'live' },
      { id: 'm2', kickoff: new Date(Date.now() + 3600000), status: 'finished' },
    ] as never);

    const res = await POST(
      makeRequest({
        predictions: [
          { matchId: 'm1', homeScore: 1, awayScore: 0 },
          { matchId: 'm2', homeScore: 2, awayScore: 1 },
        ],
      })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/locked/i);
  });

  it('returns 400 when all matches are past kickoff', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.match.findMany.mockResolvedValue([
      { id: 'm1', kickoff: new Date(Date.now() - 3600000), status: 'scheduled' },
    ] as never);

    const res = await POST(
      makeRequest({ predictions: [{ matchId: 'm1', homeScore: 1, awayScore: 0 }] })
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for scores out of range (>20)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.match.findMany.mockResolvedValue([
      { id: 'm1', kickoff: new Date(Date.now() + 3600000), status: 'scheduled' },
    ] as never);

    const res = await POST(
      makeRequest({ predictions: [{ matchId: 'm1', homeScore: 21, awayScore: 0 }] })
    );
    expect(res.status).toBe(400);
  });

  it('saves valid predictions and returns 200', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const futureKickoff = new Date(Date.now() + 3600000);
    mockDb.match.findMany.mockResolvedValue([
      { id: 'm1', kickoff: futureKickoff, status: 'scheduled' },
    ] as never);

    const now = new Date();
    mockDb.prediction.upsert.mockResolvedValue({
      id: 'p1',
      userId: 'user1',
      matchId: 'm1',
      homeScore: 2,
      awayScore: 1,
      points: null,
      createdAt: now,
      updatedAt: now,
    } as never);

    const res = await POST(
      makeRequest({ predictions: [{ matchId: 'm1', homeScore: 2, awayScore: 1 }] })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.saved).toBe(1);
    expect(json.predictions).toHaveLength(1);
    expect(mockDb.prediction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matchId: 'm1', homeScore: 2, awayScore: 1 }),
      })
    );
  });
});