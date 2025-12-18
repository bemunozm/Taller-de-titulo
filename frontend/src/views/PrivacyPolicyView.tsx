import { Heading } from '@/components/ui/Heading'
import { Divider } from '@/components/ui/Divider'
import { Text } from '@/components/ui/Text'

export default function PrivacyPolicyView() {
  return (
    <div className="max-w-4xl mx-auto">
      <Heading>Política de Privacidad</Heading>
      <Divider className="my-6" />
      
      <div className="space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            1. Información que Recopilamos
          </h2>
          <Text>
            Recopilamos información personal que usted nos proporciona directamente, incluyendo:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Nombre completo y datos de contacto</li>
            <li>Información de residencia y unidad habitacional</li>
            <li>Datos de vehículos registrados (patente, marca, modelo, color)</li>
            <li>Información de visitas programadas</li>
            <li>Imágenes capturadas por el sistema de cámaras de seguridad</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            2. Uso de la Información
          </h2>
          <Text>
            Utilizamos la información recopilada para:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Gestionar el acceso y seguridad del condominio</li>
            <li>Automatizar el reconocimiento de vehículos autorizados</li>
            <li>Validar y registrar visitas</li>
            <li>Enviar notificaciones sobre eventos de seguridad</li>
            <li>Mantener registros de auditoría y trazabilidad</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            3. Reconocimiento de Patentes (LPR)
          </h2>
          <Text>
            Nuestro sistema utiliza tecnología de reconocimiento automático de patentes (LPR) que:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Captura imágenes de vehículos que ingresan o salen del condominio</li>
            <li>Procesa las imágenes mediante inteligencia artificial para detectar patentes</li>
            <li>Almacena las detecciones con fines de seguridad y auditoría</li>
            <li>Genera notificaciones automáticas a residentes cuando corresponde</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            4. Seguridad de los Datos
          </h2>
          <Text>
            Implementamos medidas de seguridad técnicas y organizativas para proteger su información personal:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Cifrado de datos sensibles</li>
            <li>Autenticación de dos factores</li>
            <li>Control de acceso basado en roles y permisos</li>
            <li>Registro de auditoría de todas las operaciones</li>
            <li>Almacenamiento seguro en servidores protegidos</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            5. Retención de Datos
          </h2>
          <Text>
            Conservamos su información personal durante el tiempo necesario para cumplir con los propósitos
            descritos en esta política, incluyendo:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Registros de detecciones: 90 días</li>
            <li>Registros de visitas: según configuración del administrador</li>
            <li>Logs de auditoría: 1 año</li>
            <li>Datos de usuarios activos: mientras mantenga su residencia</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            6. Sus Derechos
          </h2>
          <Text>
            Usted tiene derecho a:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Acceder a su información personal</li>
            <li>Solicitar la corrección de datos inexactos</li>
            <li>Solicitar la eliminación de sus datos (sujeto a requisitos legales)</li>
            <li>Oponerse al procesamiento de sus datos</li>
            <li>Retirar el consentimiento en cualquier momento</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            7. Compartir Información
          </h2>
          <Text>
            No compartimos su información personal con terceros, excepto:
          </Text>
          <ul className="list-disc list-inside mt-2 space-y-1 text-zinc-700 dark:text-zinc-300">
            <li>Cuando sea requerido por ley o autoridades competentes</li>
            <li>Con proveedores de servicios que nos ayudan a operar el sistema</li>
            <li>Con su consentimiento explícito</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            8. Contacto
          </h2>
          <Text>
            Para ejercer sus derechos o realizar consultas sobre esta política de privacidad,
            puede contactar al administrador del condominio o al responsable de datos personales.
          </Text>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-white mb-3">
            9. Cambios a esta Política
          </h2>
          <Text>
            Nos reservamos el derecho de actualizar esta política de privacidad en cualquier momento.
            Le notificaremos sobre cambios significativos publicando la nueva política en esta página
            y actualizando la fecha de "Última actualización".
          </Text>
          <Text className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            Última actualización: 8 de diciembre de 2025
          </Text>
        </section>
      </div>
    </div>
  )
}
