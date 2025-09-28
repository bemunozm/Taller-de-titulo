import { ApiResponseOptions } from '@nestjs/swagger';

export const CommonApiResponses = {
  BadRequest: {
    status: 400,
    description: 'Solicitud incorrecta - Datos inválidos',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'array',
          items: { type: 'string' },
          example: ['email must be an email', 'password must be longer than or equal to 6 characters']
        },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  } as ApiResponseOptions,

  Unauthorized: {
    status: 401,
    description: 'No autorizado - Token inválido o expirado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 }
      }
    }
  } as ApiResponseOptions,

  NotFound: {
    status: 404,
    description: 'Recurso no encontrado',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Usuario no encontrado' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  } as ApiResponseOptions,

  InternalServerError: {
    status: 500,
    description: 'Error interno del servidor',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Error interno del servidor' },
        error: { type: 'string', example: 'Internal Server Error' },
        statusCode: { type: 'number', example: 500 }
      }
    }
  } as ApiResponseOptions,

  ValidationError: {
    status: 400,
    description: 'Error de validación en los datos enviados',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'array',
          items: { type: 'string' },
          example: [
            'rut should not be empty',
            'email must be an email',
            'password must be longer than or equal to 6 characters'
          ]
        },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  } as ApiResponseOptions,
};

export const AuthApiResponses = {
  AccountNotConfirmed: {
    status: 401,
    description: 'Cuenta no confirmada',
    schema: {
      type: 'object',
      properties: {
        message: { 
          type: 'string', 
          example: 'Tu cuenta no está confirmada. Hemos enviado un nuevo código de verificación a tu email.'
        },
        error: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 }
      }
    }
  } as ApiResponseOptions,

  UserAlreadyExists: {
    status: 400,
    description: 'Usuario ya existe',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'El Usuario ya está registrado' },
        error: { type: 'string', example: 'Bad Request' },
        statusCode: { type: 'number', example: 400 }
      }
    }
  } as ApiResponseOptions,

  InvalidCredentials: {
    status: 401,
    description: 'Credenciales inválidas',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Password Incorrecto' },
        error: { type: 'string', example: 'Unauthorized' },
        statusCode: { type: 'number', example: 401 }
      }
    }
  } as ApiResponseOptions,

  TokenExpired: {
    status: 404,
    description: 'Token expirado o inválido',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Token no válido' },
        error: { type: 'string', example: 'Not Found' },
        statusCode: { type: 'number', example: 404 }
      }
    }
  } as ApiResponseOptions,

  UserSuccess: {
    status: 200,
    description: 'Información del usuario autenticado',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', example: '123e4567-e89b-12d3-a456-426614174000' },
        rut: { type: 'string', example: '12345678-9' },
        name: { type: 'string', example: 'Juan Pérez González' },
        email: { type: 'string', format: 'email', example: 'juan.perez@example.com' },
        phone: { type: 'string', example: '+56912345678' },
        age: { type: 'number', example: 25 },
        confirmed: { type: 'boolean', example: true },
        createdAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:00:00Z' },
        updatedAt: { type: 'string', format: 'date-time', example: '2024-01-01T12:00:00Z' },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', example: 'user' },
              description: { type: 'string', example: 'Usuario regular' }
            }
          }
        }
      }
    }
  } as ApiResponseOptions,
};