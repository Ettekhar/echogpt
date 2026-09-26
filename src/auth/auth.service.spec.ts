import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

// bcrypt.hash/compare are slow by design; keep tests fast without weakening AuthService itself.
jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async () => true),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: any;
    session: any;
  };
  let jwt: Partial<JwtService>;
  let mail: Partial<MailService>;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.FREE_PLAN_DAILY_LIMIT = '20';

    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      session: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    jwt = {
      sign: jest.fn(() => 'signed.jwt.token'),
    };

    mail = {
      sendVerificationEmail: jest.fn(async () => undefined),
    };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as JwtService,
      mail as MailService,
    );
  });

  describe('register', () => {
    it('rejects an email that is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.register({ email: 'taken@example.com', password: 'StrongPass123!' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates a user with a Free subscription and issues tokens', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // existing check
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'new@example.com',
          name: null,
          role: 'USER',
        }); // issueTokens lookup

      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'new@example.com',
        role: 'USER',
      });

      const result = await service.register({
        email: 'new@example.com',
        password: 'StrongPass123!',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new@example.com',
            subscription: expect.objectContaining({
              create: expect.objectContaining({ plan: 'FREE', dailyLimit: 20 }),
            }),
          }),
        }),
      );
      expect(mail.sendVerificationEmail).toHaveBeenCalledWith(
        'new@example.com',
        expect.any(String),
      );
      expect(prisma.session.create).toHaveBeenCalled();
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user.email).toBe('new@example.com');
    });
  });

  describe('login', () => {
    it('rejects when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'ghost@example.com', password: 'whatever123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a disabled account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', isActive: false, passwordHash: 'x' });
      await expect(
        service.login({ email: 'disabled@example.com', password: 'whatever123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an incorrect password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        isActive: true,
        deletedAt: null,
        passwordHash: 'hashed',
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('issues tokens on valid credentials', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          deletedAt: null,
          passwordHash: 'hashed',
          email: 'user@example.com',
          role: 'USER',
        })
        .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', name: null, role: 'USER' });

      const result = await service.login({
        email: 'user@example.com',
        password: 'correct-password',
      });
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toBe('signed.jwt.token');
    });
  });

  describe('refresh', () => {
    it('rejects when no matching session exists', async () => {
      prisma.session.findUnique.mockResolvedValue(null);
      await expect(service.refresh('u1', 'user@example.com', 'presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a revoked session', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revoked: true,
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.refresh('u1', 'user@example.com', 'presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired session', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revoked: false,
        expiresAt: new Date(Date.now() - 100000),
      });
      await expect(service.refresh('u1', 'user@example.com', 'presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rotates the session and issues a new token pair when valid', async () => {
      prisma.session.findUnique.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        revoked: false,
        expiresAt: new Date(Date.now() + 100000),
      });
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'u1',
          isActive: true,
          deletedAt: null,
          email: 'user@example.com',
          role: 'USER',
        })
        .mockResolvedValueOnce({ id: 'u1', email: 'user@example.com', name: null, role: 'USER' });

      const result = await service.refresh('u1', 'user@example.com', 'presented-token');

      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { revoked: true },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('logout', () => {
    it('revokes the session matching the hashed refresh token', async () => {
      await service.logout('some-refresh-token');
      expect(prisma.session.updateMany).toHaveBeenCalledWith({
        where: { refreshToken: expect.any(String) },
        data: { revoked: true },
      });
    });
  });
});
