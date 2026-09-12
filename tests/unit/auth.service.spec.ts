import jwt from 'jsonwebtoken';

jest.mock('../../config/prisma.client', () => ({
  getPrismaClient: () => mockPrisma,
}));

jest.mock('../../config/env', () => ({
  getEnv: () => ({
    JWT_SECRET: 'test-access-secret',
    JWT_EXPIRES_IN: '15m',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_REFRESH_EXPIRES_IN: '7d',
    OVERRIDE_TOKEN_EXPIRES_IN: '5m',
    BCRYPT_SALT_ROUNDS: 4,
    NODE_ENV: 'development',
    COOKIE_SECRET: 'test-cookie-secret',
  }),
}));

jest.mock('../../socket/socket.server', () => ({
  getSocketServer: () => null,
}));

jest.mock('../../app/services/cache.service', () => ({
  setCache: jest.fn(),
  delCache: jest.fn(),
}));

jest.mock('../../app/services/audit.service', () => ({
  writeAuditLog: jest.fn(),
}));

jest.mock('../../app/services/login-throttle.service', () => ({
  recordFailedLogin: jest.fn(),
  clearFailedLogins: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed(${value})`),
  compare: jest.fn(async (candidate: string, stored: string) => candidate === stored.replace('hashed(', '').replace(')', '')),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
  },
};

function createMockResponse() {
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

function createMockRequest(cookies = {}) {
  return {
    cookies,
    ip: '127.0.0.1',
  };
}

import { createOverrideToken, loginStaff, logoutStaff, refreshStaffSession } from '../../app/services/auth.service';

const staffUser = {
  id: 'u1',
  email: 'cashier@example.com',
  passwordHash: 'hashed(right-password)',
  name: 'Cashier',
  role: 'CASHIER' as const,
  isActive: true,
  refreshTokenHash: null as string | null,
};

describe('auth.service', () => {
  beforeEach(() => {
    mockPrisma.user.findUnique.mockReset();
    mockPrisma.user.update.mockReset();
    mockPrisma.user.create.mockReset();
  });

  describe('loginStaff', () => {
    it('returns access token for valid credentials and sets refresh cookie', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(staffUser);
      mockPrisma.user.update.mockResolvedValueOnce(staffUser);

      const res = createMockResponse();
      const accessToken = await loginStaff({ email: 'Cashier@example.com', password: 'right-password' }, res);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'cashier@example.com' },
      });

      const access = jwt.verify(accessToken, 'test-access-secret') as jwt.JwtPayload;
      expect(access).toMatchObject({ sub: 'u1', email: 'cashier@example.com', role: 'CASHIER', tokenType: 'access' });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { refreshTokenHash: expect.stringMatching(/^hashed\(/) },
      });

      expect(res.cookie).toHaveBeenCalledWith('rt', expect.any(String), expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }));
    });

    it('rejects unknown emails', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const res = createMockResponse();
      await expect(loginStaff({ email: 'nobody@example.com', password: 'x' }, res)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('rejects wrong passwords', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(staffUser);

      const res = createMockResponse();
      await expect(loginStaff({ email: 'cashier@example.com', password: 'wrong' }, res)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('rejects inactive users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ ...staffUser, isActive: false });

      const res = createMockResponse();
      await expect(loginStaff({ email: 'cashier@example.com', password: 'right-password' }, res)).rejects.toMatchObject({
        status: 401,
      });
    });

    it('enforces the required role for legacy admin login', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(staffUser);

      const res = createMockResponse();
      await expect(
        loginStaff({ email: 'cashier@example.com', password: 'right-password' }, res, { requireRole: 'ADMIN' }),
      ).rejects.toMatchObject({ status: 401 });

      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('refreshStaffSession', () => {
    it('rotates tokens for a matching stored hash and sets new refresh cookie', async () => {
      const refreshToken = jwt.sign(
        { sub: 'u1', email: 'cashier@example.com', role: 'CASHIER', tokenType: 'refresh' },
        'test-refresh-secret',
        { expiresIn: '7d' },
      );

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...staffUser,
        refreshTokenHash: `hashed(${refreshToken})`,
      });
      mockPrisma.user.update.mockResolvedValueOnce(staffUser);

      const req = createMockRequest({ rt: refreshToken });
      const res = createMockResponse();
      const accessToken = await refreshStaffSession(req, res);

      expect(accessToken).toBeTruthy();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { refreshTokenHash: expect.stringMatching(/^hashed\(/) },
      });

      expect(res.cookie).toHaveBeenCalledWith('rt', expect.any(String), expect.objectContaining({
        httpOnly: true,
      }));
    });

    it('revokes the session when the stored hash does not match', async () => {
      const refreshToken = jwt.sign(
        { sub: 'u1', email: 'cashier@example.com', role: 'CASHIER', tokenType: 'refresh' },
        'test-refresh-secret',
        { expiresIn: '7d' },
      );

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        ...staffUser,
        refreshTokenHash: 'hashed(different-token)',
      });
      mockPrisma.user.update.mockResolvedValueOnce(staffUser);

      const req = createMockRequest({ rt: refreshToken });
      const res = createMockResponse();

      await expect(refreshStaffSession(req, res)).rejects.toMatchObject({ status: 401 });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { refreshTokenHash: null },
      });
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('rejects access tokens used as refresh tokens', async () => {
      const accessToken = jwt.sign(
        { sub: 'u1', email: 'cashier@example.com', role: 'CASHIER', tokenType: 'access' },
        'test-refresh-secret',
        { expiresIn: '15m' },
      );

      const req = createMockRequest({ rt: accessToken });
      const res = createMockResponse();

      await expect(refreshStaffSession(req, res)).rejects.toMatchObject({ status: 401 });
      expect(res.clearCookie).toHaveBeenCalled();
    });

    it('rejects when refresh token is missing', async () => {
      const req = createMockRequest({});
      const res = createMockResponse();

      await expect(refreshStaffSession(req, res)).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('logoutStaff', () => {
    it('clears refresh cookie and invalidates session', async () => {
      mockPrisma.user.update.mockResolvedValueOnce(staffUser);

      const res = createMockResponse();
      await logoutStaff('u1', res, '127.0.0.1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { refreshTokenHash: null },
      });
      expect(res.clearCookie).toHaveBeenCalledWith('rt', expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }));
    });
  });

  describe('createOverrideToken', () => {
    it('signs a short-lived override token with the manager identity', () => {
      const token = createOverrideToken({ id: 'mgr1', email: 'manager@example.com', role: 'MANAGER' });

      const decoded = jwt.verify(token, 'test-access-secret') as jwt.JwtPayload;
      expect(decoded).toMatchObject({
        sub: 'mgr1',
        email: 'manager@example.com',
        role: 'MANAGER',
        tokenType: 'override',
      });
      expect(decoded.exp! - decoded.iat!).toBe(300);
    });
  });
});