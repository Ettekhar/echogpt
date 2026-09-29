import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Role } from '../common/enums/role.enum';
import { RolesService } from '../roles/roles.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private roles: RolesService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.findActiveUserOrThrow(userId, { role: true });
    return this.sanitize(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
      include: { role: true },
    });
    return this.sanitize(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.findActiveUserOrThrow(userId);
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // Invalidate all existing sessions for security after a password change.
    await this.prisma.session.updateMany({ where: { userId }, data: { revoked: true } });
    return { message: 'Password changed successfully. Please log in again.' };
  }

  async deleteAccount(userId: string) {
    await this.findActiveUserOrThrow(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await this.prisma.session.updateMany({ where: { userId }, data: { revoked: true } });
    return { message: 'Account deleted' };
  }

  // --- Admin-facing user management ---

  async findAll(page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { subscription: true, role: true },
      }),
      this.prisma.user.count(),
    ]);
    return {
      data: users.map((u) => this.sanitize(u)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async findOne(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { subscription: true, role: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async setRole(userId: string, role: Role) {
    await this.findActiveUserOrThrow(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { roleId: await this.roles.idFor(role) },
      include: { role: true },
    });
    return this.sanitize(user);
  }

  async setActive(userId: string, isActive: boolean) {
    await this.findActiveUserOrThrow(userId);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      include: { role: true },
    });
    return this.sanitize(user);
  }

  private async findActiveUserOrThrow(userId: string, include?: { role: true }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    return user;
  }

  private sanitize(user: any) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- passwordHash, emailVerifyToken and roleId are deliberately stripped from the response
    const { passwordHash, emailVerifyToken, roleId, role, ...safe } = user;
    void passwordHash;
    void emailVerifyToken;
    void roleId;
    // The Role relation is flattened back to its bare name. Clients (and the
    // JWT) have always seen `role: "USER" | "ADMIN"`, and moving roles into
    // their own table should not change a single response body.
    return { ...safe, role: role?.name ?? null };
  }
}
