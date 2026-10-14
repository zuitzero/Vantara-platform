# Vantara Pilot 01 — demo sintética local

Alcance: Issue #35. Dos hoteles HOTEL aislados (A/B), un administrador de prueba
por hotel y una reserva CONFIRMED por escenario. Todos los nombres llevan DEMO y
los correos usan `pilot01.example.invalid`. No se crean tokens durante el setup.
No hay endpoints nuevos, bypass de login/RBAC, cambios de esquema ni cambios de
billing. Las cuentas tienen contraseña scrypt compatible con el login existente.

## Requisitos y setup

- Node 22, pnpm 10.15.0 y PostgreSQL 18 local/deshabilitado para acceso externo.
- Base **exclusiva y desechable** llamada `vantara_pilot01`, inicialmente vacía
  salvo las migraciones Prisma. Nunca usar un túnel, réplica, dump o base real.
- Instancia PostgreSQL **aislada y desechable**, sin otras bases de clientes.
- Rol de ejecución `vantara_pilot01_demo`, directo y sin membresías, superuser,
  CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, creación de schema/base ni propiedad
  de objetos. Usar credenciales propias de demo, fuera de Git y logs.
- Comentario de base `VANTARA_PILOT01_LOCAL_SYNTHETIC_ONLY` puesto deliberadamente
  por el administrador de esa instancia DEMO. Sin ese marcador se rechaza el uso.
- Retirar variables `PG*` y `PRISMA_*` de la terminal de ejecución: no se permiten
  overrides de conexión/servicio/motores. No usar un entorno de producción.
- `NODE_ENV=development` (o test) y `PILOT01_DEMO=synthetic-local-only` explícitos.
- Contraseña DEMO de 16–128 caracteres suministrada por entorno; no hay default.
- Ninguna variable `STRIPE_*` con valor. Usar una sesión de terminal limpia.

Desde la raíz del repo, en zsh (la entrada silenciosa evita historial/salida):

```sh
pnpm install --frozen-lockfile
export NODE_ENV=development PILOT01_DEMO=synthetic-local-only
read -rs 'DATABASE_URL?URL privada de PostgreSQL local para vantara_pilot01: '
echo
export DATABASE_URL
read -rs 'PILOT01_PASSWORD?Contraseña nueva de las cuentas DEMO: '
echo
export PILOT01_PASSWORD
pnpm --filter @vantara/api exec prisma generate
node -e 'require("./apps/api/scripts/pilot01.cjs").configuration(process.env)'
# La base debe estar previamente migrada por su administrador local (ver abajo).
pnpm --filter @vantara/api demo:setup
```

Crear la base vacía previamente con la administración de tu instancia local.
La URL debe ser `postgresql://…@localhost:PUERTO/vantara_pilot01?schema=public`
(o 127.0.0.1/::1). No se aceptan hosts alternativos ni parámetros de conexión
adicionales. El usuario de la URL debe ser `vantara_pilot01_demo`. `localhost` se normaliza
  a 127.0.0.1 para evitar overrides DNS/hosts. Revisar el destino antes de las
  migraciones: los controles son del provisionador, no del comando general Prisma. No imprimir la
URL, contraseña ni contenido del entorno; no usar `set -x`.

El primer setup es atómico y requiere una base sin datos de aplicación. Repetir
setup valida identidades/roles/contraseñas y el grafo sintético completo:
propiedades con UUID de escenario, inventario/huésped/reserva únicos por propiedad,
relaciones del mismo tenant, solicitudes ligadas a esa reserva, tareas derivadas,
notificaciones/lecturas, sesiones y referencias de auditoría. CRM, billing, staff
operativo e incidentes no están permitidos en esta base. Una entidad desconocida
con datos también se rechaza. Esta validación termina antes de cualquier escritura; no cambia fechas, credenciales, historial ni enlaces. Un tercer
usuario/tenant, credenciales distintas o reservas ajenas provoca rechazo. No se
adopta ni sobrescribe una base preexistente. Un fallo revierte la transacción y
solo imprime un mensaje genérico. El script comprueba entorno/destino antes de
crear PrismaClient; utiliza un lock transaccional para serializar provisionado.

Ejecutar API y Web en terminales locales con el mismo entorno de demo:

```sh
# Terminal API
export WEB_ORIGIN=http://localhost:3000
pnpm --filter @vantara/api dev
# Terminal Web (otra terminal)
export API_INTERNAL_URL=http://localhost:3001
pnpm --filter @vantara/web dev
```

Abrir `http://localhost:3000/onboarding`, usar **Sign in** con
`admin-a@pilot01.example.invalid` y la contraseña suministrada. Hotel B usa
`admin-b@pilot01.example.invalid`, en otra sesión del navegador. No registrar
usuarios nuevos en esta base: el provisionador rechaza identidades ajenas.
La demo no necesita suscripción/Stripe: el sidebar muestra NO PLAN; Billing y
la creación de inventario que requiere entitlements quedan fuera del recorrido.

## Preparación de PostgreSQL y límites de privilegios

