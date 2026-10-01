import { Body, Controller, Post } from '@nestjs/common';
import { CreateWorkspaceDto } from './onboarding.dto';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('workspace')
  createWorkspace(@Body() input: CreateWorkspaceDto) {
    return this.onboardingService.createWorkspace(input);
  }
}
