import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/jwt-payload.interface';
import { Role } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { AuthService } from '../auth/auth.service';

@Controller('invitations')
export class InvitationsController {
  private readonly logger = new Logger(InvitationsController.name);

  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Public validation of invitation token.
   * Invoked when invited user lands on the acceptance page.
   */
  @Get('validate')
  async validateToken(@Query('token') token: string) {
    return this.invitationsService.validateToken(token);
  }

  /**
   * Public invitation acceptance & account activation.
   * Atomically creates user credentials, activates membership,
   * marks invitation accepted, and grants an immediate session.
   */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.invitationsService.acceptInvitation(dto);

    // Automatically establish session for the activated user
    const token = this.authService.generateToken(result.user);
    this.authService.setAuthCookie(res, token);

    return {
      user: result.user,
      organization: result.organization,
      message: 'Account activated successfully. Welcome to your workspace!',
    };
  }

  /**
   * Super Admin issues a new user invitation.
   * Only SUPER_ADMIN is permitted.
   */
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  async createInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInvitationDto,
  ) {
    const result = await this.invitationsService.createInvitation(
      user.organizationId,
      user.id,
      dto,
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const activationUrl = `${frontendUrl}/accept-invitation?token=${result.rawToken}`;

    const inviterName =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      'Administrator';
    const orgName = result.invitation.organizationName || 'Your Workspace';

    // Dispatch transactional invitation email via two-tier email service (Brevo or Dev Preview)
    const emailResult = await this.emailService.sendInvitationEmail({
      toEmail: result.invitation.email,
      organizationName: orgName,
      role: result.invitation.role,
      inviterName,
      activationUrl,
      expiresAt: result.invitation.expiresAt,
    });

    this.logger.log(
      `[INVITATION GENERATED] Email: ${result.invitation.email} | URL: ${activationUrl} | Delivery: ${emailResult.provider}`,
    );

    return {
      invitation: result.invitation,
      activationUrl,
      emailDelivery: emailResult,
    };
  }

  /**
   * Lists all invitations for the active organization.
   * Only SUPER_ADMIN is permitted.
   */
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  async listInvitations(@CurrentUser() user: AuthenticatedUser) {
    return this.invitationsService.listByOrganization(user.organizationId);
  }

  /**
   * Resends an invitation with a fresh token and renewed expiration.
   * Only SUPER_ADMIN is permitted.
   */
  @Post(':id/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
  async resendInvitation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const result = await this.invitationsService.resendInvitation(
      user.organizationId,
      id,
      user.id,
    );

    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const activationUrl = `${frontendUrl}/accept-invitation?token=${result.rawToken}`;

    const inviterName =
      `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
      'Administrator';
    const orgName = result.invitation.organizationName || 'Your Workspace';

    // Dispatch renewed invitation email
    const emailResult = await this.emailService.sendInvitationEmail({
      toEmail: result.invitation.email,
      organizationName: orgName,
      role: result.invitation.role,
      inviterName,
      activationUrl,
      expiresAt: result.invitation.expiresAt,
    });

    this.logger.log(
      `[INVITATION RESENT] Email: ${result.invitation.email} | URL: ${activationUrl} | Delivery: ${emailResult.provider}`,
    );

    return {
      invitation: result.invitation,
      activationUrl,
      emailDelivery: emailResult,
    };
  }

  /**
   * Revokes a pending invitation.
   * Only SUPER_ADMIN is permitted.
   */
  @Post(':id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.SUPER_ADMIN)
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
}
