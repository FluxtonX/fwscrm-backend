import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  // ----------------------------------------------------
  // Super Admin Endpoints
  // ----------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(
      user.organizationId,
      user.id,
      dto,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Get()
  async listPendingInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.invitationsService.listPendingInvitations(user.organizationId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  async resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invitationsService.resendInvitation(
      user.organizationId,
      id,
      user.id,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invitationsService.revokeInvitation(
      user.organizationId,
      id,
      user.id,
    );
  }

  // ----------------------------------------------------
  // Public Invitation Endpoints (No Auth Required)
  // ----------------------------------------------------

  @Get('validate')
  async validateToken(@Query('token') token: string) {
    return this.invitationsService.validateToken(token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.invitationsService.acceptInvitation(dto);

    // Set auth cookie
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('auth_token', result.token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      user: result.user,
      organization: result.organization,
      token: result.token,
    };
  }
}
