import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;

  const mockUser: Partial<User> = {
    id: '1',
    email: 'test@example.com',
    name: 'Test User',
    rut: '12345678-9',
    phone: '123456789',
    age: 25,
    confirmed: false,
    roles: [],
  };

  beforeEach(async () => {
    const mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create and return a new user', async () => {
      // Arrange
      const createUserDto: CreateUserDto = {
        email: 'test@example.com',
        name: 'Test User',
        rut: '12345678-9',
        password: 'hashedPassword',
        age: 25,
      };

      repository.create.mockReturnValue(mockUser as User);
      repository.save.mockResolvedValue(mockUser as User);

      // Act
      const result = await service.create(createUserDto);

      // Assert
      expect(repository.create).toHaveBeenCalledWith(createUserDto);
      expect(repository.save).toHaveBeenCalledWith(mockUser);
      expect(result).toEqual(mockUser);
    });
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      // Arrange
      const users = [mockUser, { ...mockUser, id: '2', email: 'user2@example.com' }];
      repository.find.mockResolvedValue(users as User[]);

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
      repository.findOneBy.mockResolvedValue(mockUser as User);

      // Act
      const result = await service.findOne('1');

      // Assert
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: '1' });
      expect(result).toEqual(mockUser);
    });

    it('should throw NotFoundException when user not found', async () => {
      // Arrange
      repository.findOneBy.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('should return a user when found by email', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(mockUser as User);

      // Act
      const result = await service.findByEmail('test@example.com');

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
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

  describe('findByEmailWithPassword', () => {
    it('should return user with password when found', async () => {
      // Arrange
      const userWithPassword = { ...mockUser, password: 'hashedPassword' };
      repository.findOne.mockResolvedValue(userWithPassword as User);

      // Act
      const result = await service.findByEmailWithPassword('test@example.com');

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'test@example.com' },
        select: ['id', 'email', 'password', 'name', 'confirmed'],
      });
      expect(result).toEqual(userWithPassword);
    });

    it('should return null when user not found', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act
      const result = await service.findByEmailWithPassword('nonexistent@example.com');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findByIdWithPassword', () => {
    it('should return user with password when found by id', async () => {
      // Arrange
      const userWithPassword = { ...mockUser, password: 'hashedPassword' };
      repository.findOne.mockResolvedValue(userWithPassword as User);

      // Act
      const result = await service.findByIdWithPassword('1');

      // Assert
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: '1' },
        select: ['id', 'password'],
      });
      expect(result).toEqual(userWithPassword);
    });

    it('should throw NotFoundException when user not found by id', async () => {
      // Arrange
      repository.findOne.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findByIdWithPassword('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('save', () => {
    it('should save and return the user', async () => {
      // Arrange
      repository.save.mockResolvedValue(mockUser as User);

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
      const updateResult = { affected: 1, raw: {}, generatedMaps: [] };
      
      repository.update.mockResolvedValue(updateResult);

      // Act
      const result = await service.update('1', updateUserDto);

      // Assert
      expect(repository.update).toHaveBeenCalledWith('1', updateUserDto);
      expect(result).toEqual(updateResult);
    });

    it('should throw NotFoundException when user to update not found', async () => {
      // Arrange
      const updateUserDto: UpdateUserDto = { name: 'Updated Name' };
      const updateResult = { affected: 0, raw: {}, generatedMaps: [] };
      repository.update.mockResolvedValue(updateResult);

      // Act & Assert
      await expect(service.update('non-existent', updateUserDto)).rejects.toThrow(NotFoundException);
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

    it('should throw NotFoundException when user to delete not found', async () => {
      // Arrange
      const deleteResult = { affected: 0, raw: {} };
      repository.delete.mockResolvedValue(deleteResult);

      // Act & Assert
      await expect(service.remove('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
