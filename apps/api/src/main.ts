import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureGuestHttp } from './connect/http/guest-http.security';
import { NestFactory } from '@nestjs/core';
import { isLocal, securityMiddleware, validateCloudEnvironment } from './security/cloud-security';
import { AppModule } from './app.module';

async function bootstrap() {
  validateCloudEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureGuestHttp(app);
  app.use(securityMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const port = process.env.PORT ?? 3001;
  if (isLocal() && process.env.PILOT01_DEMO === 'synthetic-local-only') {
    await app.listen(port, '127.0.0.1');
  } else {
    await app.listen(port);
  }
}

void bootstrap();

