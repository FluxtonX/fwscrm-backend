import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUser: AuthenticatedUser = {
    id: 'user-1',
    organizationId: 'org-123',
    email: 'admin@fwscrm.com',
    firstName: 'Admin',
    lastName: 'User',
    role: Role.SUPER_ADMIN,
  };

  const mockUsersList = [
    {
      id: 'user-1',
      organizationId: 'org-123',
      email: 'admin@fwscrm.com',
      firstName: 'Admin',
      lastName: 'User',
      role: Role.SUPER_ADMIN,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockUsersService = {
    listByOrganization: jest.fn().mockResolvedValue(mockUsersList),
    updateRole: jest.fn().mockResolvedValue({
      id: 'user-2',
      role: Role.MANAGER,
    }),
    updateStatus: jest.fn().mockResolvedValue({
      id: 'user-2',
      isActive: false,
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return all users in the organization', async () => {
    const result = await controller.findAll(mockUser);
    expect(result).toEqual(mockUsersList);
    expect(service.listByOrganization).toHaveBeenCalledWith('org-123', true);
  });

  it('should update a user role', async () => {
    const result = await controller.updateRole(mockUser, 'user-2', {
      role: Role.MANAGER,
    });
    expect(service.updateRole).toHaveBeenCalledWith(
      'org-123',
      'user-2',
      Role.MANAGER,
      'user-1',
    );
    expect(result.role).toBe(Role.MANAGER);
  });

  it('should update a user status', async () => {
    const result = await controller.updateStatus(mockUser, 'user-2', {
      isActive: false,
    });
    expect(service.updateStatus).toHaveBeenCalledWith(
      'org-123',
      'user-2',
      false,
      'user-1',
    );
    expect(result.isActive).toBe(false);
  });
});
