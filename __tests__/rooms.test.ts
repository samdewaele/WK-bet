import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    roomMember: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    room: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { auth } from '@auth';
import { db } from '@/lib/db';
import { GET, POST, PUT } from '@/app/api/rooms/route';

const mockAuth = vi.mocked(auth);
const mockDb = db as any;

function makeRequest(body: unknown, method = 'POST'): NextRequest {
  return new NextRequest('http://localhost/api/rooms', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/rooms', () => {
  it('returns 401 when no session', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 200 with empty array when user has no rooms', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.roomMember.findMany.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns rooms with memberCount', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const now = new Date('2025-06-01T12:00:00Z');
    mockDb.roomMember.findMany.mockResolvedValue([
      {
        id: 'rm1',
        userId: 'user1',
        roomId: 'r1',
        room: {
          id: 'r1',
          name: 'Test Room',
          inviteCode: 'ABC123',
          createdAt: now,
          members: [
            { id: 'rm1', userId: 'user1', roomId: 'r1' },
            { id: 'rm2', userId: 'user2', roomId: 'r1' },
          ],
        },
      },
    ] as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
    expect(json[0].memberCount).toBe(2);
    expect(json[0].name).toBe('Test Room');
    expect(json[0].createdAt).toBe(now.toISOString());
  });
});

describe('POST /api/rooms', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await POST(makeRequest({ name: 'My Room' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/room name/i);
  });

  it('returns 400 when name is empty string', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const res = await POST(makeRequest({ name: '   ' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when name is longer than 50 characters', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const res = await POST(makeRequest({ name: 'a'.repeat(51) }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/50/);
  });

  it('returns 200 and creates room with transaction', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const now = new Date('2025-06-01T12:00:00Z');
    const createdRoom = { id: 'r1', name: 'My Room', inviteCode: 'XYZ', createdAt: now };

    mockDb.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb));
    (mockDb.room.create as ReturnType<typeof vi.fn>).mockResolvedValue(createdRoom);
    (mockDb.roomMember.create as ReturnType<typeof vi.fn>).mockResolvedValue({} as never);

    const res = await POST(makeRequest({ name: 'My Room' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.name).toBe('My Room');
    expect(json.memberCount).toBe(1);
    expect(json.inviteCode).toBe('XYZ');
    expect(json.createdAt).toBe(now.toISOString());
    expect(mockDb.$transaction).toHaveBeenCalled();
  });
});

describe('PUT /api/rooms', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null as any);
    const res = await PUT(makeRequest({ inviteCode: 'ABC' }, 'PUT'));
    expect(res.status).toBe(401);
  });

  it('returns 400 when inviteCode is missing', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const res = await PUT(makeRequest({}, 'PUT'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invite code/i);
  });

  it('returns 404 when invite code is unknown', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    mockDb.room.findUnique.mockResolvedValue(null);
    const res = await PUT(makeRequest({ inviteCode: 'UNKNOWN' }, 'PUT'));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it('returns 200 and joins room when not already a member', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user2' } } as never);
    const now = new Date('2025-06-01T12:00:00Z');
    mockDb.room.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Test Room',
      inviteCode: 'ABC123',
      createdAt: now,
      members: [{ id: 'rm1', userId: 'user1', roomId: 'r1' }],
    } as never);
    mockDb.roomMember.create.mockResolvedValue({} as never);

    const res = await PUT(makeRequest({ inviteCode: 'ABC123' }, 'PUT'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memberCount).toBe(2);
    expect(mockDb.roomMember.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'user2', roomId: 'r1' }) })
    );
  });

  it('does not create duplicate membership when already a member', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user1' } } as never);
    const now = new Date('2025-06-01T12:00:00Z');
    mockDb.room.findUnique.mockResolvedValue({
      id: 'r1',
      name: 'Test Room',
      inviteCode: 'ABC123',
      createdAt: now,
      members: [{ id: 'rm1', userId: 'user1', roomId: 'r1' }],
    } as never);

    const res = await PUT(makeRequest({ inviteCode: 'ABC123' }, 'PUT'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.memberCount).toBe(1);
    expect(mockDb.roomMember.create).not.toHaveBeenCalled();
  });
});