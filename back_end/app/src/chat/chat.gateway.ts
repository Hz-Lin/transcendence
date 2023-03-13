import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  WsException,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from 'src/auth/auth.service';
import { UserClientService } from 'src/user/client/client.service';
import { JwtStrategy } from 'src/auth/strategy';
import { ActivityStatus, User } from '@prisma/client';
import { UserService } from 'src/user/user.service';

@WebSocketGateway({
  cors: {
    origin: 'localhost:5173',
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly authService: AuthService,
    private readonly userClientService: UserClientService,
    private readonly userService: UserService,
    private readonly jwtStrategy: JwtStrategy,
  ) { }
  private readonly logger: Logger = new Logger('WebsocketGateway');

  @WebSocketServer()
  server: Server;

  afterInit(): void {
    this.logger.log('ChatGateway Initialized');
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    this.logger.log(`Client is trying to connect: ${client.id}`);

    try {
      const token: string = this.authService.getJwtTokenFromSocket(client);
      const payload: { name: string; sub: number } =
        await this.authService.verifyToken(token);
      const user: User = await this.jwtStrategy.validate(payload);
      await this.userClientService.updateOrCreateclient(client.id, user.intraId);
      const status: ActivityStatus = await this.userService.setActivityStatus(user.intraId, ActivityStatus.ONLINE);
      this.logger.log(`Client connected: ${client.id}, status: ${status}`);
    } catch (error) {
      this.logger.error(error);
      this.logger.error(`Client connection refused: ${client.id}`);
      client.disconnect();
    }
  }

  async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
    try {
      const user: User = await this.userClientService.getUser(client.id);
      const status: ActivityStatus = await this.userService.setActivityStatus(user.intraId, ActivityStatus.OFFLINE);
      this.logger.log(`Client disconnected: ${client.id}, status: ${status}`);
    } catch (error: any) {
      this.logger.error(error);
    }
  }

  @SubscribeMessage('joinChannel')
  handleJoinChannel(@ConnectedSocket() client: Socket, @MessageBody() data: string): string {
    console.log(`joined channel ${data}`);
    return ('data');
  }

  @SubscribeMessage('sendMessageToChannel')
  handleRoomMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { messageText: string, channelName: string }): string {
    console.log(data);
    return ('data');
  }
}
