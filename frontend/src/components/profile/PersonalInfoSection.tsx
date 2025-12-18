import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'react-toastify';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { updateProfile, uploadProfilePicture, deleteProfilePicture } from '@/api/AuthAPI';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Field, Label } from '@/components/ui/Fieldset';
import { Avatar } from '@/components/ui/Avatar';
import { CameraIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { User } from '@/types/index';

const updateProfileSchema = z.object({
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').max(128),
  phone: z.string().min(10, 'Ingrese un número válido').optional(),
  age: z.number().int().min(1).max(150).optional(),
});

type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;

interface PersonalInfoSectionProps {
  user: User;
}

export function PersonalInfoSection({ user }: PersonalInfoSectionProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [phoneValue, setPhoneValue] = useState(user.phone || '');
  const [imagePreview, setImagePreview] = useState(user.profilePicture || '');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<UpdateProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user.name,
      phone: user.phone || '',
      age: user.age || undefined,
    },
  });

  const mutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Perfil actualizado exitosamente');
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al actualizar el perfil');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: uploadProfilePicture,
    onSuccess: (data) => {
      setImagePreview(data.url);
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Foto de perfil actualizada exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al subir la imagen');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProfilePicture,
    onSuccess: () => {
      setImagePreview('');
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      toast.success('Foto de perfil eliminada exitosamente');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Error al eliminar la imagen');
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processImage(file);
    }
  };

  const processImage = (file: File) => {
    // Validar tipo de archivo
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Solo se permiten imágenes JPG, PNG o WEBP');
      return;
    }

    // Validar tamaño (5MB máximo)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast.error('La imagen no puede exceder los 5MB');
      return;
    }

    uploadMutation.mutate(file);
  };

  const handleButtonClick = () => {
    const input = document.getElementById('profile-picture-input') as HTMLInputElement;
    input?.click();
  };

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 } 
      });
      setStream(mediaStream);
      setShowCamera(true);
      
      // Esperar a que el modal se renderice antes de asignar el stream
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(err => console.error('Error al reproducir video:', err));
        }
      }, 100);
    } catch (error) {
      console.error('Error al acceder a la cámara:', error);
      toast.error('No se pudo acceder a la cámara');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
            processImage(file);
            stopCamera();
          }
        }, 'image/jpeg', 0.95);
      }
    }
  };

  const handleDeletePhoto = () => {
    if (confirm('¿Estás seguro de que quieres eliminar tu foto de perfil?')) {
      deleteMutation.mutate();
    }
  };

  // Cleanup del stream cuando se desmonta el componente
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const onSubmit = (data: UpdateProfileFormData) => {
    mutation.mutate({
      ...data,
      phone: phoneValue || undefined,
    });
  };

  const handleCancel = () => {
    reset();
    setPhoneValue(user.phone || '');
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* Foto de Perfil */}
      <div className="flex items-center gap-6 pb-6 border-b border-zinc-200 dark:border-zinc-700">
        <div className="relative">
          <Avatar 
            src={imagePreview}
            initials={user.name.charAt(0).toUpperCase()}
            alt="Foto de perfil"
            className="size-24 bg-zinc-100 text-zinc-400 dark:bg-zinc-800 ring-4 ring-zinc-100 dark:ring-zinc-800"
          />
          {uploadMutation.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 rounded-full">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">
            Foto de Perfil
          </h4>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3">
            Sube una imagen JPG, PNG o WEBP. Máximo 5MB.
          </p>
          
          {/* Camera Modal */}
          {showCamera && (
            <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={(e) => {
              if (e.target === e.currentTarget) stopCamera();
            }}>
              <div className="bg-white dark:bg-zinc-800 rounded-lg p-6 max-w-2xl w-full mx-4">
                <h3 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-zinc-100">
                  Capturar Foto
                </h3>
                <div className="relative bg-zinc-900 rounded-lg overflow-hidden mb-4" style={{ aspectRatio: '4/3' }}>
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex gap-3 justify-end">
                  <Button type="button" outline onClick={stopCamera}>
                    Cancelar
                  </Button>
                  <Button type="button" onClick={capturePhoto}>
                    Capturar
                  </Button>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              id="profile-picture-input"
              type="file"
              accept="image/jpeg,image/png,image/jpg,image/webp"
              onChange={handleImageChange}
              className="hidden"
              disabled={uploadMutation.isPending}
            />
            <Button 
              type="button" 
              outline 
              disabled={uploadMutation.isPending || deleteMutation.isPending}
              onClick={handleButtonClick}
            >
              {uploadMutation.isPending ? 'Subiendo...' : 'Cambiar Foto'}
            </Button>
            <Button 
              type="button" 
              outline 
              disabled={uploadMutation.isPending || deleteMutation.isPending}
              onClick={startCamera}
            >
              <CameraIcon className="w-4 h-4 mr-1" />
              Capturar Foto
            </Button>
            {imagePreview && (
              <Button 
                type="button" 
                color="red"
                disabled={uploadMutation.isPending || deleteMutation.isPending}
                onClick={handleDeletePhoto}
              >
                <TrashIcon className="w-4 h-4 mr-1" />
                {deleteMutation.isPending ? 'Eliminando...' : 'Quitar Foto'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Información Personal
          </h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Actualiza tu información personal y de contacto
          </p>
        </div>
        {!isEditing && (
          <Button outline onClick={() => setIsEditing(true)}>
            Editar
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* RUT (No editable) */}
        <Field>
          <Label>RUT</Label>
          <Input value={user.rut} disabled />
          <p className="text-xs text-zinc-500 mt-1">
            El RUT no puede ser modificado
          </p>
        </Field>

        {/* Nombre */}
        <Field>
          <Label>Nombre Completo *</Label>
          <Input
            {...register('name')}
            disabled={!isEditing}
            invalid={!!errors.name}
          />
          {errors.name && (
            <p className="text-sm text-red-600 mt-1">{errors.name.message}</p>
          )}
        </Field>

        {/* Email (No editable) */}
        <Field>
          <Label>Email</Label>
          <Input value={user.email} disabled />
          <p className="text-xs text-zinc-500 mt-1">
            El email no puede ser modificado
          </p>
        </Field>

        {/* Teléfono */}
        <Field>
          <Label>Teléfono</Label>
          <PhoneInput
            value={phoneValue}
            onChange={(value) => setPhoneValue(value || '')}
            defaultCountry="CL"
            disabled={!isEditing}
            placeholder="Ingrese el número de teléfono"
            international={true}
            withCountryCallingCode={true}
            countryCallingCodeEditable={false}
            inputComponent={Input}
            className="mt-1"
          />
          {errors.phone && (
            <p className="text-sm text-red-600 mt-1">{errors.phone.message}</p>
          )}
        </Field>

        {/* Edad */}
        <Field>
          <Label>Edad</Label>
          <Input
            type="number"
            {...register('age', { valueAsNumber: true })}
            disabled={!isEditing}
            invalid={!!errors.age}
          />
          {errors.age && (
            <p className="text-sm text-red-600 mt-1">{errors.age.message}</p>
          )}
        </Field>

        {isEditing && (
          <div className="flex justify-end gap-3 pt-4 border-t border-zinc-200 dark:border-zinc-700">
            <Button type="button" plain onClick={handleCancel}>
              Cancelar
            </Button>
            <Button type="submit" color="indigo" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
