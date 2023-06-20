import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { GameService } from './game.service';
import { Server, Socket } from 'socket.io';
import { Game, Players } from './types';
import { Logger, UseGuards } from '@nestjs/common';
import { ActivityStatus, User } from '@prisma/client';
import { AuthService } from 'src/auth/auth.service';
import { JwtStrategy } from 'src/auth/strategy';
import { UserService } from 'src/user/user.service';
import { GameSharedService } from './game.shared.service';
import { GameClientGuard } from 'src/auth/guards/game-client-auth-guard';

@WebSocketGateway({
	cors: {
		origin: `http://${process.env.HOST}:5173`,
		credentials: true,
	},
	namespace: "pong-game",
})
export class GameGateway
	implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
	constructor(
		private readonly authService: AuthService,
		private readonly gameService: GameService,
		private readonly gameSharedService: GameSharedService,
		private readonly jwtStrategy: JwtStrategy,
		private readonly userService: UserService,
	) {
		this.clientToRoomName = new Map<string, string>();
		this.intraIdToClientId = new Map<number, string>();
	}
	private readonly logger: Logger = new Logger('GameGateway');
	private clientToRoomName: Map<string, string>;
	private intraIdToClientId: Map<number, string>;

	@WebSocketServer()
	server: Server;

	afterInit(): void {
		this.logger.log('GameGateway Initialized');
	}

	async handleConnection(client: Socket) {
		this.logger.log(`Client connect id = ${client.id}`);
		let user: User;
		try {
			const token: string = this.authService.getJwtTokenFromSocket(client);
			const payload: { name: string; sub: number } = await this.authService.verifyToken(token);
			user = await this.jwtStrategy.validate(payload);
		} catch (error: any) {
			this.server.to(client.id).emit('unauthorized', { message: 'Authorization is required before a connection can be made' });
			this.logger.error(`Client connection refused: ${client.id}`);
			client.disconnect();
		}
		await this.userService.setActivityStatus(user.intraId, ActivityStatus.INGAME);
		client.emit('hasConnected');
	}

	@SubscribeMessage('setup')
	async handleGameData(client: Socket) {
		let user: User;
		try {
			const token: string = this.authService.getJwtTokenFromSocket(client);
			const payload: { name: string; sub: number } = await this.authService.verifyToken(token);
			user = await this.jwtStrategy.validate(payload);
		} catch (error: any) {
			this.server.to(client.id).emit('unauthorized', { message: 'Authorization is required before a connection can be made' });
			this.logger.error(`Client connection refused: ${client.id}`);
			client.disconnect();
		}
		this.gameSharedService.clientToIntraId.set(client.id, user.intraId);
		this.intraIdToClientId.set(user.intraId, client.id);
		const game: Game = this.gameService.gameData();
		client.emit('gameData', game);
		client.emit('readyToJoin');
	}

	@UseGuards(GameClientGuard)
	async handleDisconnect(client: Socket) {
		const intraId: number = this.gameSharedService.clientToIntraId.get(client.id);
		if (intraId) {
			await this.userService.setActivityStatus(intraId, ActivityStatus.ONLINE);
		}
		this.logger.log(`Client disconnect id = ${client.id}`);
		this.gameSharedService.clientToIntraId.delete(client.id);
		const roomName = this.clientToRoomName.get(client.id);
		if (roomName) {
			const playerData = this.gameSharedService.playerData.get(roomName);
			if (playerData) {
				if (playerData.player1.clientId === client.id) {
					this.gameService.endGame(0, 3, roomName);
				}
				else if (playerData.player2.clientId === client.id) {
					this.gameService.endGame(3, 0, roomName);
				}
				client.to(roomName).emit('gameEnded');
			}
		}
		client.disconnect();
		this.clientToRoomName.delete(client.id);
		this.intraIdToClientId.delete(intraId);
	}

	@UseGuards(GameClientGuard)
	@SubscribeMessage('assignPlayers')
	assignPlayers(@ConnectedSocket() client: Socket, @MessageBody() roomName: string) {
		const intraId: number = this.gameSharedService.clientToIntraId.get(client.id);
		const players: Players = this.gameService.assignPlayers(client.id, intraId, roomName);

		if (players === null) {
			client.emit('error', { message: 'Invalid player' });
			return;
		}
		client.join(roomName);
		this.clientToRoomName.set(client.id, roomName);
		if (this.gameSharedService.playerData.get(roomName).player1.intraId === intraId && players.player2.joined === true) {
			client.emit('playerisSet', players);
			client.to(roomName).emit('playerisSet', players);
		}
		else if (this.gameSharedService.playerData.get(roomName).player2.intraId === intraId && players.player1.joined === true) {
			client.emit('playerisSet', players);
			client.to(roomName).emit('playerisSet', players);
		}
	}

	@UseGuards(GameClientGuard)
	@SubscribeMessage('movePaddle')
	handlePaddleUp(@ConnectedSocket() client: Socket, @MessageBody() object: {
		movement: string,
		player: string,
		roomName: string,
		game: Game,
	}) {
		const position: number = this.gameService.movement(object.movement);
		if (this.gameService.canMove(position, object.player, object.game)) {
			client.emit('updatePaddlePosition', position);
			client.to(object.roomName).emit('otherPlayerUpdatePaddlePosition', position);
		}
	}

	@UseGuards(GameClientGuard)
	@SubscribeMessage('ballMovement')
	handleBallMovement(@ConnectedSocket() client: Socket, @MessageBody() object: {
		gameStatus: Game,
		roomName: string,
	}) {
		const newPositionPlayerOne = object.gameStatus.player1Position; //current position
		const newPositionPlayerTwo = object.gameStatus.player2Position;
		const updatedGameStatus = { ...object.gameStatus }; // Create a copy of the game status
		if (object.gameStatus.turnPlayerOne) {
			updatedGameStatus.player1Position = newPositionPlayerOne;
		}
		else if (object.gameStatus.turnPlayerTwo) {
			updatedGameStatus.player2Position = newPositionPlayerTwo;
		}
		const newBallPosition = this.gameService.ballMovement(updatedGameStatus, object.roomName);
		// this.server.to(object.roomName).emit('updategameStatus', newBallPosition);
		client.emit('updategameStatus', newBallPosition);
		client.to(object.roomName).emit('updategameStatus', newBallPosition);
	}

	@UseGuards(GameClientGuard)
	@SubscribeMessage('startGame')
	handleStartGame(@ConnectedSocket() client: Socket, @MessageBody() roomName: string) {
		client.emit('gameStarted');
		client.to(roomName).emit('gameStarted');
	}

	@UseGuards(GameClientGuard)
	@SubscribeMessage('endGame')
	endGame(@ConnectedSocket() client: Socket, @MessageBody() object: {
		gameStatus: Game,
		roomName: string,
		player: string,
	}) {
		if (!object.gameStatus || !object.roomName || !object.player) {
			return;
		}
		client.to(object.roomName).emit('gameEnded');
		if (object.player === 'playerone') {
			object.gameStatus.player2Score = 3;
			object.gameStatus.player1Score = 0;
		} else {
			object.gameStatus.player1Score = 3;
			object.gameStatus.player2Score = 0;
		}
		this.gameService.endGame(object.gameStatus.player1Score, object.gameStatus.player2Score, object.roomName);
		client.emit('disconnectPlayer');
	}
}
