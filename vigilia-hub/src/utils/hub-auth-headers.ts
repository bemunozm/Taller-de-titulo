/**
 * Credencial del hub ante el backend (`HubAuthGuard`): el `hubId` dice QUÉ
 * hub llama y el secret propio de ese hub lo autentica. El backend exige los
 * dos headers: con solo `X-Hub-Secret` responde 401.
 *
 * Fase 4 · P6.M: la credencial sale de la config validada al arrancar
 * (`loadHubConfig`, src/config.ts), que exige `HUB_ID` y `HUB_SECRET`; ya no
 * se lee `process.env` acá.
 */
export interface HubCredentials {
  hubId: string;
  hubSecret: string;
}

/** Headers HTTP de autenticación del hub (`X-Hub-Id` + `X-Hub-Secret`). */
export function hubAuthHeaders(credentials: HubCredentials): Record<string, string> {
  return {
    'X-Hub-Id': credentials.hubId,
    'X-Hub-Secret': credentials.hubSecret,
  };
}
