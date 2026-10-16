# Migraciones legacy (NO se ejecutan)

Estas 8 migraciones son históricas. Se conservan solo como referencia y **no las
ejecuta nadie**: el glob de migraciones de `src/database/typeorm-options.ts`
(`migrations/*.{ts,js}`) es de un solo nivel y no entra a esta carpeta.

## Por qué se retiraron (Fase 4 · P2 · D1)

- **Parcheaban un esquema que nunca crearon.** Hasta la Fase 4 el esquema lo
  creaba `synchronize: true` de TypeORM. Estas migraciones solo agregaban
  columnas o datos encima de ese esquema, así que sobre una BD vacía fallan.
- **`1707754800000-AddHubSupportAndDigitalConcierge` está rota:**
  - Usa columnas `snake_case` que no coinciden con las entidades, que son
    `camelCase`.
  - Llama a `uuid_generate_v4()` sin crear la extensión `uuid-ossp`.
- **No existe producción**, así que no hay ninguna BD que dependa de su
  historial.

## Qué las reemplaza

`src/migrations/1791472216949-InitialSchema.ts` crea el esquema completo sobre
una BD vacía:

1. Extensión `pgcrypto`.
2. Tablas de TypeORM, generadas desde las entidades.
3. Tablas de better-auth, con el SQL de su CLI.

Lo que estas migraciones sembraban como **datos** lo cubre otro mecanismo:

| Migración legacy | Qué hacía | Dónde vive ahora |
|---|---|---|
| `AddPlatformManageHubsPermission` | Insertaba el permiso `platform.manage-hubs` y se lo asignaba al Super Administrador | `DEFAULT_PERMISSIONS` + `DataInitializationService` al arrancar (el Super Administrador recibe todos los permisos) |
| `BackfillVisitsOrganizationId` | Rellenaba `visits.organizationId` en filas viejas | No aplica: las BD se recrean vacías |

Los cambios de esquema futuros se hacen con migraciones **incrementales** nuevas
(`npm run migration:generate -- src/migrations/<Nombre>`), nunca editando la
migración base ni moviendo archivos de esta carpeta de vuelta.
