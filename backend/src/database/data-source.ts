// DataSource para el CLI de TypeORM (`npm run migration:*`). El runtime de Nest
// NO usa este archivo: ambos comparten `buildTypeOrmOptions` (una sola fuente).
// `dotenv/config` no pisa variables ya definidas en el entorno, así que
// `DB_NAME=otra_bd npm run migration:run` apunta a `otra_bd`.
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions, readerFromEnv } from './typeorm-options';

// `autoLoadEntities` es una opción de Nest que TypeORM ignora: el CLI descubre
// las entidades con el glob `entities` de las mismas opciones.
const options = buildTypeOrmOptions(readerFromEnv(process.env));

// El CLI exige exactamente UNA instancia de DataSource exportada.
export const AppDataSource = new DataSource(options);
