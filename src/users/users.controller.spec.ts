import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUser: AuthenticatedUser = {
    id: 'user-1',
    organizationId: 'org-123',
    email: 'admin@fwscrm.com',
    firstName: 'Admin',
    lastName: 'User',
    role: Role.ADMIN,
  };

  const mockUsersList = [
    {
      id: 'user-1',
      organizationId: 'org-123',
      email: 'admin@fwscrm.com',
      firstName: 'Admin',
      lastName: 'User',
      role: Role.ADMIN,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const mockUsersService = {
    listByOrganization: jest.fn().mockResolvedValue(mockUsersList),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
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
    expect(service.listByOrganization).toHaveBeenCalledWith('org-123');
  });
});
