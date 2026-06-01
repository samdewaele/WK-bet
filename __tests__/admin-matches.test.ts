import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    match: {
      update: vi.fn(),
    },
    prediction: {
      update: vi.fn(),
    },
    kOPrediction: {
      update: vi.fn(),
    },
  },
}));

import { auth } from '@auth';
import { db } from '@/lib/db';
import { PATCH } from '../src/app/api/admin/matches/[matchId]/route';

const mockAuth = vi.mocked(auth);
const mockDb = db as any;

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/matches/m1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const defaultParams = { params: Promise.resolve({ matchId: 'm1' }) };

describe('PATCH /api/admin/matches/[matchId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await PATCH(makeRequest({ status: 'live' }), defaultParams);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 403 for non-admin user', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1', role: 'user' } } as never);
    const res = await PATCH(makeRequest({ status: 'live' }), defaultParams);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 400 for invalid status', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    const res = await PATCH(makeRequest({ status: 'invalid-status' }), defaultParams);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid status');
  });

  it('returns 200 and updates match with valid status', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: null,
      awayScore: null,
      status: 'live',
      round: 'Group',
      predictions: [],
      koPredictions: [],
    } as never);

    const res = await PATCH(makeRequest({ status: 'live' }), defaultParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('m1');
    expect(json.status).toBe('live');
    expect(json.predictionsUpdated).toBe(0);
  });

  it('updates match scores', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: 3,
      awayScore: 1,
      status: 'live',
      round: 'Group',
      predictions: [],
      koPredictions: [],
    } as never);

    const res = await PATCH(
      makeRequest({ homeScore: 3, awayScore: 1, status: 'live' }),
      defaultParams
    );
    expect(res.status).toBe(200);
    expect(mockDb.match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ homeScore: 3, awayScore: 1, status: 'live' }),
      })
    );
  });

  it('recalculates points for predictions when status=finished with scores', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);

    // Match result: Group stage, 2-1 home win
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: 2,
      awayScore: 1,
      status: 'finished',
      round: 'Group',
      predictions: [
        // Exact score: should get Group result(3) + exact(2) = 5 points
        { id: 'pred1', homeScore: 2, awayScore: 1 },
        // Correct result (home win), wrong score: should get Group result(3) = 3 points
        { id: 'pred2', homeScore: 3, awayScore: 0 },
        // Wrong result (away win): should get 0 points
        { id: 'pred3', homeScore: 0, awayScore: 2 },
      ],
      koPredictions: [],
    } as never);

    mockDb.prediction.update.mockResolvedValue({} as never);

    const res = await PATCH(
      makeRequest({ homeScore: 2, awayScore: 1, status: 'finished' }),
      defaultParams
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.predictionsUpdated).toBe(3);

    // Verify exact score prediction gets 5 points (result=3 + exact=2)
    expect(mockDb.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pred1' }, data: { points: 5 } })
    );

    // Verify correct result prediction gets 3 points (result only)
    expect(mockDb.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pred2' }, data: { points: 3 } })
    );

    // Verify wrong result prediction gets 0 points
    expect(mockDb.prediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pred3' }, data: { points: 0 } })
    );
  });

  it('does not recalculate points when status is not finished', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: 1,
      awayScore: 0,
      status: 'live',
      round: 'Group',
      predictions: [{ id: 'pred1', homeScore: 1, awayScore: 0 }],
      koPredictions: [],
    } as never);

    await PATCH(makeRequest({ homeScore: 1, awayScore: 0, status: 'live' }), defaultParams);
    expect(mockDb.prediction.update).not.toHaveBeenCalled();
  });

  it('does not recalculate points when scores are null', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: null,
      awayScore: null,
      status: 'finished',
      round: 'Group',
      predictions: [{ id: 'pred1', homeScore: 1, awayScore: 0 }],
      koPredictions: [],
    } as never);

    await PATCH(makeRequest({ status: 'finished' }), defaultParams);
    expect(mockDb.prediction.update).not.toHaveBeenCalled();
  });

  it('uses correct points for R16 exact score (12 points)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'admin1', role: 'admin' } } as never);
    mockDb.match.update.mockResolvedValue({
      id: 'm1',
      homeScore: 1,
      awayScore: 1,
      status: 'finished',
      round: 'R16',
      predictions: [],
      koPredictions: [
        // Exact draw score: R16 result(8) + exact(4) = 12 points
        { id: 'pred1', homeScore: 1, awayScore: 1 },
      ],
    } as never);
    mockDb.kOPrediction.update.mockResolvedValue({} as never);

    await PATCH(makeRequest({ homeScore: 1, awayScore: 1, status: 'finished' }), defaultParams);
    expect(mockDb.kOPrediction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pred1' }, data: { points: 12 } })
    );
  });
});