import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // El QR de una visita es una credencial de acceso: nada de su flujo
    // (crear, mostrar, escanear) se escribe en consola.
    files: ['src/components/visits/**/*.{ts,tsx}', 'src/views/QRScannerView.tsx'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Conserje digital (kiosko y respuesta del residente): la credencial del
    // kiosko, los sessionId/visitId y los payloads de la respuesta no van a
    // la consola de un dispositivo público ni a la del residente.
    files: [
      'src/api/ConciergeAPI.ts',
      'src/services/**/*.ts',
      'src/views/DigitalConciergeView.tsx',
      'src/components/concierge/**/*.{ts,tsx}',
      'src/components/VisitorApprovalDialog.tsx',
      'src/components/NotificationDetailModal.tsx',
      'src/components/GlobalApprovalDialogs.tsx',
      'src/helpers/kioskResidentResponse.ts',
      'src/helpers/residentResponseWatcher.ts',
      'src/helpers/httpErrors.ts',
      'src/hooks/useKioskCredential.ts',
      'src/hooks/useResidentResponseWatcher.ts',
      'src/hooks/useLongPress.ts',
      // Modo QR del kiosko: el contenido del QR es una credencial de acceso.
      'src/hooks/kiosk/**/*.{ts,tsx}',
      'src/helpers/kioskQr.ts',
      'src/helpers/kioskTimings.ts',
      // Recibe el payload de VISITOR_ARRIVAL (sessionId, visitId, datos del visitante).
      'src/hooks/useNotifications.ts',
      'src/helpers/kiosk.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Tiempo real de la sesión humana (P6): los payloads de `notification`,
    // los avisos de anomalías y sus fotos no van a la consola.
    files: [
      'src/components/RealtimeConnection.tsx',
      'src/components/GlobalSecurityNotifications.tsx',
      'src/helpers/securityAlerts.ts',
      'src/api/DetectionsAPI.ts',
      'src/hooks/useAuth.ts',
      'src/layouts/StackedLayout.tsx',
      'src/router.tsx',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Transparencia (P7.F): la política pública, el aviso del kiosko y la
    // descarga de los datos del titular (el export trae sus datos personales)
    // no escriben en consola.
    files: [
      'src/views/PrivacyPolicyView.tsx',
      'src/views/LandingPage.tsx',
      'src/components/landing/Hero.tsx',
      'src/components/landing/TechSection.tsx',
      'src/components/landing/FeatureGrid.tsx',
      'src/views/ProfileView.tsx',
      'src/layouts/AuthLayout.tsx',
      'src/components/privacy/**/*.{ts,tsx}',
      'src/components/profile/PrivacyDataSection.tsx',
      'src/api/PrivacyAPI.ts',
      'src/helpers/privacyPolicy.ts',
      'src/helpers/download.ts',
    ],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Correcciones de P7 (ciberseguridad y QA): el resumen del dashboard trae
    // nombres de visitantes; usuarios, auditoría y listas muestran datos
    // personales (y el estado de anonimización). Nada de eso a la consola.
    files: [
      'src/api/DashboardAPI.ts',
      'src/api/UserAPI.ts',
      'src/api/AuditAPI.ts',
      'src/types/index.ts',
      'src/types/audit.ts',
      'src/helpers/userDisplay.ts',
      'src/hooks/useUserOptions.ts',
      'src/components/users/UserTable.tsx',
      'src/components/users/UserForm.tsx',
      'src/components/audit/AuditLogsTable.tsx',
      'src/components/families/FamilyMembersModal.tsx',
      'src/components/resident-dashboard/MyFamilyCard.tsx',
      'src/components/profile/PersonalInfoSection.tsx',
      'src/views/TraceabilityDetailView.tsx',
      'src/components/landing/Pricing.tsx',
      'src/components/landing/DashboardMockup.tsx',
      'src/components/landing/AIIntelligenceComposition.tsx',
    ],
    rules: {
      'no-console': 'error',
    },
  },
])