Solo el administrador de una **instancia nueva de demo**, nunca uno de producción,
crea `vantara_pilot01` y aplica las migraciones existentes con su URL privada.
Ejecutar `prisma migrate deploy` en esa base vacía requiere un rol distinto al
runtime. No ejecutar migraciones con `vantara_pilot01_demo` ni ampliar sus permisos
para hacerlas pasar. Revisar manualmente host/puerto/volumen antes de cualquier DDL.

Luego, dentro de una sesión psql privada conectada a esa base DEMO (sin `PG*` en
la terminal runtime), configurar lo siguiente. No hay contraseña default; `\password`
la pide sin mostrarla. Esto son instrucciones locales, no migraciones de producción:

```sql
CREATE ROLE vantara_pilot01_demo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
\password vantara_pilot01_demo
COMMENT ON DATABASE vantara_pilot01 IS 'VANTARA_PILOT01_LOCAL_SYNTHETIC_ONLY';
GRANT CONNECT ON DATABASE vantara_pilot01 TO vantara_pilot01_demo;
GRANT USAGE ON SCHEMA public TO vantara_pilot01_demo;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vantara_pilot01_demo;
GRANT INSERT, UPDATE, DELETE ON tenants, users, memberships, properties,
  room_types, rooms, guests, reservations, guest_connect_access, guest_requests,
  housekeeping_tasks, maintenance_tickets, notifications, notification_reads,
  sessions, audit_logs TO vantara_pilot01_demo;
```

No transferir propiedad de base/schema/tablas a este rol, ni conceder membresías,
privilegios DDL o permisos de escritura en billing/CRM/staff. Revisar grants PUBLIC
heredados en la instancia aislada; PostgreSQL puede dar CONNECT/TEMP por defecto.
El control read-only al empezar la transacción verifica la identidad de base/rol,
el marcador, que no sea réplica, ni rol elevado, ni propietario de objetos ni
creador de schemas/bases. Rechaza antes de locks/escrituras si no se cumplen.
El proceso `demo:*` nunca concede permisos, marca una base ni intenta corregir
una configuración rechazada. No es un sandbox para SQL arbitrario ni un mecanismo
para probar que un cluster contiene exclusivamente datos sintéticos.

## Reiniciar sin borrar

Con la misma configuración y contraseña:

```sh
pnpm --filter @vantara/api demo:reset
```

Reset no hace DROP, TRUNCATE, deleteMany ni actualizaciones de reservas/usuarios.
Revoca solo accesos de reservas DEMO de ambos hoteles y agrega una nueva propiedad,
habitación, huésped y reserva por hotel, con fechas relativas al reset (+2 días).
Conserva solicitudes, tareas e historial para revisión. Abrir la reserva más
reciente en Reservations y generar un enlace nuevo; los anteriores dejan de
funcionar. No se reinicia el proceso ni se borran sesiones hoteleras.

Setup repetido no refresca una estancia vencida: usar reset. Reset es deliberado
y agrega un escenario cada vez; no es un purge. Las habitaciones independientes
evitan conflictos con reservas antiguas. Eliminar archivos locales de credenciales
y cerrar navegadores al finalizar; nunca reutilizar esta base para datos reales.
No se ofrece un reset destructivo. Para una demo totalmente vacía, crear una
instancia PostgreSQL desechable nueva, manteniendo separado cualquier volumen viejo.

## Guion comercial de siete minutos (manual)

1. **0–1 min:** mostrar Hotel A → Reservations, reserva DEMO CONFIRMED, habitación
   101, fechas y huésped sintético. Generar Connect con la acción existente.
2. **1–2 min:** abrir el enlace privadamente en ventana incógnita. No capturar,
   publicar ni pegar tokens/URLs en consola, PR, tickets o grabaciones. Mostrar
   únicamente el contenido de la estancia, sin barra de direcciones.
3. **2–3 min:** desde My room pedir “DEMO towels”, categoría HOUSEKEEPING.
4. **3–4 min:** en Hotel A recibir notificación → View request → solicitud exacta.
5. **4–5 min:** Accept → Start work → Complete. La solicitud y la tarea de
   Housekeeping son entidades distintas: completar Requests no completa la tarea.
6. **5–6 min:** volver a Connect visible; esperar hasta 15 segundos de polling.
   La solicitud sale de Active requests; expandir History para ver COMPLETED.
7. **6–7 min:** mostrar aislamiento con Hotel B y explicar revocación. Regenerar
   o revocar desde Reservations y comprobar que la ventana anterior pierde acceso.

No presentar métricas sintéticas como resultados de un hotel real. La notificación
hotelera es realtime con cookie de login; Connect actualiza por polling mientras
está visible, no por WebSocket. Verificar CORS/WEB_ORIGIN si falta el toast. El
registro persistido en Notifications permite confirmar recepción aunque el socket
no esté conectado. No reintentar POST a ciegas después de un fallo de red.

## Tests y CI

