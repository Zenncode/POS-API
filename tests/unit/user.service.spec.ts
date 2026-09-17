jest.mock('@prisma/client', () => ({
  UserRole: {
    ADMIN: 'ADMIN',
    MANAGER: 'MANAGER',
    CASHIER: 'CASHIER',
  },
  Prisma: {},
}));

jest.mock('../../config/prisma.client', () => ({
  getPrismaClient: () => mockPrisma,
}));

jest.mock('../../config/env', () => ({
  getEnv: () => ({ BCRYPT_SALT_ROUNDS: 4 }),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(async (value: string) => `hashed(${value})`),
  compare: jest.fn(
    async (candidate: string, stored: string) =>
      candidate === stored.replace('hashed(', '').replace(')', ''),
  ),
}));

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

import {
  createUser,
  resetUserPassword,
  setUserPin,
  updateUser,
  verifyOverridePin,
} from '../../app/services/user.service';

const createdFixture = {
  id: 'u9',
  email: 'cashier@example.com',
  name: 'New Staff',
  role: 'CASHIER',
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('user.service', () => {
  beforeEach(() => {
    Object.values(mockPrisma.user).forEach((mock) => mock.mockReset());
  });

  describe('createUser', () => {
    it('hashes the password and normalizes the email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce(createdFixture);

      const result = await createUser({
        email: 'Cashier@Example.com',
        password: 'super-secret-123',
        name: 'New Staff',
        role: 'CASHIER',
      });

      expect(result).toEqual(createdFixture);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'cashier@example.com',
          passwordHash: 'hashed(super-secret-123)',
          name: 'New Staff',
          role: 'CASHIER',
        },
        select: expect.objectContaining({ email: true, role: true }),
      });
      expect(mockPrisma.user.create.mock.calls[0][0].data).not.toHaveProperty('password');
    });

    it('rejects duplicate emails with 409', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1' });

      await expect(
        createUser({ email: 'cashier@example.com', password: 'super-secret-123', name: 'X', role: 'CASHIER' }),
      ).rejects.toMatchObject({ status: 409, code: 'DUPLICATE_EMAIL' });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('updateUser', () => {
    it('forbids admins from demoting or deactivating themselves', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({ id: 'a1', role: 'ADMIN', isActive: true })
        .mockResolvedValueOnce({ id: 'a1', role: 'ADMIN', isActive: true });

      await expect(updateUser('a1', { role: 'CASHIER' }, 'a1')).rejects.toMatchObject({
        status: 403,
        code: 'SELF_MODIFICATION_FORBIDDEN',
      });

      await expect(updateUser('a1', { isActive: false }, 'a1')).rejects.toMatchObject({
        status: 403,
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks removing the last active admin', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'a2',
        role: 'ADMIN',
        isActive: true,
      });
      mockPrisma.user.count.mockResolvedValueOnce(0);

      await expect(updateUser('a2', { isActive: false }, 'a1')).rejects.toMatchObject({
        status: 409,
        code: 'LAST_ADMIN',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('deactivates a user and revokes their refresh token', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'u3',
        role: 'CASHIER',
        isActive: true,
      });
      mockPrisma.user.update.mockResolvedValueOnce({ ...createdFixture, isActive: false });

      await updateUser('u3', { isActive: false }, 'a1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u3' },
        data: { isActive: false, refreshTokenHash: null },
        select: expect.objectContaining({ email: true }),
      });
    });

    it('keeps the refresh token when reactivating', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'u3',
        role: 'CASHIER',
        isActive: false,
      });
      mockPrisma.user.update.mockResolvedValueOnce(createdFixture);

      await updateUser('u3', { isActive: true }, 'a1');

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u3' },
          data: { isActive: true },
        }),
      );
    });
  });

  describe('resetUserPassword', () => {
    it('hashes the new password and revokes sessions', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u3' });
      mockPrisma.user.update.mockResolvedValueOnce(createdFixture);

      await resetUserPassword('u3', 'brand-new-secret');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u3' },
        data: { passwordHash: 'hashed(brand-new-secret)', refreshTokenHash: null },
        select: expect.objectContaining({ email: true }),
      });
    });

    it('rejects unknown users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(resetUserPassword('missing', 'brand-new-secret')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('setUserPin', () => {
    it('rejects PINs for cashiers', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u3', role: 'CASHIER' });

      await expect(setUserPin('u3', '1234')).rejects.toMatchObject({
        status: 422,
        code: 'PIN_NOT_ALLOWED',
      });
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('stores a hashed PIN for managers', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'm1', role: 'MANAGER' });
      mockPrisma.user.update.mockResolvedValueOnce(createdFixture);

      await setUserPin('m1', '1234');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { pinHash: 'hashed(1234)' },
        select: expect.objectContaining({ email: true }),
      });
    });
  });

  describe('verifyOverridePin', () => {
    it('matches the manager who owns the PIN', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'm1',
          email: 'm1@example.com',
          name: 'Manager One',
          role: 'MANAGER',
          pinHash: 'hashed(1234)',
        },
        {
          id: 'm2',
          email: 'm2@example.com',
          name: 'Manager Two',
          role: 'MANAGER',
          pinHash: 'hashed(5678)',
        },
      ]);

      const manager = await verifyOverridePin('5678');

      expect(manager).toMatchObject({ id: 'm2', name: 'Manager Two', role: 'MANAGER' });
    });

    it('returns null when no manager PIN matches', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([
        {
          id: 'm1',
          email: 'm1@example.com',
          name: 'Manager One',
          role: 'MANAGER',
          pinHash: 'hashed(1234)',
        },
      ]);

      await expect(verifyOverridePin('9999')).resolves.toBeNull();
    });
  });
});
