import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Achievements, Prisma, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserService } from 'src/user/user.service';
import { K } from './constants';
import { GameSharedService } from './game.shared.service';
import { Game, Players } from './types';
import { AuthService } from 'src/auth/auth.service';
import { AchievementsService } from 'src/achievements/achievements.service';

@Injectable()
export class GameService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly userService: UserService,
		private readonly authService: AuthService,
		private readonly gameSharedService: GameSharedService,
		private readonly achievementsService: AchievementsService,
	) { }

	gameData(): Game {
		const game: Game = {
			player1Position: 240,
			player2Position: 240,
			ballPosition: { top: 280, left: 386 },
			ballVelocity: { x: 5, y: 5 },
			gameStarted: false,
			gameEnded: false,
			player1Score: 0,
			player2Score: 0,
			turnPlayerOne: true,
			turnPlayerTwo: false,
		};
		return (game);
	}

	assignPlayers(clientId: string, intraId: number, roomName: string): Players | null {
		let playerSet: Players;
		let player1: { clientId: string, intraId: number, joined: boolean };
		let player2: { clientId: string, intraId: number, joined: boolean };
		const players: Players = this.gameSharedService.playerData.get(roomName);
		if (players && players.player1.intraId === intraId) {
			if (!(players.player1.clientId === '' || players.player1.clientId === clientId)) {
				return (null);
			}
			player1 = {
				clientId: clientId,
				intraId: intraId,
				joined: true,
			};
			player2 = players.player2;
			this.gameSharedService.playerData.set(roomName, { player1, player2 });
			playerSet = { player1, player2 };
		}
		else if (players && players.player2.intraId === intraId) {
			if (!(players.player2.clientId === '' || players.player2.clientId === clientId)) {
				return (null);
			}
			player2 = {
				clientId: clientId,
				intraId: intraId,
				joined: true,
			};
			player1 = players.player1;
			this.gameSharedService.playerData.set(roomName, { player1, player2 });
			playerSet = { player1, player2 };
		}
		else {
			return null;
		}
		return (playerSet);
	}

	movement(movement: string): number {
		if (movement === 'up') {
			return (-25);
		}
		else if (movement === 'down') {
			return (25);
		}
		else {
			return (0);
		}
	}

	canMove(position: number, player: string, game: Game): boolean {
		if (position === 0) {
			return (false);
		}
		if (player === 'playerone') {
			const newPositionPlayerOne = game.player1Position + position;
			if (newPositionPlayerOne <= 500 && newPositionPlayerOne >= 0) {
				return (true);
			}
		}
		else if (player === 'playertwo') {
			const newPositionPlayerTwo = game.player2Position + position;
			if (newPositionPlayerTwo <= 500 && newPositionPlayerTwo >= 0) {
				return (true);
			}
		}
		return (false);
	}

	ballMovement(gameStatus: Game, roomName: string): Game {
		const ballPosition = {
			top: gameStatus.ballPosition.top + gameStatus.ballVelocity.y,
			left: gameStatus.ballPosition.left + gameStatus.ballVelocity.x,
		};
		// Check for collision with top or bottom walls
		if (ballPosition.top <= 0 || ballPosition.top >= 565) {
			gameStatus.ballVelocity.y = -gameStatus.ballVelocity.y;
		}
		const paddleOneLeft = 0;
		const paddleOneRight = 15;
		const paddleOneTop = gameStatus.player1Position;
		const paddleOneBottom = gameStatus.player1Position + 80;

		const paddleTwoLeft = 750;
		const paddleTwoRight = 765;
		const paddleTwoTop = gameStatus.player2Position;
		const paddleTwoBottom = gameStatus.player2Position + 80;
		// Check for score
		if (ballPosition.left <= 0 ||
			ballPosition.left + 20 >= paddleOneLeft &&
			ballPosition.left + 20 <= paddleOneRight + 15 &&
			ballPosition.top + 20 >= paddleOneTop &&
			ballPosition.top <= paddleOneBottom) {
			gameStatus.ballPosition = { top: 300, left: 150 };
			gameStatus.ballVelocity = { x: 5, y: 5 };
			gameStatus.player2Score++;
			gameStatus.turnPlayerOne = true;
			gameStatus.turnPlayerTwo = false;
			gameStatus.gameStarted = false;
			if (gameStatus.player2Score >= 3) {
				gameStatus.gameEnded = true;
				this.endGame(gameStatus.player1Score, gameStatus.player2Score, roomName);
			}
		}
		else if (ballPosition.left + 20 >= 770 || //old value 780
			ballPosition.left + 20 >= paddleTwoLeft &&
			ballPosition.left + 20 <= (paddleTwoLeft - 15) &&
			ballPosition.top >= paddleTwoTop &&
			ballPosition.top <= (paddleTwoBottom - 15)) {
			gameStatus.ballPosition = { top: 300, left: 650 };
			gameStatus.ballVelocity = { x: -5, y: -5 };
			gameStatus.player1Score++;
			gameStatus.turnPlayerOne = false;
			gameStatus.turnPlayerTwo = true;
			gameStatus.gameStarted = false;
			if (gameStatus.player1Score >= 3) {
				gameStatus.gameEnded = true;
				this.endGame(gameStatus.player1Score, gameStatus.player2Score, roomName);
			}
		}
		else {
			gameStatus.ballPosition = ballPosition;
		}
		if (gameStatus.ballVelocity.x < 0 &&                        // T added check for ball direction (if ball direction is positive it will never be a collision)
			ballPosition.left <= paddleOneRight + 15 &&
			ballPosition.left >= paddleOneLeft &&
			ballPosition.top + 20 >= paddleOneTop &&
			ballPosition.top <= paddleOneBottom) {
			gameStatus.ballVelocity.x = -gameStatus.ballVelocity.x;
		}
		// Check for collision with player2 paddle
		else if (gameStatus.ballVelocity.x > 0 &&                // T added check for ball direction (if ball direction is negative it will never be a collision)
			ballPosition.left + 20 >= paddleTwoLeft &&          // Right edge of the ball
			ballPosition.left <= paddleTwoRight + 15 &&               // Left edge of the paddle
			ballPosition.top + 20 >= paddleTwoTop &&             // Bottom edge of the ball
			ballPosition.top <= paddleTwoBottom) {               // Top edge of the paddle
			gameStatus.ballVelocity.x = -gameStatus.ballVelocity.x;
		}
		return (gameStatus);
	}

	async endGame(player1Score: number, player2Score: number, roomName: string): Promise<void> {
		try {
			const players: Players = this.gameSharedService.playerData.get(roomName);
			if (!players) {
				return;
			}
			this.gameSharedService.playerData.delete(roomName);
			let winner: boolean;

			if (player1Score === 3) {
				winner = true;
			} else {
				winner = false;
			}

			const player1: User = await this.authService.findUserById(players.player1.intraId);
			const player2: User = await this.authService.findUserById(players.player2.intraId);

			if (winner) {
				await this.prisma.matchHistory.create({
					data: {
						winnerIntraId: player1.intraId,
						winnerScore: player1Score,
						winnerName: player1.name,
						winnerAvatar: player1.avatar,
						loserIntraId: player2.intraId,
						loserScore: player2Score,
						loserName: player2.name,
						loserAvatar: player2.avatar,
					}
				});
				this.update_win_loss_elo(player1, player2);
			} else {
				await this.prisma.matchHistory.create({
					data: {
						winnerIntraId: player2.intraId,
						winnerScore: player2Score,
						winnerName: player2.name,
						winnerAvatar: player2.avatar,
						loserIntraId: player1.intraId,
						loserScore: player1Score,
						loserName: player1.name,
						loserAvatar: player1.avatar,
					}
				});
				this.update_win_loss_elo(player2, player1);
			}
		} catch (error) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async update_win_loss_elo(winner: User, loser: User): Promise<void> {
		const { newWinnerElo, newLoserElo }: { newWinnerElo: number, newLoserElo: number } = this.calculate_new_elo(winner.elo, loser.elo);
		await this.update_loser(loser.intraId, newLoserElo);
		await this.update_winner(winner.intraId, newWinnerElo);
	}

	private calculate_new_elo(winnerElo: number, loserElo: number): { newWinnerElo: number, newLoserElo: number } {
		const expectedEloWinner: number = 1 / (1 + (10 ** ((loserElo - winnerElo) / 400)));
		const eloChange = K * (1 - expectedEloWinner);
		const newWinnerElo: number = Math.round(winnerElo + eloChange);
		const newLoserElo: number = Math.round(loserElo - eloChange);
		return {
			newWinnerElo,
			newLoserElo
		}
	}

	private async update_winner(winnerIntraId: number, newWinnerElo: number): Promise<void> {
		try {
			const user: (User & { achievements: Achievements }) = await this.prisma.user.update({
				where: {
					intraId: winnerIntraId,
				},
				data: {
					wins: {
						increment: 1,
					},
					winStreak: {
						increment: 1,
					},
					elo: newWinnerElo,
					lossStreak: 0,
				},
				include: {
					achievements: true,
				}
			});
			await this.achievementsService.checkPlayedGame(user);
			if (user.wins === 1) {
				await this.achievementsService.checkWonGame(user);
			}
			else if (user.wins === 3) {
				await this.achievementsService.checkWon3Game(user);
			}
			if (user.winStreak === 3) {
				await this.achievementsService.checkWon3GameRow(user);
			}
			const leaderboard: User[] = await this.userService.getLeaderboard();
			if (leaderboard[0].intraId === user.intraId) {
				await this.achievementsService.checkRank1(user);
			}
		} catch (error: any) {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				if (error.code === 'P2001') {
					throw new NotFoundException('Unable to update achievement, user not found');
				}
			}
			throw new InternalServerErrorException(error.message || "Prisma failed to update user.wins");
		}
	}

	private async update_loser(loserIntraId: number, newLoserElo: number): Promise<void> {
		try {
			const user: (User & { achievements: Achievements }) = await this.prisma.user.update({
				where: {
					intraId: loserIntraId,
				},
				data: {
					losses: {
						increment: 1,
					},
					lossStreak: {
						increment: 1,
					},
					elo: newLoserElo,
					winStreak: 0,
				},
				include: {
					achievements: true,
				}
			});
			await this.achievementsService.checkPlayedGame(user);
			if (user.losses === 1) {
				this.achievementsService.checkLoseGame(user);
			}
			if (user.lossStreak === 3) {
				this.achievementsService.checkLose3GameRow(user);
			}
		} catch (error: any) {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				if (error.code === 'P2001') {
					throw new NotFoundException('Unable to update achievement, user not found');
				}
			}
			throw new InternalServerErrorException(error.message || "Prisma failed to update user.losses");
		}
	}
}
