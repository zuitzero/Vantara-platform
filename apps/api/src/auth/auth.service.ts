import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaService } from '../prisma/prisma.service';
import { SESSION_TTL_DAYS } from './auth.constants';
import { AuthenticatedWorkspace, LoginDto } from './auth.dto';

const scrypt = promisify(nodeScrypt);

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(input: LoginDto): Promise<{ token: string; expiresAt: Date }> {
    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { orderBy: { createdAt: 'asc' } } },
    });

    if (!user || !(await this.verifyPassword(input.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const membership = user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException('User has no active hotel membership.');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        activeTenantId: membership.tenantId,
        tokenHash,
        expiresAt,
      },
    });

    return { token, expiresAt };
  }

  async getWorkspace(token: string): Promise<AuthenticatedWorkspace> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, expiresAt: { gt: new Date() } },
      include: {
        user: {
          include: {
            memberships: {
              include: { tenant: { include: { subscription: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!session) throw new UnauthorizedException('Session expired or invalid.');

    const membership = session.user.memberships.find(
      (candidate) => candidate.tenantId === session.activeTenantId,
    );

    if (!membership) {
      throw new UnauthorizedException('Active hotel membership is no longer available.');
    }

    return this.toWorkspace(session.user, membership);
  }

  async switchTenant(token: string, tenantId: string): Promise<AuthenticatedWorkspace> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const session = await this.prisma.session.findFirst({
      where: { tokenHash, expiresAt: { gt: new Date() } },
      include: { user: true },
    });

    if (!session) throw new UnauthorizedException('Session expired or invalid.');

    const membership = await this.prisma.membership.findUnique({
      where: { userId_tenantId: { userId: session.userId, tenantId } },
      include: { tenant: { include: { subscription: true } } },
    });

    if (!membership) {
      throw new UnauthorizedException('You do not have access to this hotel.');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { activeTenantId: tenantId },
    });

    return this.toWorkspace(session.user, membership);
  }

  async logout(token: string): Promise<void> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await this.prisma.session.deleteMany({ where: { tokenHash } });
  }

  private toWorkspace(
    user: { id: string; email: string; name: string },
    membership: {
      id: string;
      role: string;
      tenant: {
        id: string;
        name: string;
        slug: string;
        subscription: { plan: string; status: string } | null;
      };
    },
  ): AuthenticatedWorkspace {
    return {
      user: { id: user.id, email: user.email, name: user.name },
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
      },
      membership: { id: membership.id, role: membership.role },
      subscription: membership.tenant.subscription
        ? {
            plan: membership.tenant.subscription.plan,
            status: membership.tenant.subscription.status,
          }
        : null,
    };
  }

  private async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [algorithm, salt, fingerprint] = storedHash.split(':');
    if (algorithm !== 'scrypt' || !salt || !fingerprint) return false;

    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(fingerprint, 'hex');
    const actual = createHash('sha256').update(derivedKey).digest();

    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
