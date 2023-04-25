import {
	ConnectedSocket,
	MessageBody,
	type OnGatewayConnection,
	type OnGatewayDisconnect,
	type OnGatewayInit,
	WebSocketGateway,
	WebSocketServer,
	SubscribeMessage,
} from '@nestjs/websockets';
import { Logger, UseGuards } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService } from 'src/auth/auth.service';
import { JwtStrategy } from 'src/auth/strategy';
import { ActivityStatus, User } from '@prisma/client';
import { UserService } from 'src/user/user.service';
import { ChatService } from './chat.service';
import { Member, Message } from './types';
import { ClientGuard } from 'src/auth/guards/client-auth.guard';
import { SharedService } from './chat.map.shared.service';

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
		private readonly chatService: ChatService,
		private readonly userService: UserService,
		private readonly jwtStrategy: JwtStrategy,
		private readonly sharedService: SharedService,
	) { }
	private readonly logger: Logger = new Logger('ChatGateway');
	private connectedClients: { [clientId: string]: Socket } = {};

	@WebSocketServer()
	server: Server;

	afterInit(): void {
		this.logger.log('ChatGateway Initialized');
	}

	async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
		this.logger.log(`Client is trying to connect: ${client.id}`);
		let user: User;

		try {
			// verify client
			const token: string = this.authService.getJwtTokenFromSocket(client);
			const payload: { name: string; sub: number } = await this.authService.verifyToken(token);
			user = await this.jwtStrategy.validate(payload);
		} catch (error: any) {
			this.server.to(client.id).emit('unauthorized', { message: 'Authorization is required before a connection can be made' });
			this.logger.error(`Client connection refused: ${client.id}`);
			client.disconnect();
		}
		try {
			// if this is the first client of the user, set activity status to online
			const activeClientIds: string[] = [...this.sharedService.clientToIntraId.keys()];
			if (this.isActive(activeClientIds, user.intraId) === false) {
				await this.userService.setActivityStatus(user.intraId, ActivityStatus.ONLINE);
			}

			// add client to map and its socket
			this.sharedService.clientToIntraId.set(client.id, user.intraId);
			this.connectedClients[client.id] = client;
			this.logger.log(`Client connected: ${client.id}`);
		} catch (error: any) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway handleConnection');
		}
	}

	async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);

			// delete client from map and delete socket
			this.sharedService.clientToIntraId.delete(client.id);
			const activeClientIds: string[] = [...this.sharedService.clientToIntraId.keys()];
			delete this.connectedClients[client.id];

			// if this was the last client of the user, set activity to offline
			if (this.isActive(activeClientIds, intraId) === false) {
				await this.userService.setActivityStatus(intraId, ActivityStatus.OFFLINE);
			}

			this.logger.log(`Client disconnected: ${client.id}`);
		} catch (error: any) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway handleDisconnect');
		}
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('logout')
	async logout(@ConnectedSocket() client: Socket): Promise<void> {
		const intraId: number = this.sharedService.clientToIntraId.get(client.id);
		const activeClientIds: string[] = [...this.sharedService.clientToIntraId.keys()];
		const allClientsBelongingToUser: string[] = activeClientIds.filter((clientId) => {
			const clientIntraId = this.sharedService.clientToIntraId.get(clientId);
			return clientIntraId && clientIntraId === intraId;
		});

		const sockets: Socket[] = [];
		allClientsBelongingToUser.forEach((clientId) => sockets.push(this.connectedClients[clientId]));
		sockets.forEach((socket: Socket) => {
			socket.emit('redirectAfterLogout');
			socket.disconnect();
		});

		await this.userService.setActivityStatus(intraId, ActivityStatus.OFFLINE);
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('joinChannel')
	async handleJoinChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		const member: Member = await this.chatService.getMember(channelName, client.id);

		const activeClientIds: string[] = this.sharedService.channelToClientIds.get(channelName) || [];
		const activeMembers: Member[] = await this.chatService.getActiveMembers(channelName, activeClientIds, member.intraId);

		// inform all other users in the channel that a user joined if first active client
		if (this.isActive(activeClientIds, member.intraId) === false) {
			this.server.to(channelName).emit('userJoined', member);
		}

		// add client to channel map
		this.sharedService.channelToClientIds.set(channelName, [...activeClientIds, client.id]);

		// inform current user which other members are in the channel
		client.emit('otherActiveUsers', activeMembers);

		// join channel
		client.join(channelName);
	}

	private isActive(clientIds: string[], intraId: number) {
		const activeIntraIds: number[] = clientIds.map((clientId: string): number => this.sharedService.clientToIntraId.get(clientId));
		return activeIntraIds.includes(intraId);
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('leaveChannel')
	async handleLeaveChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		const member: Member = await this.chatService.getMember(channelName, client.id);

		// remove client from channel map
		const activeClientIds: string[] = this.sharedService.channelToClientIds.get(channelName);
		const updatedActiveClientIds: string[] = activeClientIds.filter(clientId => clientId !== client.id);
		this.sharedService.channelToClientIds.set(channelName, updatedActiveClientIds);

		// inform all other users in the channel that a user left if last active client
		if (this.isActive(updatedActiveClientIds, member.intraId) === false) {
			this.server.to(channelName).emit('userLeft', member);
		}

		// leave channel
		client.leave(channelName);
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('sendMessageToChannel')
	async handleChannelMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { messageText: string, channelName: string }): Promise<void> {
		const text = data.messageText;
		const channelName = data.channelName;
		const intraId = this.sharedService.clientToIntraId.get(client.id)
		const message: Message = await this.chatService.handleChannelMessage(intraId, channelName, text);
		this.server.to(channelName).emit('message', message);
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('kickUser')
	async kickUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);
			const clientIdsInChannel: string[] = this.sharedService.channelToClientIds.get(data.channelName);
			const canBeKicked: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			const clientIds: string[] = this.getClientIds(clientIdsInChannel, data.otherIntraId);
			if (canBeKicked === true) {
				this.server.to(clientIds).emit('leaveChannel', { channelName: data.channelName });
			}
			else {
				this.server.to(client.id).emit('error', { message: 'Cannot kick user' });
			}
		} catch (error) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway kickUser');
		}
	}

	// currently users are banned, whether they are in the channel or not
	// if they are in the channel they are also kicked
	@UseGuards(ClientGuard)
	@SubscribeMessage('banUser')
	async banUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);
			const clientIdsInChannel: string[] = this.sharedService.channelToClientIds.get(data.channelName);
			const canBeBanned: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			const clientIds: string[] = this.getClientIds(clientIdsInChannel, data.otherIntraId);
			if (canBeBanned === true) {
				this.server.to(clientIds).emit('leaveChannel', { channelName: data.channelName });
				await this.chatService.banUser(data.otherIntraId, data.channelName);
			}
		} catch (error) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway banUser');
		}
	}

	private getClientIds(clientIdsInChannel: string[], otherIntraId: number): string[] {
		const clientIds: string[] = [];
		for (const clientId of clientIdsInChannel) {
			if (otherIntraId === this.sharedService.clientToIntraId.get(clientId)) {
				clientIds.push(clientId);
			}
		}
		return clientIds;
	}

	// currently users are muted, whether they are in the channel or not
	// technically we can remove the error emit and put this function in the controller
	@UseGuards(ClientGuard)
	@SubscribeMessage('muteUser')
	async muteUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);
			const canBeMuted: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			if (canBeMuted === true) {
				await this.chatService.muteUser(data.otherIntraId, data.channelName);
			}
		} catch (error) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway muteUser');
		}
	}
}
