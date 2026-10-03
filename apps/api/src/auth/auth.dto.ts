import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export interface AuthenticatedWorkspace {
  user: { id: string; email: string; name: string };
  tenant: { id: string; name: string; slug: string };
  membership: { id: string; role: string };
  subscription: { plan: string; status: string } | null;
}
