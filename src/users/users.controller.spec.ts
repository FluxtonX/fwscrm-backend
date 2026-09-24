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
    createMember: jest.fn().mockResolvedValue({
      id: 'user-new',
      organizationId: 'org-123',
      email: 'newuser@fwscrm.com',
      role: Role.MANAGER,
      isActive: true,
    }),
    listByOrganization: jest.fn().mockResolvedValue(mockUsersList),
    updateRole: jest.fn().mockResolvedValue({
      id: 'user-2',
      role: Role.MANAGER,
    }),
    updateStatus: jest.fn().mockResolvedValue({
      id: 'user-2',
      isActive: false,
    }),
    updateUserIp: jest.fn().mockResolvedValue({
      id: 'user-2',
      allowedIp: '203.0.113.50',
    }),
    adminResetPassword: jest.fn().mockResolvedValue({
      success: true,
      message: 'Password for user@example.com updated',
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

  it('should create a team member under the authenticated user organization', async () => {
    const dto = {
      email: 'newuser@fwscrm.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      role: Role.MANAGER,
    };
    const result = await controller.createMember(mockUser, dto as any);
    expect(service.createMember).toHaveBeenCalledWith(
      'org-123',
      'user-1',
      dto,
    );
    expect(result.id).toBe('user-new');
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

  it('should update a user IP configuration', async () => {
    const dto = { allowedIp: '203.0.113.50' };
    const result = await controller.updateUserIp(mockUser, 'user-2', dto);
    expect(service.updateUserIp).toHaveBeenCalledWith(
      'org-123',
      'user-2',
      dto,
      'user-1',
    );
    expect(result.allowedIp).toBe('203.0.113.50');
  });

  it('should reset a user password as admin', async () => {
    const dto = { password: 'NewSecurePassword123!' };
    const result = await controller.adminResetPassword(mockUser, 'user-2', dto);
    expect(service.adminResetPassword).toHaveBeenCalledWith(
      'org-123',
      'user-2',
      dto,
      'user-1',
    );
    expect(result.success).toBe(true);
  });
});
