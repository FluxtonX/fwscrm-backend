import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/notifications',
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      let token = client.handshake.auth?.token;

      if (!token && client.handshake.headers?.authorization) {
        const parts = client.handshake.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
          token = parts[1];
        }
      }

      if (!token && client.handshake.headers?.cookie) {
        const cookies = parseCookies(client.handshake.headers.cookie);
        token = cookies['auth_token'];
      }

      if (!token) {
        this.logger.warn(`Unauthorized Socket connection attempt (no token): ${client.id}`);
        client.disconnect(true);
        return;
      }

      const secret = this.configService.get<string>('JWT_SECRET') || 'dev_jwt_secret_fallback';
      const payload = this.jwtService.verify<JwtPayload>(token, { secret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, organizationId: true, isActive: true },
      });

      if (!user || !user.isActive) {
        this.logger.warn(`Unauthorized Socket connection: inactive or missing user ${payload.sub}`);
        client.disconnect(true);
        return;
      }

      // Server-side enforced user room (prevents client spoofing)
      const room = `org:${user.organizationId}:user:${user.id}`;
      client.join(room);
      client.data.user = user;

      this.logger.log(`Client connected: ${client.id} joined room ${room}`);
    } catch (err: any) {
      this.logger.warn(`Socket authentication failed for ${client.id}: ${err?.message}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Emits a real-time notification event strictly to the user's isolated room.
   */
  sendNotificationToUser(organizationId: string, recipientUserId: string, notification: any) {
    if (!this.server) {
      this.logger.warn('WebSocket server not yet initialized');
      return;
    }
    const room = `org:${organizationId}:user:${recipientUserId}`;
    this.logger.log(`Emitting notification:new event to room ${room}`);
    this.server.to(room).emit('notification:new', notification);
  }
}
