import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../roles/entities/role.entity';
import { Family } from '../families/entities/family.entity';
import {
  createMockRepository,
  type MockRepository,
} from '../test-utils/mock-repository';
import { OrganizationMembershipService } from '../organization-membership/organization-membership.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: MockRepository<User>;

  const mockUser: Partial<User> = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    rut: '12345678-9',
    phone: '123456789',
    age: 25,
    emailVerified: false,
    roles: [],
  };

  /** Cierre de sesiones de better-auth (`revokeUserSessions`). */
  const deleteUserSessions = jest.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    const mockRepository = createMockRepository<User>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: createMockRepository<Role>(),
        },
        {
          provide: getRepositoryToken(Family),
          useValue: createMockRepository<Family>(),
        },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: BetterAuthService,
          useValue: {
            api: {},
            instance: {
              $context: Promise.resolve({
                internalAdapter: { deleteUserSessions },
              }),
            },
          },
        },
        { provide: OrganizationMembershipService, useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<MockRepository<User>>(getRepositoryToken(User));

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      // Arrange
      const users = [
        mockUser,
        { ...mockUser, id: '2', email: 'user2@example.com' },
      ];
      repository.find.mockResolvedValue(users);

      // Act
      const result = await service.findAll();

      // Assert
      expect(repository.find).toHaveBeenCalled();
      expect(result).toEqual(users);
    });
  });

  describe('findOne', () => {
    it('should return a user when found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(mockUser);

      // Act
      const result = await service.findOne('1');

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: ['roles', 'roles.permissions', 'family'],
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user when found by email', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(mockUser);

      // Act
      const result = await service.findByEmail('test@example.com');

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
      });
      expect(result).toEqual(mockUser);
    });

    it('should return null when user not found by email', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findByEmail('nonexistent@example.com');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('save', () => {
    it('should save and return the user', async () => {
      // Arrange
      repository.save.mockResolvedValue(mockUser);

      // Act
      const result = await service.save(mockUser as User);

      // Assert
      expect(repository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
    });
  });

  describe('update', () => {
    it('should update and return the user', async () => {
      // Arrange
      const updateUserDto: UpdateUserDto = {
        name: 'Updated Name',
        age: 30,
      };
      const existingUser = { ...mockUser } as User;
      repository.findOne.mockResolvedValue(existingUser);
      repository.save.mockImplementation((user) =>
        Promise.resolve(user as User),
      );

      // Act
      const result = await service.update('1', updateUserDto);

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        relations: ['roles', 'family'],
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', name: 'Updated Name', age: 30 }),
      );
      expect(result).toEqual(
        expect.objectContaining({ name: 'Updated Name', age: 30 }),
      );
    });

    it('should throw NotFoundException when user to update not found', async () => {
      // Arrange
      const updateUserDto: UpdateUserDto = { name: 'Updated Name' };
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.update('non-existent', updateUserDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should delete the user', async () => {
      // Arrange
      const deleteResult = { affected: 1, raw: {} };
      repository.delete.mockResolvedValue(deleteResult);

      // Act
      const result = await service.remove('1');

      // Assert
      expect(repository.delete).toHaveBeenCalledWith('1');
      expect(result).toEqual(deleteResult);
    });

    it('corrección P6: cierra las sesiones con better-auth ANTES de borrar (el hook corta el socket; la FK en cascada no)', async () => {
      repository.delete.mockResolvedValue({ affected: 1, raw: {} });

      await service.remove('1');

      expect(deleteUserSessions).toHaveBeenCalledWith('1');
      expect(deleteUserSessions.mock.invocationCallOrder[0]).toBeLessThan(
        repository.delete.mock.invocationCallOrder[0],
      );
    });

    it('corrección P6: si no se pueden cerrar las sesiones, no borra y responde 500', async () => {
      deleteUserSessions.mockRejectedValueOnce(new Error('adapter down'));
      (repository as unknown as { manager: { query: jest.Mock } }).manager = {
        query: jest.fn().mockRejectedValue(new Error('db down')),
      };

      await expect(service.remove('1')).rejects.toThrow(
        new InternalServerErrorException(
          'No se pudieron cerrar las sesiones del usuario; no se eliminó. Vuelve a intentarlo.',
        ),
      );
      expect(repository.delete).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when user to delete not found', async () => {
      // Arrange
      const deleteResult = { affected: 0, raw: {} };
      repository.delete.mockResolvedValue(deleteResult);

      // Act & Assert
      await expect(service.remove('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
