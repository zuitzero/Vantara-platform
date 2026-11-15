import type { PrismaClient } from '@prisma/client';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { admits, deny, HEADER, MARKER, type ShowroomConfig } from '../../../../infra/staging/showroom-policy.cjs';

export function configureShowroomApi(app: NestExpressApplication, config: ShowroomConfig) {
  // Install before JSON parsing and Nest routing to avoid normalization or error reflection.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!admits(config, req, 'api', req.originalUrl)) return deny(res);
    delete req.headers[HEADER];
    next();
  });
}

export async function verifyShowroomDatabase(db: Pick<PrismaClient, '$queryRaw'>) {
  try {
    const [row] = await db.$queryRaw<{ safe: boolean }[]>`
      SELECT current_database() = 'vantara_showroom' AND current_user = 'vantara_showroom_runtime'
        AND session_user = current_user AND NOT pg_is_in_recovery()
        AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999
        AND shobj_description(d.oid, 'pg_database') = ${MARKER}
        AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls)
        AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid)
        AND NOT has_database_privilege(current_user, current_database(), 'CREATE')
        AND NOT has_database_privilege(current_user, current_database(), 'TEMP')
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relowner = r.oid)
        AS safe
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
      WHERE r.rolname = current_user`;
    if (row?.safe === true) return;
  } catch {
    // Database errors may include credentials or private host names.
  }
  throw new Error('SHOWROOM_DATABASE_REJECTED');
}
