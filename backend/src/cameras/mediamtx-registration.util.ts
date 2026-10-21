/**
 * ¿El backend registra las cámaras en MediaMTX? (`CAMERAS_REGISTER_IN_MEDIAMTX`,
 * sin distinguir mayúsculas, igual que `CamerasService`). Sin registro, los
 * paths se configuran a mano y el backend no los re-registra ni resincroniza
 * (Fase 4 · P6.M, corrección QA).
 */
export function isMediamtxRegistrationEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    (env.CAMERAS_REGISTER_IN_MEDIAMTX ?? '').trim().toLowerCase() === 'true'
  );
}