```sh
pnpm --filter @vantara/api exec prisma generate
pnpm --filter @vantara/api test
pnpm --filter @vantara/api build
pnpm --filter @vantara/web build
# Solo sobre la misma base exclusiva, ya migrada; conserva datos DEMO anteriores:
NODE_ENV=test PILOT01_INTEGRATION=1 pnpm --filter @vantara/api test:pilot
```

La suite normal ejecuta guards de configuración sin abrir la base. La integración
se habilita explícitamente; rechaza destinos no DEMO antes de conectar. Si la base
ya tiene fixtures, proporcionar su misma PILOT01_PASSWORD; en CI se genera una
contraseña aleatoria efímera en memoria. Nunca se imprime un Connect token ni se
usa como valor de aserción: los fallos usan códigos genéricos.

API Security CI crea una base `vantara_pilot01` distinta de `vantara_ci`, aplica
solo migraciones existentes y ejecuta Nest/HTTP con PostgreSQL real: login,
CONFIRMED → emisión Connect → solicitud → notificación persistida →
ACKNOWLEDGED/IN_PROGRESS/COMPLETED → stay actualizado. Comprueba tenant A/B,
rechazo de tenantId en POST, hash-only storage, rotación, revocación, expiración,
reset sin pérdida de historial y ausencia de tokens en logs de aplicación/audit.
La conexión de ejecución usa un rol DML limitado, no el administrador de
migraciones. `pilot01-ci.cjs` configura ese rol y el marcador solo en la base nueva
creada en el servicio PostgreSQL desechable de GitHub Actions, con contraseña
aleatoria nunca impresa. El provisionador y la aplicación no hacen CREATE ROLE,
GRANT ni COMMENT. La prueba de corrupción compara hashes de todas las tablas
antes/después de cada rechazo (setup/reset), incluyendo relaciones cruzadas entre
huéspedes/reservas, propiedades, tareas, notificaciones/recibos, sesiones y auditoría.
Web CI compila y verifica `/`, `/onboarding` y `/connect/[token]` en el manifiesto.

## Evidencia y riesgos pendientes

El test HTTP demuestra estado/datos reales en PostgreSQL, **no** automatiza el
navegador, toast, polling visible ni expansión visual de History. Registrar la
aceptación manual como PASS/FAIL/NOT RUN con fecha/commit, sin URLs/token/credenciales.
Usar también `docs/CONNECT_V1_1_RELEASE.md`. No afirmar demo comercial validada
hasta ejecutar el guion en dos sesiones de navegador.

- Tokens bearer en el path pueden aparecer en logs de proxies, historial y
  capturas. Este PR verifica logs de aplicación/audit, no terceros: deshabilitar
  access logs o redactar `/connect/*` en el entorno local; no exponerlo públicamente.
- Connect conserva hasta 50 solicitudes; polling requiere pestaña visible.
- Hay una ventana entre validación de token y creación de solicitud: revocación
  concurrente con POST en vuelo sigue siendo deuda, no garantía de cancelación.
- Requests publica notificaciones después del commit; no hay outbox/replay.
  Un fallo de publicación puede dejar una solicitud persistida sin notificación.
- Requests permite PATCH de estado sin una máquina de transiciones estricta;
  la demo usa solo Accept/Start/Complete existentes, sin ampliar ese alcance.
- Reset conserva escenarios y crece la base. Los operadores deben mantenerla
  exclusiva, local y sintética. La validación estructural/etiquetas no demuestra
  que el contenido de mensajes libres carezca de información real: no introducirla.
- Un túnel SSH, port-forward, proxy TCP, Docker port mapping o sidecar puede escuchar
  en loopback. El nombre localhost/127.0.0.1/::1 **no certifica** el servidor remoto.
  Verificar el proceso que posee el puerto y el contenedor/volumen de la instancia,
  sin imprimir argumentos con credenciales. No usar túneles, backups reales ni
  credenciales reutilizadas. El marcador y el rol limitado reducen errores de
  destino, pero un servidor malicioso o un operador que los replique puede engañar
  estas comprobaciones. No hay atestación criptográfica/TLS del servidor local.
- Sin suscripción DEMO: no probar Billing, altas de Rooms/Staff ni capacidades
  fuera del Issue #35. No se cambia el esquema de producción ni la lógica existente.

Validación local: Prisma generate y API build aprobaron. Web build incluye las
rutas correctas. El sandbox local bloqueó sockets HTTP y memoria compartida de
PostgreSQL; por eso la suite completa tuvo fallos EPERM en tests HTTP ya existentes
y la integración PostgreSQL no se ejecutó localmente. CI es la evidencia de ese
recorrido. La verificación visual/comercial está NOT RUN hasta aceptación humana.

Referencias de los controles PostgreSQL:
[privilegios efectivos e identidad de sesión](https://www.postgresql.org/docs/18/functions-info.html),
[atributos de roles](https://www.postgresql.org/docs/18/sql-createrole.html),
[logs SQL y errores](https://www.postgresql.org/docs/18/runtime-config-logging.html).
El bootstrap CI desactiva el logging de sentencias solo en su transacción efímera
antes de generar el rol; no cambia configuración de servidores de producción.
