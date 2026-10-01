import { PlanCode } from '@prisma/client';

export class CreateWorkspaceDto {
  name!: string;
  email!: string;
  password!: string;
  hotelName!: string;
  slug!: string;
  propertyName!: string;
  plan?: PlanCode;
}

export interface WorkspaceCreatedResponse {
  userId: string;
  tenantId: string;
  propertyId: string;
  subscriptionId: string;
  plan: PlanCode;
}
