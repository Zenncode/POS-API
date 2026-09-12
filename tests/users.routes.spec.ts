import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-access-secret-routes';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-routes';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.REDIS_ENABLED = 'false';
process.env.QUEUE_ENABLED = 'false';

jest.mock('../app/services/user.service', () => ({
  listUsers: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  resetUserPassword: jest.fn(),
  setUserPin: jest.fn(),
  verifyOverridePin: jest.fn(),
}));

jest.mock('../app/services/cache.service', () => ({
  getCache: jest.fn(async () => null),
  setCache: jest.fn(async () => undefined),
  delCache: jest.fn(async () => undefined),
  delCacheByPrefix: jest.fn(async () => undefined),
  withCache: jest.fn(async (_key: string, _ttl: number, producer: () => Promise<unknown>) => producer()),
}));

import { createApp } from '../app/app.module';
import * as userService from '../app/services/user.service';

const createUserMock = userService.createUser as jest.MockedFunction<typeof userService.createUser>;
const updateUserMock = userService.updateUser as jest.MockedFunction<typeof userService.updateUser>;
const resetPasswordMock = userService.resetUserPassword as jest.MockedFunction<
  typeof userService.resetUserPassword
>;
const setPinMock = userService.setUserPin as jest.MockedFunction<typeof userService.setUserPin>;

function token(role: 'ADMIN' | 'CASHIER', id = 'admin1'): string {
  return jwt.sign(
    { sub: id, email: `${role.toLowerCase()}@example.com`, role, tokenType: 'access' },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' },
  );
}

const userFixture = {
  id: 'u9',
  email: 'new@example.com',
  name: 'New Staff',
  role: 'CASHIER',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('User routes', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).get('/api/users');

    expect(response.status).toBe(401);
  });

  it('forbids cashiers from accessing user management', async () => {
    const response = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${token('CASHIER', 'cashier1')}`);

    expect(response.status).toBe(403);
    expect(userService.listUsers).not.toHaveBeenCalled();
  });

  it('creates a staff user', async () => {
    createUserMock.mockResolvedValueOnce(userFixture as never);

    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ email: 'new@example.com', password: 'super-secret-123', name: 'New Staff', role: 'CASHIER' });

    expect(response.status).toBe(201);
    expect(response.body.id).toBe('u9');
    expect(createUserMock).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'super-secret-123',
      name: 'New Staff',
      role: 'CASHIER',
    });
  });

  it('rejects invalid roles with 400', async () => {
    const response = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ email: 'new@example.com', password: 'super-secret-123', name: 'New Staff', role: 'SUPERUSER' });

    expect(response.status).toBe(400);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('updates a user with the acting admin id', async () => {
    updateUserMock.mockResolvedValueOnce({ ...userFixture, name: 'Renamed' } as never);

    const response = await request(app)
      .patch('/api/users/00000000-0000-4000-8000-000000000009')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ name: 'Renamed' });

    expect(response.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000009',
      { name: 'Renamed' },
      'admin1',
    );
  });

  it('resets a password', async () => {
    resetPasswordMock.mockResolvedValueOnce(userFixture as never);

    const response = await request(app)
      .post('/api/users/00000000-0000-4000-8000-000000000009/reset-password')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ password: 'another-secret-123' });

    expect(response.status).toBe(200);
    expect(resetPasswordMock).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000009', 'another-secret-123');
  });

  it('sets a manager PIN', async () => {
    setPinMock.mockResolvedValueOnce(userFixture as never);

    const response = await request(app)
      .post('/api/users/00000000-0000-4000-8000-000000000009/pin')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ pin: '1234' });

    expect(response.status).toBe(200);
    expect(setPinMock).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000009', '1234');
  });

  it('rejects malformed PINs with 400', async () => {
    const response = await request(app)
      .post('/api/users/00000000-0000-4000-8000-000000000009/pin')
      .set('Authorization', `Bearer ${token('ADMIN')}`)
      .send({ pin: '12ab' });

    expect(response.status).toBe(400);
    expect(setPinMock).not.toHaveBeenCalled();
  });
});
