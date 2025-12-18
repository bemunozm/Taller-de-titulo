import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'react-toastify';
import { EyeIcon, EyeSlashIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import { updateCurrentUserPassword } from '@/api/AuthAPI';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field, Label } from '@/components/ui/Fieldset';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: z.string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .regex(/[A-Z]/, 'Debe contener al menos una mayúscula')
    .regex(/[a-z]/, 'Debe contener al menos una minúscula')
    .regex(/[0-9]/, 'Debe contener al menos un número'),
  confirmPassword: z.string().min(1, 'Confirma tu nueva contraseña'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
});

type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;

export function SecuritySection() {
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ChangePasswordFormData>({
    resolver: zodResolver(changePasswordSchema),
  });

  const mutation = useMutation({
    mutationFn: updateCurrentUserPassword,
    onSuccess: () => {
      toast.success('Contraseña actualizada exitosamente');
      reset();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar la contraseña');
    },
  });

  const onSubmit = (data: ChangePasswordFormData) => {
    mutation.mutate({
      current_password: data.currentPassword,
      password: data.newPassword,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Seguridad de la Cuenta
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cambia tu contraseña para mantener tu cuenta segura
        </p>
      </div>

      {/* Security Tips */}
      <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-lg p-4">
        <div className="flex gap-3">
          <ShieldCheckIcon className="w-5 h-5 text-sky-600 dark:text-sky-400 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-sky-900 dark:text-sky-100 mb-2">
              Consejos de Seguridad
            </h4>
            <ul className="text-sm text-sky-800 dark:text-sky-200 space-y-1 list-disc list-inside">
              <li>Usa al menos 8 caracteres</li>
              <li>Combina mayúsculas, minúsculas y números</li>
              <li>No reutilices contraseñas de otras cuentas</li>
              <li>Cambia tu contraseña periódicamente</li>
            </ul>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Current Password */}
        <Field>
          <Label>Contraseña Actual *</Label>
          <div className="relative">
            <Input
              type={showCurrentPassword ? 'text' : 'password'}
              {...register('currentPassword')}
              invalid={!!errors.currentPassword}
              placeholder="Ingresa tu contraseña actual"
            />
            <button
              type="button"
              onClick={() => setShowCurrentPassword(!showCurrentPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showCurrentPassword ? (
                <EyeSlashIcon className="w-5 h-5" />
              ) : (
                <EyeIcon className="w-5 h-5" />
              )}
            </button>
          </div>
          {errors.currentPassword && (
            <p className="text-sm text-red-600 mt-1">{errors.currentPassword.message}</p>
          )}
        </Field>

        {/* New Password */}
        <Field>
          <Label>Nueva Contraseña *</Label>
          <div className="relative">
            <Input
              type={showNewPassword ? 'text' : 'password'}
              {...register('newPassword')}
              invalid={!!errors.newPassword}
              placeholder="Ingresa tu nueva contraseña"
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showNewPassword ? (
                <EyeSlashIcon className="w-5 h-5" />
              ) : (
                <EyeIcon className="w-5 h-5" />
              )}
            </button>
          </div>
          {errors.newPassword && (
            <p className="text-sm text-red-600 mt-1">{errors.newPassword.message}</p>
          )}
        </Field>

        {/* Confirm Password */}
        <Field>
          <Label>Confirmar Nueva Contraseña *</Label>
          <div className="relative">
            <Input
              type={showConfirmPassword ? 'text' : 'password'}
              {...register('confirmPassword')}
              invalid={!!errors.confirmPassword}
              placeholder="Confirma tu nueva contraseña"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              {showConfirmPassword ? (
                <EyeSlashIcon className="w-5 h-5" />
              ) : (
                <EyeIcon className="w-5 h-5" />
              )}
            </button>
          </div>
          {errors.confirmPassword && (
            <p className="text-sm text-red-600 mt-1">{errors.confirmPassword.message}</p>
          )}
        </Field>

        <div className="flex justify-end pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <Button type="submit" color="indigo" disabled={mutation.isPending}>
            {mutation.isPending ? 'Actualizando...' : 'Cambiar Contraseña'}
          </Button>
        </div>
      </form>
    </div>
  );
}
