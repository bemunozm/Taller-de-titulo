import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración base consolidada (Fase 4 · P2 · D1, docs/modulos/hardening-pre-piloto.md).
 *
 * Crea el esquema COMPLETO sobre una BD vacía, en este orden:
 *   1. `pgcrypto` (`gen_random_uuid()`; `uuidExtension` de typeorm-options.ts).
 *   2. Tablas de TypeORM: generadas con `migration:generate` desde las
 *      entidades sobre una BD vacía. Incluye `user`, que better-auth reutiliza.
 *   3. Tablas de better-auth (session, account, verification, organization,
 *      member, invitation, apikey, rateLimit): SQL generado con su CLI
 *      (`npx auth@1.6.23 generate`, la misma versión instalada) para la config y
 *      plugins reales de src/auth/better-auth.ts, ejecutado DESPUÉS de crear
 *      las tablas TypeORM para que solo emitiera el diff (sin tocar `user`).
 *
 * Reemplaza a las migraciones de `migrations/legacy/` (ver su README). Los
 * datos semilla (roles y permisos, incluido `platform.manage-hubs`) NO van
 * aquí: los siembra `DataInitializationService` al arrancar.
 *
 * Si cambia la config o los plugins de better-auth, generar el diff con su CLI
 * y agregarlo como una migración NUEVA (no editar esta).
 *
 * Regenerada (antes de aplicarse en cualquier ambiente) en la ronda de
 * correcciones de P2: `user` ya no tiene la columna `password` (la única
 * credencial es `account.password` de better-auth, hallazgo A1).
 */
