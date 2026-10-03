import { ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, scrypt as nodeScrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { MembershipRole, PlanCode, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWorkspaceDto, WorkspaceCreatedResponse } from './onboarding.dto';

const scrypt = promisify(nodeScrypt);

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async createWorkspace(input: CreateWorkspaceDto): Promise<WorkspaceCreatedResponse> {
    const email = input.email.trim().toLowerCase();
    const slug = input.slug.trim().toLowerCase();
    const plan = input.plan ?? PlanCode.LOBBY;
    const passwordHash = await this.hashPassword(input.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: input.name.trim(),
          },
        });

        const tenant = await tx.tenant.create({
          data: {
            name: input.hotelName.trim(),
            slug,
            type: 'HOTEL',
          },
        });

        // Hotel owners/managers are HOTEL_ADMIN. OWNER is reserved for
        // the Zuitzero/Vantara platform owner and is never granted here.
        await tx.membership.create({
          data: {
            userId: user.id,
            tenantId: tenant.id,
            role: MembershipRole.HOTEL_ADMIN,
          },
        });

        const property = await tx.property.create({
          data: {
            tenantId: tenant.id,
            name: input.propertyName.trim(),
          },
        });

        const subscription = await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            plan,
            status: 'TRIALING',
          },
        });

        return {
          userId: user.id,
          tenantId: tenant.id,
          propertyId: property.id,
          subscriptionId: subscription.id,
          plan,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A user, hotel slug, or workspace already exists with this value.');
      }
      throw error;
    }
  }

  private async hashPassword(password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new ConflictException('Password must contain at least 8 characters.');
    }

    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    const fingerprint = createHash('sha256').update(derivedKey).digest('hex');
    return `scrypt:${salt}:${fingerprint}`;
  }
}
