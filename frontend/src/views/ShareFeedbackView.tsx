import { useState } from 'react'
import { Heading } from '@/components/ui/Heading'
import { Divider } from '@/components/ui/Divider'
import { Text } from '@/components/ui/Text'
import { Button } from '@/components/ui/Button'
import { Field, Label } from '@/components/ui/Fieldset'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/TextArea'
import { Select } from '@/components/ui/Select'
import { toast } from 'react-toastify'
import { useAuth } from '@/hooks/useAuth'

export default function ShareFeedbackView() {
  const { data: user } = useAuth()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    category: 'suggestion',
    subject: '',
    message: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      // Simular envío de feedback
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      toast.success('¡Gracias por tus comentarios! Tu mensaje ha sido enviado correctamente.')
      
      // Limpiar formulario
      setFormData({
        category: 'suggestion',
        subject: '',
        message: '',
      })
    } catch (error) {
      toast.error('Error al enviar el mensaje. Por favor, intenta nuevamente.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Heading>Enviar Comentarios</Heading>
      <Divider className="my-6" />
      
      <div className="space-y-6">
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
          <Text className="text-blue-900 dark:text-blue-100">
            Tus comentarios son muy importantes para nosotros. Ayúdanos a mejorar el sistema
            compartiendo tus sugerencias, reportando problemas o haciéndonos saber qué te gusta.
          </Text>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Field>
            <Label>Categoría</Label>
            <Select
              name="category"
              value={formData.category}
              onChange={handleChange}
              required
            >
              <option value="suggestion">💡 Sugerencia</option>
              <option value="bug">🐛 Reportar Error</option>
              <option value="feature">✨ Nueva Funcionalidad</option>
              <option value="compliment">👍 Comentario Positivo</option>
              <option value="other">💬 Otro</option>
            </Select>
          </Field>

          <Field>
            <Label>Nombre</Label>
            <Input
              type="text"
              value={user?.name || ''}
              disabled
              className="bg-zinc-100 dark:bg-zinc-800"
            />
          </Field>

          <Field>
            <Label>Email</Label>
            <Input
              type="email"
              value={user?.email || ''}
              disabled
              className="bg-zinc-100 dark:bg-zinc-800"
            />
          </Field>

          <Field>
            <Label>Asunto</Label>
            <Input
              type="text"
              name="subject"
              value={formData.subject}
              onChange={handleChange}
              placeholder="Breve descripción del tema"
              required
              maxLength={100}
            />
          </Field>

          <Field>
            <Label>Mensaje</Label>
            <Textarea
              name="message"
              value={formData.message}
              onChange={handleChange}
              placeholder="Cuéntanos con más detalle..."
              rows={8}
              required
              minLength={10}
              maxLength={1000}
            />
            <Text className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              {formData.message.length}/1000 caracteres
            </Text>
          </Field>

          <div className="flex gap-4 justify-end">
            <Button
              type="button"
              plain
              onClick={() => {
                setFormData({
                  category: 'suggestion',
                  subject: '',
                  message: '',
                })
              }}
            >
              Limpiar
            </Button>
            <Button
              type="submit"
              color="indigo"
              disabled={isSubmitting || !formData.subject || !formData.message}
            >
              {isSubmitting ? 'Enviando...' : 'Enviar Comentarios'}
            </Button>
          </div>
        </form>

        <Divider className="my-8" />

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
            Información Adicional
          </h2>
          
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
              <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
                📧 Contacto Directo
              </h3>
              <Text className="text-sm">
                Para asuntos urgentes, contacta al administrador del condominio.
              </Text>
            </div>

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
              <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
                ⏱️ Tiempo de Respuesta
              </h3>
              <Text className="text-sm">
                Normalmente respondemos en 2-3 días hábiles.
              </Text>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
            <h3 className="font-semibold text-zinc-900 dark:text-white mb-2">
              💡 Consejos para un mejor feedback
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              <li>Sé específico sobre el problema o sugerencia</li>
              <li>Si reportas un error, incluye los pasos para reproducirlo</li>
              <li>Menciona qué navegador y dispositivo estás usando</li>
              <li>Si tienes capturas de pantalla, inclúyelas en tu mensaje</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
