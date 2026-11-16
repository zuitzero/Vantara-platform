import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureGuestHttp } from './connect/http/guest-http.security';
import { NestFactory } from '@nestjs/core';
import { isLocal, securityMiddleware, validateCloudEnvironment } from './security/cloud-security';
import { configuration as showroomConfiguration } from '../../../infra/staging/showroom-policy.cjs';
import { configureShowroomApi, verifyShowroomDatabase, verifyShowroomOperator } from './security/showroom-security';
import { PrismaService } from './prisma/prisma.service';
import { AppModule } from './app.module';

async function bootstrap() {
  const showroom = showroomConfiguration(process.env);
  if (process.argv.includes('--showroom') && !showroom) throw new Error('SHOWROOM_MODE_REQUIRED');
  verifyShowroomOperator(showroom);
  validateCloudEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, ...(showroom ? { logger: false } : {}) });
  if (showroom) {
    await verifyShowroomDatabase(app.get(PrismaService));
    configureShowroomApi(app, showroom);
  }
  configureGuestHttp(app);
  app.use(securityMiddleware);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const port = process.env.PORT ?? 3001;
  if (showroom || (isLocal() && process.env.PILOT01_DEMO === 'synthetic-local-only')) {
    await app.listen(port, '127.0.0.1');
  } else {
    await app.listen(port);
  }
}

void bootstrap().catch(error => {
  if (!process.argv.includes('--showroom') &&
      ['SHOWROOM_MODE', 'SHOWROOM_DATA_MARKER', 'SHOWROOM_INGRESS_KEY', 'SHOWROOM_GUEST_MODE', 'SHOWROOM_REPLICAS', 'SHOWROOM_GUEST_OPERATOR'].every(name => process.env[name] === undefined)) {
    throw error;
  }
  console.error('API_STARTUP_REJECTED');
  process.exit(1);
});

