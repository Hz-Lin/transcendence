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
import { Membership, User } from '@prisma/client';
import { ChatService } from './chat.service';
import { Message } from './types';
import { ChatSharedService } from './chat.shared.service';
import { GameSharedService } from 'src/game/game.shared.service';
import { ChatClientGuard } from 'src/auth/guards/chat-client-auth-gaurd';

@WebSocketGateway({
	cors: {
		origin: `http://${process.env.HOST}:5173`,
		credentials: true,
	},
	namespace: '/chat',
})
export class ChatGateway
	implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
	constructor(
		private readonly authService: AuthService,
		private readonly chatService: ChatService,
		private readonly jwtStrategy: JwtStrategy,
		private readonly chatSharedService: ChatSharedService,
		private readonly gameSharedService: GameSharedService,
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
			client.disconnect();
		}
		this.chatSharedService.clientToIntraId.set(client.id, user.intraId);
		client.emit('hasConnected');
		this.logger.log(`Client connected: ${client.id}`);
	}

	@UseGuards(ChatClientGuard)
	async handleDisconnect(@ConnectedSocket() client: Socket): Promise<void> {
		const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
		const channelName: string = this.clientIdToChannel.get(client.id);

		const allClientsInChannel = this.channelToClientIds.get(channelName) || [];
		const index = allClientsInChannel.findIndex((clientId: string) => clientId === client.id)
		if (index !== -1) {
			allClientsInChannel.splice(index, 1);
		}
		this.channelToClientIds.set(channelName, allClientsInChannel);
		this.chatSharedService.clientToIntraId.delete(client.id);
		this.clientIdToChannel.delete(client.id);

		if (allClientsInChannel.length > 0) {
			const member: (Membership & { user: User; }) = await this.chatService.getMemberWithUser(channelName, intraId);
			client.to(allClientsInChannel).emit('userLeft', member);
		}
		client.disconnect();
		this.logger.log(`Client disconnected: ${client.id}`);
	}

	@UseGuards(ChatClientGuard)
	@SubscribeMessage('joinChannel')
	async handleJoinChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
		const member: (Membership & { user: User; }) = await this.chatService.getMemberWithUser(channelName, intraId);
		if (!member) {
			client.emit("joined", null);
			return;
		}

		// add client to channel map
		const otherClientsInChannel: string[] = this.channelToClientIds.get(channelName) || [];
		this.channelToClientIds.set(channelName, [...otherClientsInChannel, client.id]);
		this.clientIdToChannel.set(client.id, channelName);

		// join channel
		client.join(channelName);
		client.emit('joined', member);

		if (otherClientsInChannel.length > 0) {
			// inform all other users in the channel that a user joined
			client.to(channelName).emit('userJoined', member);
			// inform current user which other members are in the channel
			const otherJoinedMembersInChannel: (Membership & { user: User; })[] = await this.getJoinedMembersInChannel(channelName, otherClientsInChannel);
			client.emit('otherJoinedMembers', otherJoinedMembersInChannel);
		}
	}

	private async getJoinedMembersInChannel(channelName: string, otherClientsInChannel: string[]): Promise<(Membership & { user: User })[]> {
		const otherUserIntraIds: number[] = otherClientsInChannel.map(clientId => this.chatSharedService.clientToIntraId.get(clientId));
		const uniqueUserIntraIds: number[] = [...new Set(otherUserIntraIds)];
		const otherMembersInChannel: (Membership & { user: User })[] = await this.chatService.getMembersWithUser(channelName);
		const otherJoinedMembersInChannel: (Membership & { user: User })[] = otherMembersInChannel.filter(member =>
			uniqueUserIntraIds.includes(member.intraId)
		);
		return otherJoinedMembersInChannel;
	}

	@UseGuards(ChatClientGuard)
	@SubscribeMessage('leaveChannel')
	async handleLeaveChannel(@ConnectedSocket() client: Socket, @MessageBody() channelName: string): Promise<void> {
		const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
		const member: (Membership & { user: User; }) = await this.chatService.getMemberWithUser(channelName, intraId);

		const clientsInChannel: string[] = this.channelToClientIds.get(channelName) || [];
		const updatedClientsInChannel: string[] = clientsInChannel.filter(clientId => clientId !== client.id);
		this.channelToClientIds.set(channelName, updatedClientsInChannel);
		this.clientIdToChannel.delete(client.id);

		// leave channel
		client.leave(channelName);
		client.emit('left');

		// inform all other users in the channel that a user left
		if (updatedClientsInChannel.length > 0) {
			this.server.to(channelName).emit('userLeft', member);
		}
	}

	@UseGuards(ChatClientGuard)
	@SubscribeMessage('sendMessageToChannel')
	async handleChannelMessage(@ConnectedSocket() client: Socket, @MessageBody() data: { messageText: string, channelName: string }): Promise<void> {
		const intraId = this.chatSharedService.clientToIntraId.get(client.id)
		const message: Message = await this.chatService.handleChannelMessage(intraId, data.channelName, data.messageText);
		const allClientIds: string[] = this.channelToClientIds.get(data.channelName);
		if (allClientIds) {
			const nonBlockedClientIds: string[] = await this.chatService.getNonBlockedClientIds(intraId, client.id, allClientIds);
			this.server.to(nonBlockedClientIds).emit('message', message);
		}
	}

	@UseGuards(ChatClientGuard)
	@SubscribeMessage('kickUser')
	async kickUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
			const clientIdsInChannel: string[] = this.channelToClientIds.get(data.channelName);
			const canBeKicked: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			const clientIds: string[] = this.getClientIds(clientIdsInChannel, data.otherIntraId);
			if (clientIds.length === 0) {
				return;
			}
			if (canBeKicked === true) {
				this.server.to(clientIds).emit('leaveChannel', data.channelName);
			}
			else {
				client.emit('error', { message: 'Cannot kick user' });
			}
		} catch (error) {
			client.emit('error', error?.message || 'An error occured in chat.gateway kickUser');
		}
	}

	// currently users are banned, whether they are in the channel or not
	// if they are in the channel they are also kicked
	@UseGuards(ChatClientGuard)
	@SubscribeMessage('banUser')
	async banUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
			const clientIdsInChannel: string[] = this.channelToClientIds.get(data.channelName);
			const canBeBanned: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			const clientIds: string[] = this.getClientIds(clientIdsInChannel, data.otherIntraId);
			if (canBeBanned === true) {
				await this.chatService.banUser(data.otherIntraId, data.channelName);
				if (clientIds.length > 0) {
					this.server.to(clientIds).emit('leaveChannel', data.channelName);
				}
			}
			else {
				client.emit('error', { message: 'Cannot ban user' });
			}
		} catch (error) {
			client.emit('error', error?.message || 'An error occured in chat.gateway banUser');
		}
	}

	// currently users are muted, whether they are in the channel or not
	// technically we can remove the error emit and put this function in the controller
	@UseGuards(ChatClientGuard)
	@SubscribeMessage('muteUser')
	async muteUser(@ConnectedSocket() client: Socket, @MessageBody() data: { otherIntraId: number, channelName: string }): Promise<void> {
		try {
			const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
			const canBeMuted: boolean = await this.chatService.canBePunished(intraId, data.otherIntraId, data.channelName);
			if (canBeMuted === true) {
				await this.chatService.muteUser(data.otherIntraId, data.channelName);
			}
			else {
				client.emit('error', { message: 'Cannot ban user' });
			}
		} catch (error) {
			client.emit('error', error?.message || 'An error occured in chat.gateway muteUser');
		}
	}

	@UseGuards(ChatClientGuard)
	@SubscribeMessage('gameChallenge')
	async gameChallenge(@ConnectedSocket() client: Socket, @MessageBody() data: {
		channelName: string,
		otherIntraId: number,
	}): Promise<void> {
		const intraId: number = this.chatSharedService.clientToIntraId.get(client.id);
		const user: User = await this.authService.findUserById(intraId);
		const gameId: string = this.generateString(8);
		const player1: { clientId: string, intraId: number, joined: boolean } = {
			clientId: '',
			intraId: intraId,
			joined: false,
		};
		const player2: { clientId: string, intraId: number, joined: boolean } = {
			clientId: '',
			intraId: data.otherIntraId,
			joined: false,
		};
		this.gameSharedService.playerData.set(gameId, { player1, player2 });
		client.emit("createGame", gameId);

		const clientIds: string[] = this.channelToClientIds.get(data.channelName) || [];
		const otherClientIds: string[] = this.getClientIds(clientIds, data.otherIntraId);
		const info: { gameId: string, user: User } = {
			gameId: gameId,
			user: user,
		};
		client.to(otherClientIds).emit("inviteForGame", info);
	}

	private generateString(length: number): string {
		const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		const charactersLength = characters.length;
		for (let i = 0; i < length; i++) {
			result += characters.charAt(Math.floor(Math.random() * charactersLength));
		}
		return result;
	}

	private getClientIds(clientIdsInChannel: string[], otherIntraId: number): string[] {
		let clientIds: string[] = [];
		for (const clientId of clientIdsInChannel) {
			if (otherIntraId === this.chatSharedService.clientToIntraId.get(clientId)) {
				clientIds.push(clientId);
			}
		}
		return clientIds;
	}
}