export class InitialSchema1791472216949 implements MigrationInterface {
  name = 'InitialSchema1791472216949';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- 1. Extensiones ------------------------------------------------
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // --- 2. Tablas TypeORM (migration:generate) ------------------------
    await queryRunner.query(
      `CREATE TABLE "permission" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "description" character varying(255) NOT NULL, "module" character varying(50) NOT NULL, "action" character varying(50) NOT NULL, CONSTRAINT "UQ_240853a0c3353c25fb12434ad33" UNIQUE ("name"), CONSTRAINT "PK_3b8b97af9d9d8807e41e6f48362" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "camera" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "name" character varying(150) NOT NULL, "location" character varying(200), "encryptedSourceUrl" text, "mountPath" character varying(150), "registeredInMediamtx" boolean NOT NULL DEFAULT false, "enableLpr" boolean NOT NULL DEFAULT false, "enableGuardian" boolean NOT NULL DEFAULT false, "guardianZones" jsonb DEFAULT '[]', "active" boolean NOT NULL DEFAULT true, CONSTRAINT "UQ_8158177275e0755021be657b7fa" UNIQUE ("mountPath"), CONSTRAINT "PK_3e6992bc5e67b9f9a6f95a5fe6f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9e186b5b582af8a0de9eaaa74" ON "camera" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "role" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "description" character varying, CONSTRAINT "UQ_ae4578dcaed5adff96595e61660" UNIQUE ("name"), CONSTRAINT "PK_b36bcfe02fc8de3c57a8b2391c2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "token" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "token" character varying(6) NOT NULL, "userId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_82fae97f905930df5d62a702fc9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "units" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "block" character varying(10), "number" character varying(10) NOT NULL, "identifier" character varying(20) NOT NULL, "floor" integer, "type" character varying(50), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d124fa977ca6c41f5c84801e8ea" UNIQUE ("identifier"), CONSTRAINT "PK_5a8f2f064919b587d93936cb223" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b5b8cd84ab78d99783a0aeafba" ON "units" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "families" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "name" character varying(128) NOT NULL, "description" character varying(256), "active" boolean NOT NULL DEFAULT true, "digitalConciergeEnabled" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "unit_id" uuid, CONSTRAINT "PK_70414ac0c8f45664cf71324b9bb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_072c558566ea2a62a6ef6b2e12" ON "families" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "name" character varying(100) NOT NULL, "email" character varying NOT NULL, "emailVerified" boolean NOT NULL DEFAULT false, "image" character varying(512), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "rut" character varying(50) NOT NULL, "phone" character varying(15) NOT NULL, "age" integer, "profilePicture" character varying(512), "deletedAt" TIMESTAMP WITH TIME ZONE, "familyId" uuid, CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"), CONSTRAINT "UQ_9f839e522b3b8c8c8223cde81db" UNIQUE ("rut"), CONSTRAINT "UQ_8e1f623798118e629b46a9e6299" UNIQUE ("phone"), CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "vehicles" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "plate" character varying(16) NOT NULL, "brand" character varying(128), "model" character varying(64), "color" character varying(32), "year" integer, "vehicleType" character varying(32), "accessLevel" character varying(64), "active" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "ownerId" uuid, CONSTRAINT "UQ_ec7181ebdab798d97070122a5bf" UNIQUE ("plate"), CONSTRAINT "PK_18d8646b59304dce4af3a9e35b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_664beec1edf19bf68494a3def7" ON "vehicles" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visits_type_enum" AS ENUM('vehicular', 'pedestrian')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visits_status_enum" AS ENUM('pending', 'active', 'ready', 'completed', 'cancelled', 'expired', 'denied')`,
    );
    await queryRunner.query(
      `CREATE TABLE "visits" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "type" "public"."visits_type_enum" NOT NULL, "status" "public"."visits_status_enum" NOT NULL DEFAULT 'pending', "visitorName" character varying(128) NOT NULL, "visitorRut" character varying(32), "visitorPhone" character varying(15), "reason" character varying(256), "qrCode" character varying(64), "maxUses" integer, "usedCount" integer NOT NULL DEFAULT '0', "validFrom" TIMESTAMP WITH TIME ZONE NOT NULL, "validUntil" TIMESTAMP WITH TIME ZONE NOT NULL, "entryTime" TIMESTAMP WITH TIME ZONE, "exitTime" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "hostId" uuid NOT NULL, "familyId" uuid, "vehicleId" uuid, CONSTRAINT "UQ_6c981008b9b47edc0d4d10a2f3b" UNIQUE ("qrCode"), CONSTRAINT "PK_0b0b322289a41015c6ea4e8bf30" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5168adc41818dc234a75c457ff" ON "visits" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."hubs_type_enum" AS ENUM('physical-hub', 'web-kiosk')`,
    );
    await queryRunner.query(
      `CREATE TABLE "hubs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "type" "public"."hubs_type_enum" NOT NULL DEFAULT 'physical-hub', "organizationId" uuid, "hubId" character varying(64) NOT NULL, "secretHash" character varying(255), "location" character varying(256) NOT NULL, "description" character varying(128), "active" boolean NOT NULL DEFAULT true, "firmwareVersion" character varying(64), "config" jsonb, "lastSeen" TIMESTAMP WITH TIME ZONE, "ipAddress" character varying(45), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_6901bda54bd4a0565c990c783b2" UNIQUE ("hubId"), CONSTRAINT "PK_44b53d1f2b4568b26ce4710b843" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6d261034abd6f96a727248cef3" ON "hubs" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."concierge_sessions_status_enum" AS ENUM('active', 'completed', 'cancelled', 'timeout')`,
    );
    await queryRunner.query(
      `CREATE TABLE "concierge_sessions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "sessionId" character varying(64) NOT NULL, "status" "public"."concierge_sessions_status_enum" NOT NULL DEFAULT 'active', "visitorName" character varying(128), "visitorRut" character varying(32), "visitorPhone" character varying(15), "vehiclePlate" character varying(10), "visitReason" character varying(256), "destinationHouse" character varying(50), "residentsNotified" jsonb, "residentResponse" character varying(20), "visitorSocketId" character varying(64), "hubId" character varying(64), "source" character varying(16) NOT NULL DEFAULT 'web', "organizationId" uuid, "transcript" jsonb, "functionCalls" jsonb, "startTime" TIMESTAMP WITH TIME ZONE, "endTime" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "createdVisitId" uuid, CONSTRAINT "UQ_3670880c3352209d50f962f4455" UNIQUE ("sessionId"), CONSTRAINT "PK_d65bdd456b8ce5c017cabbd25a6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_31ce94b9a6f4f2544d7d4b200d" ON "concierge_sessions" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_type_enum" AS ENUM('VISIT_CHECK_IN', 'VISIT_CHECK_OUT', 'VISIT_APPROVED', 'VISIT_REJECTED', 'VISIT_EXPIRING_SOON', 'VISIT_EXPIRED', 'VISIT_COMPLETED', 'VISITOR_ARRIVAL', 'ACCESS_DENIED', 'VEHICLE_DETECTED', 'UNKNOWN_VEHICLE', 'VEHICLE_REGISTERED', 'VEHICLE_UPDATED', 'VEHICLE_REMOVED', 'SYSTEM_ALERT', 'SYSTEM_INFO', 'FAMILY_UPDATE', 'FAMILY_INVITATION', 'FAMILY_MEMBER_ADDED', 'FAMILY_MEMBER_REMOVED')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."notifications_priority_enum" AS ENUM('low', 'normal', 'high', 'urgent')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "type" "public"."notifications_type_enum" NOT NULL, "title" character varying(255) NOT NULL, "message" text NOT NULL, "priority" "public"."notifications_priority_enum" NOT NULL DEFAULT 'normal', "read" boolean NOT NULL DEFAULT false, "readAt" TIMESTAMP WITH TIME ZONE, "data" jsonb, "recipientId" uuid NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "expiresAt" TIMESTAMP WITH TIME ZONE, "requiresAction" boolean NOT NULL DEFAULT false, "actionTaken" boolean NOT NULL DEFAULT false, "actionData" jsonb, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_928914a0743f50e6f83a90cdda" ON "notifications" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bcfc7d46c65238ce3316531aa0" ON "notifications" ("type", "read") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_22dbdf106e7981d0d8e1aed884" ON "notifications" ("recipientId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2f84f6c87460c75721bd93ac7" ON "notifications" ("recipientId", "read") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."system_logs_level_enum" AS ENUM('DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."system_logs_type_enum" AS ENUM('HTTP_REQUEST', 'HTTP_RESPONSE', 'MEDIAMTX_API', 'WORKER_API', 'OPENAI_API', 'DATABASE', 'WEBSOCKET', 'STREAM', 'DETECTION', 'NOTIFICATION', 'SYSTEM', 'EXCEPTION', 'AGENT_TOOL_CALL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."system_logs_service_enum" AS ENUM('BACKEND', 'MEDIAMTX', 'WORKER_PYTHON', 'OPENAI', 'DATABASE', 'REDIS', 'FRONTEND')`,
    );
    await queryRunner.query(
      `CREATE TABLE "system_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "level" "public"."system_logs_level_enum" NOT NULL DEFAULT 'INFO', "type" "public"."system_logs_type_enum" NOT NULL, "service" "public"."system_logs_service_enum" NOT NULL, "message" character varying(500) NOT NULL, "method" character varying(10), "url" text, "statusCode" integer, "responseTime" integer, "requestData" jsonb, "responseData" jsonb, "errorMessage" text, "stackTrace" text, "metadata" jsonb, "correlationId" character varying, "ipAddress" character varying, "userAgent" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_56861c4b9d16aa90259f4ce0a2c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f928fcab8ffa4ba3accec1fec6" ON "system_logs" ("correlationId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1b67a729179c827ffbd4a0d2dc" ON "system_logs" ("statusCode") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f2b0a6746d1887539e35eb04e0" ON "system_logs" ("service", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_96d03ca4a1ff54669cca86d306" ON "system_logs" ("type", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1a851fe4dad0e1394965f59831" ON "system_logs" ("level", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "plate_detections" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "cameraId" character varying(128) NOT NULL, "plate" character varying(64) NOT NULL, "plate_raw" character varying(64), "det_confidence" double precision, "ocr_confidence" double precision, "full_frame_path" character varying(1024), "meta" jsonb, "detectionTimestamp" bigint, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9262363db4a929291606ed95e2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_35cd90b19724242c545ab3f1f3" ON "plate_detections" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "access_attempts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "method" character varying(128), "decision" character varying(64) NOT NULL, "reason" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "expiresAt" TIMESTAMP WITH TIME ZONE, "respondedAt" TIMESTAMP WITH TIME ZONE, "notificationId" uuid, "responseTimeMs" integer, "residente_id" uuid, "detectionId" uuid, "responded_by_id" uuid, CONSTRAINT "PK_b53f502ff110c98d60fd4fabd88" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f9505cb509d7bc7d9eefde113d" ON "access_attempts" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_module_enum" AS ENUM('AUTH', 'USERS', 'ROLES', 'PERMISSIONS', 'FAMILIES', 'CAMERAS', 'STREAMS', 'VISITS', 'VEHICLES', 'DETECTIONS', 'NOTIFICATIONS', 'DIGITAL_CONCIERGE', 'MEDIAMTX')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."audit_logs_action_enum" AS ENUM('CREATE', 'READ', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'ACCOUNT_CONFIRM', 'PERMISSION_GRANT', 'PERMISSION_REVOKE', 'ROLE_ASSIGN', 'ROLE_UNASSIGN', 'CAMERA_REGISTER', 'CAMERA_LPR_ENABLE', 'CAMERA_LPR_DISABLE', 'CAMERA_ACTIVATE', 'CAMERA_DEACTIVATE', 'VISIT_APPROVE', 'VISIT_REJECT', 'VISIT_CHECK_IN', 'VISIT_CHECK_OUT', 'VISIT_QR_VALIDATE', 'DETECTION_CREATED', 'DETECTION_MATCHED', 'VEHICLE_REGISTER', 'VEHICLE_AUTHORIZE', 'VEHICLE_REVOKE', 'FAMILY_MEMBER_ADD', 'FAMILY_MEMBER_REMOVE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "module" "public"."audit_logs_module_enum" NOT NULL, "action" "public"."audit_logs_action_enum" NOT NULL, "userId" uuid, "entityId" character varying, "entityType" character varying, "oldValue" jsonb, "newValue" jsonb, "metadata" jsonb, "description" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13c69424c440a0e765053feb4b" ON "audit_logs" ("entityType", "entityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0ec936941eb8556fcd7a1f0eae" ON "audit_logs" ("action", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_99e589da8f9e9326ee0d01a028" ON "audit_logs" ("userId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e7bc351ddbd7a760a544c48509" ON "audit_logs" ("module", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "anomaly_events" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "organizationId" uuid, "cameraId" character varying(255) NOT NULL, "anomalyType" character varying(100) NOT NULL, "confidence" double precision NOT NULL, "snapshotJpegB64" text, "durationSeconds" integer, "trackId" integer, "suspicionLevel" character varying(20), "aiReasoning" text, "timestamp" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0752f992b16e60cf7d49d614976" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4cabb22311048ff43601eb65b1" ON "anomaly_events" ("organizationId") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."pending_actions_status_enum" AS ENUM('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "pending_actions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "tenantId" uuid, "sessionId" uuid, "toolName" character varying(128) NOT NULL, "input" jsonb NOT NULL, "requestId" character varying(64) NOT NULL, "status" "public"."pending_actions_status_enum" NOT NULL DEFAULT 'pending', "contextSnapshot" jsonb, "result" jsonb, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "resolvedBy" uuid, "resolvedAt" TIMESTAMP WITH TIME ZONE, "lastError" text, CONSTRAINT "PK_ce4a91f62be035bef4054e35fde" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14ac45284bcb768f5fbed6f9cd" ON "pending_actions" ("tenantId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f5858efd7128ed2127432c124" ON "pending_actions" ("sessionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e28ee0ad7173211c5b8ee79274" ON "pending_actions" ("status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "camera_roles" ("cameraId" uuid NOT NULL, "roleId" uuid NOT NULL, CONSTRAINT "PK_52fcdbb3fc42112f2696da28cdb" PRIMARY KEY ("cameraId", "roleId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_db66e45c5f9636da3edf4d3491" ON "camera_roles" ("cameraId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c32f2f74c243d37cdf391f136c" ON "camera_roles" ("roleId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "role_permissions_permission" ("roleId" uuid NOT NULL, "permissionId" uuid NOT NULL, CONSTRAINT "PK_b817d7eca3b85f22130861259dd" PRIMARY KEY ("roleId", "permissionId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b36cb2e04bc353ca4ede00d87b" ON "role_permissions_permission" ("roleId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bfbc9e263d4cea6d7a8c9eb3ad" ON "role_permissions_permission" ("permissionId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles_role" ("userId" uuid NOT NULL, "roleId" uuid NOT NULL, CONSTRAINT "PK_b47cd6c84ee205ac5a713718292" PRIMARY KEY ("userId", "roleId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5f9286e6c25594c6b88c108db7" ON "user_roles_role" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4be2f7adf862634f5f803d246b" ON "user_roles_role" ("roleId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "token" ADD CONSTRAINT "FK_94f168faad896c0786646fa3d4a" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "families" ADD CONSTRAINT "FK_065a37e40481c3120b7529cf515" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD CONSTRAINT "FK_d0e67d3ce8cbe4f407afe228a1b" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" ADD CONSTRAINT "FK_c0a0d32b2ae04801d6e5b9e5c80" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_e8aabbe50908c370080de14dea0" FOREIGN KEY ("hostId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_4f0f729c70f17840a0380992904" FOREIGN KEY ("familyId") REFERENCES "families"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" ADD CONSTRAINT "FK_714f680682430c4e5a3b8e4f5a7" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" ADD CONSTRAINT "FK_6376d2c152ccdb8c87ef72735e5" FOREIGN KEY ("createdVisitId") REFERENCES "visits"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_db873ba9a123711a4bff527ccd5" FOREIGN KEY ("recipientId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" ADD CONSTRAINT "FK_a5b04d223acddaf9deadabc147b" FOREIGN KEY ("residente_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" ADD CONSTRAINT "FK_1a88127ec04f6dd85dc3c343284" FOREIGN KEY ("detectionId") REFERENCES "plate_detections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" ADD CONSTRAINT "FK_3dc0aab1fa84c5a4995e449a3fc" FOREIGN KEY ("responded_by_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" ADD CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "camera_roles" ADD CONSTRAINT "FK_db66e45c5f9636da3edf4d3491d" FOREIGN KEY ("cameraId") REFERENCES "camera"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "camera_roles" ADD CONSTRAINT "FK_c32f2f74c243d37cdf391f136ca" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions_permission" ADD CONSTRAINT "FK_b36cb2e04bc353ca4ede00d87b9" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions_permission" ADD CONSTRAINT "FK_bfbc9e263d4cea6d7a8c9eb3ad2" FOREIGN KEY ("permissionId") REFERENCES "permission"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles_role" ADD CONSTRAINT "FK_5f9286e6c25594c6b88c108db77" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles_role" ADD CONSTRAINT "FK_4be2f7adf862634f5f803d246b8" FOREIGN KEY ("roleId") REFERENCES "role"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    // --- 3. Tablas better-auth (SQL de `npx auth@1.6.23 generate`) -----
    await queryRunner.query(
      `create table "session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references "user" ("id") on delete cascade, "activeOrganizationId" text)`,
    );
    await queryRunner.query(
      `create table "account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null)`,
    );
    await queryRunner.query(
      `create table "verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null)`,
    );
    await queryRunner.query(
      `create table "organization" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text)`,
    );
    await queryRunner.query(
      `create table "member" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "organizationId" uuid not null references "organization" ("id") on delete cascade, "userId" uuid not null references "user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null)`,
    );
    await queryRunner.query(
      `create table "invitation" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "organizationId" uuid not null references "organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" uuid not null references "user" ("id") on delete cascade)`,
    );
    await queryRunner.query(
      `create table "apikey" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" timestamptz, "enabled" boolean, "rateLimitEnabled" boolean, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" timestamptz, "expiresAt" timestamptz, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, "permissions" text, "metadata" text)`,
    );
    await queryRunner.query(
      `create table "rateLimit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null)`,
    );
    await queryRunner.query(
      `create index "session_userId_idx" on "session" ("userId")`,
    );
    await queryRunner.query(
      `create index "account_userId_idx" on "account" ("userId")`,
    );
    await queryRunner.query(
      `create index "verification_identifier_idx" on "verification" ("identifier")`,
    );
    await queryRunner.query(
      `create unique index "organization_slug_uidx" on "organization" ("slug")`,
    );
    await queryRunner.query(
      `create index "member_organizationId_idx" on "member" ("organizationId")`,
    );
    await queryRunner.query(
      `create index "member_userId_idx" on "member" ("userId")`,
    );
    await queryRunner.query(
      `create index "invitation_organizationId_idx" on "invitation" ("organizationId")`,
    );
    await queryRunner.query(
      `create index "invitation_email_idx" on "invitation" ("email")`,
    );
    await queryRunner.query(
      `create index "apikey_configId_idx" on "apikey" ("configId")`,
    );
    await queryRunner.query(
      `create index "apikey_referenceId_idx" on "apikey" ("referenceId")`,
    );
    await queryRunner.query(
      `create index "apikey_key_idx" on "apikey" ("key")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // --- 3. Tablas better-auth (sus índices caen con cada tabla) --------
    await queryRunner.query(`DROP TABLE "rateLimit"`);
    await queryRunner.query(`DROP TABLE "apikey"`);
    await queryRunner.query(`DROP TABLE "invitation"`);
    await queryRunner.query(`DROP TABLE "member"`);
    await queryRunner.query(`DROP TABLE "organization"`);
    await queryRunner.query(`DROP TABLE "verification"`);
    await queryRunner.query(`DROP TABLE "account"`);
    await queryRunner.query(`DROP TABLE "session"`);

    // --- 2. Tablas TypeORM ---------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "user_roles_role" DROP CONSTRAINT "FK_4be2f7adf862634f5f803d246b8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles_role" DROP CONSTRAINT "FK_5f9286e6c25594c6b88c108db77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions_permission" DROP CONSTRAINT "FK_bfbc9e263d4cea6d7a8c9eb3ad2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions_permission" DROP CONSTRAINT "FK_b36cb2e04bc353ca4ede00d87b9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camera_roles" DROP CONSTRAINT "FK_c32f2f74c243d37cdf391f136ca"`,
    );
    await queryRunner.query(
      `ALTER TABLE "camera_roles" DROP CONSTRAINT "FK_db66e45c5f9636da3edf4d3491d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_cfa83f61e4d27a87fcae1e025ab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" DROP CONSTRAINT "FK_3dc0aab1fa84c5a4995e449a3fc"`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" DROP CONSTRAINT "FK_1a88127ec04f6dd85dc3c343284"`,
    );
    await queryRunner.query(
      `ALTER TABLE "access_attempts" DROP CONSTRAINT "FK_a5b04d223acddaf9deadabc147b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_db873ba9a123711a4bff527ccd5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "concierge_sessions" DROP CONSTRAINT "FK_6376d2c152ccdb8c87ef72735e5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_714f680682430c4e5a3b8e4f5a7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_4f0f729c70f17840a0380992904"`,
    );
    await queryRunner.query(
      `ALTER TABLE "visits" DROP CONSTRAINT "FK_e8aabbe50908c370080de14dea0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vehicles" DROP CONSTRAINT "FK_c0a0d32b2ae04801d6e5b9e5c80"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP CONSTRAINT "FK_d0e67d3ce8cbe4f407afe228a1b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "families" DROP CONSTRAINT "FK_065a37e40481c3120b7529cf515"`,
    );
    await queryRunner.query(
      `ALTER TABLE "token" DROP CONSTRAINT "FK_94f168faad896c0786646fa3d4a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4be2f7adf862634f5f803d246b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5f9286e6c25594c6b88c108db7"`,
    );
    await queryRunner.query(`DROP TABLE "user_roles_role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bfbc9e263d4cea6d7a8c9eb3ad"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b36cb2e04bc353ca4ede00d87b"`,
    );
    await queryRunner.query(`DROP TABLE "role_permissions_permission"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c32f2f74c243d37cdf391f136c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_db66e45c5f9636da3edf4d3491"`,
    );
    await queryRunner.query(`DROP TABLE "camera_roles"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e28ee0ad7173211c5b8ee79274"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f5858efd7128ed2127432c124"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14ac45284bcb768f5fbed6f9cd"`,
    );
    await queryRunner.query(`DROP TABLE "pending_actions"`);
    await queryRunner.query(`DROP TYPE "public"."pending_actions_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4cabb22311048ff43601eb65b1"`,
    );
    await queryRunner.query(`DROP TABLE "anomaly_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e7bc351ddbd7a760a544c48509"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_99e589da8f9e9326ee0d01a028"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0ec936941eb8556fcd7a1f0eae"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13c69424c440a0e765053feb4b"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_action_enum"`);
    await queryRunner.query(`DROP TYPE "public"."audit_logs_module_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f9505cb509d7bc7d9eefde113d"`,
    );
    await queryRunner.query(`DROP TABLE "access_attempts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_35cd90b19724242c545ab3f1f3"`,
    );
    await queryRunner.query(`DROP TABLE "plate_detections"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1a851fe4dad0e1394965f59831"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_96d03ca4a1ff54669cca86d306"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f2b0a6746d1887539e35eb04e0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1b67a729179c827ffbd4a0d2dc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f928fcab8ffa4ba3accec1fec6"`,
    );
    await queryRunner.query(`DROP TABLE "system_logs"`);
    await queryRunner.query(`DROP TYPE "public"."system_logs_service_enum"`);
    await queryRunner.query(`DROP TYPE "public"."system_logs_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."system_logs_level_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2f84f6c87460c75721bd93ac7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_22dbdf106e7981d0d8e1aed884"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bcfc7d46c65238ce3316531aa0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_928914a0743f50e6f83a90cdda"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_priority_enum"`);
    await queryRunner.query(`DROP TYPE "public"."notifications_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_31ce94b9a6f4f2544d7d4b200d"`,
    );
    await queryRunner.query(`DROP TABLE "concierge_sessions"`);
    await queryRunner.query(
      `DROP TYPE "public"."concierge_sessions_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6d261034abd6f96a727248cef3"`,
    );
    await queryRunner.query(`DROP TABLE "hubs"`);
    await queryRunner.query(`DROP TYPE "public"."hubs_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5168adc41818dc234a75c457ff"`,
    );
    await queryRunner.query(`DROP TABLE "visits"`);
    await queryRunner.query(`DROP TYPE "public"."visits_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."visits_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_664beec1edf19bf68494a3def7"`,
    );
    await queryRunner.query(`DROP TABLE "vehicles"`);
    await queryRunner.query(`DROP TABLE "user"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_072c558566ea2a62a6ef6b2e12"`,
    );
    await queryRunner.query(`DROP TABLE "families"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b5b8cd84ab78d99783a0aeafba"`,
    );
    await queryRunner.query(`DROP TABLE "units"`);
    await queryRunner.query(`DROP TABLE "token"`);
    await queryRunner.query(`DROP TABLE "role"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9e186b5b582af8a0de9eaaa74"`,
    );
    await queryRunner.query(`DROP TABLE "camera"`);
    await queryRunner.query(`DROP TABLE "permission"`);

    // --- 1. `pgcrypto` NO se elimina: es de la BD (puede haber otros
    // objetos que dependan de ella) y `CREATE EXTENSION IF NOT EXISTS` es
    // idempotente al volver a subir.
  }
}
