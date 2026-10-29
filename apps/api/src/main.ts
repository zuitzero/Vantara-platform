import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { securityMiddleware, validateCloudEnvironment } from './security/cloud-security';
import { AppModule } from './app.module';

async function bootstrap() {
  validateCloudEnvironment();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(securityMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();

