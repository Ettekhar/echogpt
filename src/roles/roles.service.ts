import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../common/enums/role.enum';

/**
 * Description shown against each built-in role in the Role table.
 */
export const SYSTEM_ROLE_DESCRIPTIONS: Record<Role, string> = {
  [Role.USER]: 'Default role for every registered account',
  [Role.ADMIN]: 'Full access to the admin panel and every /admin endpoint',
};

/**
 * Resolves role names to the Role rows that own them.
 *
 * Roles are a table rather than an enum because the assignment asks for a Roles
 * entity, and because a table can carry metadata and be extended without a
 * migration that rewrites a PostgreSQL type.
 *
 * The trade-off is that a role row has to exist before a user can point at it.
 * `idFor` upserts rather than assuming the migration ran, so a database created
 * by `prisma db push` (which scripts/dev.js effectively implies) cannot end up
 * with users but no roles. Ids are cached for the process lifetime because
 * roles never change while the app is running.
 */
@Injectable()
export class RolesService {
  private idCache = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  async idFor(name: Role): Promise<string> {
    const cached = this.idCache.get(name);
    if (cached) return cached;

    const role = await this.prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: SYSTEM_ROLE_DESCRIPTIONS[name] },
    });
    this.idCache.set(name, role.id);
    return role.id;
  }

  /** Used by tests and by seeding to clear memoised ids. */
  clearCache(): void {
    this.idCache.clear();
  }
}
