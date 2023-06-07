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
import { ActivityStatus, Membership, User } from '@prisma/client';
import { UserService } from 'src/user/user.service';
import { ChatService } from './chat.service';
import { Message } from './types';
import { ClientGuard } from 'src/auth/guards/client-auth.guard';
import { SharedService } from './chat.map.shared.service';
import { GameSharedService } from 'src/game/game.shared.service';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
	cors: {
		origin: `http://${globalThis.host}:5173`,
		credentials: true,
	},
})
export class ChatGateway
	implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
	constructor(
		private readonly authService: AuthService,
		private readonly chatService: ChatService,
		private readonly configService: ConfigService,
		private readonly jwtStrategy: JwtStrategy,
		private readonly gameSharedService: GameSharedService,
		private readonly sharedService: SharedService,
		private readonly userService: UserService,
	) {
		this.channelToClientIds = new Map<string, string[]>();
		this.clientIdToChannel = new Map<string, string>();
	}
	private readonly logger: Logger = new Logger('ChatGateway');
	private channelToClientIds: Map<string, string[]>;
	private clientIdToChannel: Map<string, string>;

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
			if (this.isActive(user.intraId) === false) {
				await this.userService.setActivityStatus(user.intraId, ActivityStatus.ONLINE);
			}

			// add client to map
			this.sharedService.clientToIntraId.set(client.id, user.intraId);
			this.logger.log(`Client connected: ${client.id}`);
		} catch (error: any) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway handleConnection');
		}
	}

	@UseGuards(ClientGuard)
	async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);

			// delete client from map
			this.deleteFromChannels(client.id);
			this.sharedService.clientToIntraId.delete(client.id);

			// if this was the last client of the user, set activity to offline
			if (this.isActive(intraId) === false) {
				await this.userService.setActivityStatus(intraId, ActivityStatus.OFFLINE);
			}
			this.logger.log(`Client disconnected: ${client.id}`);
		} catch (error: any) {
			this.server.to(client.id).emit('error', error?.message || 'An error occured in chat.gateway handleDisconnect');
		}
	}

	private deleteFromChannels(clientId: string): void {
		this.channelToClientIds.forEach(clientIds => {
			const index: number = clientIds.findIndex((client) => { client === clientId; });
			if (index) {
				delete clientIds[index];
			}
		});
	}

	private isActive(intraId: number): boolean {
		for (const [clientId, clientIntraId] of this.sharedService.clientToIntraId.entries()) {
			if (clientIntraId === intraId) {
				return true;
			}
		}
		return false;
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('joinChannel')
	async handleJoinChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		// if there is already an active channel, leave it
		const activeChannel: string = this.clientIdToChannel.get(client.id);
		if (activeChannel) {
			let updatedClientIds: string[] = this.channelToClientIds.get(activeChannel);
			updatedClientIds.filter((clientId) => { clientId !== client.id });
			this.channelToClientIds.set(activeChannel, updatedClientIds);
			client.leave(activeChannel);
		}

		const intraId: number = this.sharedService.clientToIntraId.get(client.id);
		const member: (Membership & { user: User; }) = await this.chatService.getMemberWithUser(channelName, intraId);

		const otherClientsInChannel: string[] = this.channelToClientIds.get(channelName) || [];

		const otherJoinedMembersInChannel = this.getJoinedMembersInChannel(channelName, otherClientsInChannel);

		// add client to channel map
		this.channelToClientIds.set(channelName, [...otherClientsInChannel, client.id]);

		// join channel
		client.join(channelName);

		// inform all other users in the channel that a user joined
		this.server.to(channelName).emit('userJoined', member);

		// inform current user which other members are in the channel
		client.emit('otherJoinedMembers', otherJoinedMembersInChannel);
	}

	private async getJoinedMembersInChannel(channelName: string, otherClientsInChannel: string[]): Promise<(Membership & { user: User })[]> {
		const otherUserIntraIds: number[] = otherClientsInChannel.map(clientId => this.sharedService.clientToIntraId.get(clientId));

		const uniqueUserIntraIds: number[] = [...new Set(otherUserIntraIds)];

		const otherMembersInChannel: (Membership & { user: User })[] = await this.chatService.getMembersWithUser(channelName);

		const otherJoinedMembersInChannel: (Membership & { user: User })[] = otherMembersInChannel.filter(member => {
			if (uniqueUserIntraIds.find(intraId => { intraId === member.user.intraId })) {
				return member;
			}
		});

		return otherJoinedMembersInChannel;
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('leaveChannel')
	async handleLeaveChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		const intraId: number = this.sharedService.clientToIntraId.get(client.id);
		const member: (Membership & { user: User; }) = await this.chatService.getMemberWithUser(channelName, intraId);

		const clientsInChannel: string[] = this.channelToClientIds.get(channelName);
		const updatedClientsInChannel: string[] = clientsInChannel.filter(clientId => clientId !== client.id);
		this.channelToClientIds.set(channelName, updatedClientsInChannel);
		this.clientIdToChannel.delete(client.id);

		// leave channel
		client.leave(channelName);

		// inform all other users in the channel that a user left
		this.server.to(channelName).emit('userLeft', member);
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('sendMessageToChannel')
	async handleChannelMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { messageText: string, channelName: string }): Promise<void> {
		const intraId = this.sharedService.clientToIntraId.get(client.id)
		const message: Message = await this.chatService.handleChannelMessage(intraId, data.channelName, data.messageText);
		const allClientIds: string[] = this.channelToClientIds.get(data.channelName);
		if (allClientIds) {
			const nonBlockedClientIds: string[] = await this.chatService.getNonBlockedClientIds(intraId, client.id, allClientIds);
			this.server.to(nonBlockedClientIds).emit('message', message);
		}
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('kickUser')
	async kickUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.sharedService.clientToIntraId.get(client.id);
			const clientIdsInChannel: string[] = this.channelToClientIds.get(data.channelName);
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
			const clientIdsInChannel: string[] = this.channelToClientIds.get(data.channelName);
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
		let clientIds: string[] = [];
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

	private findOtherClientId(otherIntraId: number) {
		for (const [client, id] of this.sharedService.clientToIntraId.entries()) {
			if (id === otherIntraId) {
				return client;
			}
		}
	}

	@UseGuards(ClientGuard)
	@SubscribeMessage('gameChallenge')
	async gameChallenge(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number }): Promise<void> {
		const intraId = this.sharedService.clientToIntraId.get(client.id);
		const user: User = await this.authService.findUserById(intraId);
		const gameId = intraId + "+" + data.otherIntraId;
		const player1: { intraId: number } = {
			intraId: intraId,
		};
		const player2: { intraId: number } = {
			intraId: data.otherIntraId,
		};
		this.gameSharedService.playerData.set(gameId, { player1, player2 });
		client.emit("createGame", gameId);
		const otherClientId = this.findOtherClientId(data.otherIntraId);
		console.log(otherClientId);
		const info: { gameId: string, user: User } = {
			gameId: gameId,
			user: user,
		};
		console.log({ info });
		client.to(otherClientId).emit("inviteForGame", info);
	}
}
