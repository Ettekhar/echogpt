import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { hashRefreshToken } from '../common/utils/token-hash.util';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const emailVerifyToken = randomUUID();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        emailVerifyToken,
        subscription: {
          create: {
            plan: 'FREE',
            dailyLimit: Number(process.env.FREE_PLAN_DAILY_LIMIT || 20),
          },
        },
      },
    });

    // Bonus: email verification. Sends via MailService (real SMTP if configured,
    // otherwise falls back to a console log - see src/mail/mail.service.ts).
    await this.mail.sendVerificationEmail(user.email, emailVerifyToken);

    return this.issueTokens(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user.id, user.email, user.role);
  }

  async refresh(userId: string, email: string, presentedRefreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken: hashRefreshToken(presentedRefreshToken) },
    });

    if (
      !session ||
      session.revoked ||
      session.userId !== userId ||
      session.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }

    // Rotate: revoke the old session and issue a brand new pair.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revoked: true },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Account is no longer active');
    }

    return this.issueTokens(user.id, user.email, user.role);
  }

  async logout(refreshToken: string) {
    await this.prisma.session.updateMany({
      where: { refreshToken: hashRefreshToken(refreshToken) },
      data: { revoked: true },
    });
    return { message: 'Logged out successfully' };
  }

  async verifyEmail(token: string) {
    const user = await this.prisma.user.findFirst({ where: { emailVerifyToken: token } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifyToken: null },
    });
    return { message: 'Email verified successfully' };
  }

  private async issueTokens(userId: string, email: string, role: string) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, role },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      },
    );

    const refreshToken = this.jwt.sign(
      { sub: userId, email },
      {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      },
    );

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: { userId, refreshToken: hashRefreshToken(refreshToken), expiresAt },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    return {
      accessToken,
      refreshToken,
      user: { id: user!.id, email: user!.email, name: user!.name, role: user!.role },
    };
  }
}
