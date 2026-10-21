import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type {
  PassageDirection,
  PassageDirectionSource,
} from '../vehicle-passage-direction';

/**
 * Pasada de un vehículo (plan dirección + pasadas multicámara, E6): agrupa
 * todas las lecturas de UNA patente que ocurren dentro de la ventana
 * deslizante `LPR_PASSAGE_WINDOW_SECONDS`, vengan de la cámara que vengan.
 *
 * Una pasada tiene a lo sumo UN `AccessAttempt` (índice único parcial en
 * `access_attempts."passageId"`): ese intento es el único que notifica, abre
 * el portón o escala al conserje. Las demás lecturas son evidencia
 * (`plate_detections."passageId"`).
 *
 * La FK vive en el intento y no aquí: el intento pertenece a la pasada, la
 * pasada se crea ANTES que su intento (reclama la apertura bajo el advisory
 * lock) y borrar una pasada (compensación si el flujo falla) nunca debe
 * arrastrar un intento.
 */
@Entity({ name: 'vehicle_passages' })
@Index('IDX_vehicle_passages_org_plate_last_seen', [
  'organizationId',
  'plate',
  'lastSeenAt',
])
export class VehiclePassage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  organizationId: string;

  /** Patente normalizada (se enmascara con la retención, igual que la detección). */
  @Column({ type: 'varchar', length: 64 })
  plate: string;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  direction: PassageDirection;

  @Column({ type: 'varchar', length: 16, default: 'none' })
  directionSource: PassageDirectionSource;

  @Column({ type: 'timestamptz' })
  firstSeenAt: Date;

  /** Renueva la ventana: cada lectura nueva la mueve. */
  @Column({ type: 'timestamptz' })
  lastSeenAt: Date;

  /** Lecturas (detecciones) de la pasada, incluida la que la creó. */
  @Column({ type: 'int', default: 1 })
  sightingCount: number;

  /**
   * `true` si la pasada la lidera una cámara de ACCESO (decide el portón,
   * visitas y conserje); `false` si la lidera una cámara de solo registro
   * (su intento es `Registrado`). Una lectura de una cámara de acceso sobre una
   * pasada `false` la PROMUEVE (claim atómico) y actualiza ese intento.
   */
  @Column({ type: 'boolean', default: true })
  decidesAccess: boolean;

  /**
   * Cuándo el líder actual tomó la pasada. Permite que una pasada SIN intento
   * (líder caído) ceda el liderazgo tras `LPR_PASSAGE_ORPHAN_SECONDS`.
   */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  leaderClaimedAt: Date;

  /**
   * Token del líder VIGENTE de la pasada (uuid). Cada toma de liderazgo (pasada
   * nueva, promoción, huérfana) lo renueva bajo el lock; `saveAttempt` solo
   * escribe si el llamador conserva el token. Un líder lento que ya perdió la
   * pasada no puede escribir ni, por tanto, abrir el portón.
   */
  @Column({ type: 'uuid' })
  leaderToken: string;

  /**
   * `true` si el `method` del intento ("Patente - Entrada/Salida/Registro")
   * sale de `direction` y por eso se actualiza cuando llega una fuente de
   * mayor prioridad. `false` para intentos cuyo método lo fija otra lógica
   * (visitas: estado + espera; pendientes del conserje).
   */
  @Column({ type: 'boolean', default: false })
  methodFollowsDirection: boolean;

  /** Cuándo se enmascaró la patente por retención/supresión. */
  @Column({ type: 'timestamptz', nullable: true })
  anonymizedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
