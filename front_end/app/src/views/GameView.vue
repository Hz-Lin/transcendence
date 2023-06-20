<template>
	<div>
		<!-- <button for togglemode -->
		<input type="checkbox" id="checkbox" @click="toggleColorMode">
		<label for="checkbox">
			<div class="s">
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
				<div class="d"></div>
			</div>
		</label>
		{{ isColorMode ? '' : '' }}
		<div :class="isColorMode ? 'mode-color' : 'mode'">
			<h2>Change Game Mode</h2>
		</div>
		<!-- condition to check if it is color mode thank you dagmar-->
		<div v-if="game" :class="isColorMode ? 'pong-game-color' : 'pong-game-classic'">
			<div class="start-button-container"
				v-if="isPlayerOne && game.turnPlayerOne && !game.gameStarted && !isGameOver">
				<a class="start-button" style="--color:#e9d930;" @click="toggleGame">{{ game.gameStarted ? 'Stop' : 'Start'
				}}
					<span></span>
					<span></span>
					<span></span>
					<span></span>
				</a>
			</div>
			<div class="start-button-container"
				v-if="!isPlayerOne && game.turnPlayerTwo && !game.gameStarted && !isGameOver">
				<a class="start-button" style="--color:#e8eb2c;" @click="toggleGame">{{ game.gameStarted ? 'Stop' : 'Start'
				}}
					<span></span>
					<span></span>
					<span></span>
					<span></span>
				</a>
			</div>
			<div>
				<div class="wave"></div>
			</div>
			<div :class="isColorMode ? 'scoreboard-color' : 'scoreboard'">
				<div :class="isColorMode ? 'score-player1-color' : 'score-player1'">Player One:
					<span id="player-1-score">{{ game.player1Score }}</span>
				</div>
				<div :class="isColorMode ? 'score-player2-color' : 'score-player2'">Player Two:
					<span id="player-2-score">{{ game.player2Score }}</span>
				</div>
			</div>
			<div :class="isColorMode ? 'player1-paddle-color' : 'player1-paddle'"
				:style="{ top: game.player1Position + 'px' }"></div>
			<div :class="isColorMode ? 'player2-paddle-color' : 'player2-paddle'" v-if="game.player2Position"
				:style="{ top: game.player2Position + 'px' }"></div>
			<div :class="isColorMode ? 'ball-round' : 'ball-classic'"
				:style="{ top: game.ballPosition.top + 'px', left: game.ballPosition.left + 'px' }"></div>
			<div>
				<div v-if="playerDisconnect" :class="isColorMode ? 'game-over-color-canvas' : 'game-over-canvas'">
					<h2>Game Over</h2>
					<p>Opponent left the game.</p>
					<p>You win!</p>
				</div>
				<div v-else-if="isGameOver" :class="isColorMode ? 'game-over-color-canvas' : 'game-over-canvas'">
					<h2>Game Over</h2>
					<p>Player {{ game.player1Score === 3 ? 'One' : 'Two' }} wins!</p>
				</div>
				<div v-else-if="playerInvalid" :class="isColorMode ? 'game-over-color-canvas' : 'game-over-canvas'">
					<h2>Game Over</h2>
				</div>
			</div>
		</div>
	</div>
</template>

<script lang="ts">
import io from 'socket.io-client';
import type { Game, Players } from '../types/GameType';
import { computed, ref } from 'vue';
import storeUser from '@/store';
import { HOST } from '@/constants/constants';
import { useToast } from 'primevue/usetoast';
import { useRouter } from 'vue-router';

export default {
	data() {
		const toast = useToast();
		const router = useRouter();
		return {
			game: ref<Game>,
			player: '',
			roomName: '',
			gameOver: false,
			isColorMode: false,
			playerDisconnect: false,
			toast,
			router,
			raf: -1,
			playerInvalid: false,
		};
	},
	setup() {
		const socket = io(`http://${HOST}:3001/pong-game`, { withCredentials: true });
		const game = ref<Game>();

		socket.on('hasConnected', () => {
			socket.emit('setup');
		})

		socket.on('gameData', (gameObject: Game) => {
			game.value = gameObject;
		});
		return { socket, game: computed(() => game.value) };
	},

	computed: {
		isPlayerOne() {
			return this.player === 'playerone';
		},

		isGameOver() {
			if (this.playerDisconnect || this.game.player1Score === 3 || this.game.player2Score === 3) {
				this.gameOver = true;
				window.removeEventListener('keydown', this.handleEvent);
				return true;
			}
			return false;
		}
	},

	mounted() {
		this.socket.on('readyToJoin', () => {
			if (typeof this.$route.params.gameid === 'string') {
				this.roomName = this.$route.params.gameid;
			}
			this.socket.emit('assignPlayers', this.$route.params.gameid);
		});

		this.socket.on('playerisSet', async (players: Players) => {
			if (storeUser.state.user.intraId === players.player1.intraId) {
				this.player = 'playerone';
			}
			else {
				this.player = 'playertwo';
			}
		});

		this.socket.on('gameStarted', () => {
			this.game.gameStarted = true;
			this.raf = requestAnimationFrame(this.update);
		});

		this.socket.on('gameEnded', () => {
			this.game.gameEnded = true;
			this.gameOver = true;
			this.playerDisconnect = true;
		});
		
		this.socket.on('disconnectPlayer', () => {
			this.socket.disconnect();
		});

		this.socket.on('updategameStatus', (gameStatus: Game) => {
			this.game.ballPosition = gameStatus.ballPosition;
			this.game.ballVelocity = gameStatus.ballVelocity;
			this.game.gameStarted = gameStatus.gameStarted;
			this.game.player1Score = gameStatus.player1Score;
			this.game.player2Score = gameStatus.player2Score;
			this.game.turnPlayerOne = gameStatus.turnPlayerOne;
			this.game.turnPlayerTwo = gameStatus.turnPlayerTwo;
		});

		this.socket.on('updatePaddlePosition', (position: number) => {
			if (this.player === 'playerone') {
				this.movePaddle(position);
			}
			else if (this.player === 'playertwo') {
				this.movePaddlePlayerTwo(position);
			}
		});

		this.socket.on('otherPlayerUpdatePaddlePosition', (position) => {
			if (this.player === 'playerone')
				this.movePaddlePlayerTwo(position);
			else if (this.player === 'playertwo')
				this.movePaddle(position);
		});

		this.socket.on('unauthorized', (error: any) => {
			const errorMessage = error.message || 'Error';
			this.toast.add({
				severity: "error",
				summary: "Error",
				detail: `${errorMessage}`,
				life: 3000,
			});
			this.gameOver = true;
		});

		this.socket.on('error', (error: any) => {
			const errorMessage = error.message || 'Error';
			this.toast.add({
				severity: "error",
				summary: "Error",
				detail: `${errorMessage}`,
				life: 3000,
			});
			this.gameOver = true;
			this.playerInvalid = true;
		});

		window.addEventListener('keydown', this.handleEvent);
	},

	beforeUnmount() {
		window.cancelAnimationFrame(this.raf);
		window.removeEventListener('keydown', this.handleEvent);
		if (this.gameOver === false) {
			const data = {
				gameStatus: this.game,
				roomName: this.roomName,
				player: this.player
			}
			this.socket.emit('endGame', data);
		}
		else
			this.socket.disconnect();
	},

	methods: {
		handleEvent(event: KeyboardEvent) {
			if (event.key === 'ArrowUp') {
				const data = {
					movement: 'up',
					player: this.player,
					roomName: this.roomName,
					game: this.game,
				};
				this.socket.emit('movePaddle', data);
			}
			else if (event.key === 'ArrowDown') {
				const data = {
					movement: 'down',
					player: this.player,
					roomName: this.roomName,
					game: this.game,
				};
				this.socket.emit('movePaddle', data);
			}
			else if (event.key === ' ' && this.player === 'playerone' && !this.gameOver && !this.game.gameStarted && this.game.turnPlayerOne && !this.game.turnPlayerTwo)
				this.toggleGame();
			else if (event.key === ' ' && this.player === 'playertwo' && !this.gameOver && !this.game.gameStarted && !this.game.turnPlayerOne && this.game.turnPlayerTwo)
				this.toggleGame();
		},

		toggleGame() {
			if (!this.game.gameStarted) {
				this.game.gameStarted = true;
				this.socket.emit('startGame', this.roomName);
			}
		},

		toggleColorMode() {
			this.isColorMode = !this.isColorMode;
		},

		movePaddle(position: number) {
			this.game.player1Position += position;
		},

		movePaddlePlayerTwo(position: number) {
			this.game.player2Position += position;
		},

		update() {
			if (!this.game.gameStarted) {
				return;
			}
			if (this.game.gameEnded === true || this.playerDisconnect) {
				this.game.gameStarted = false;
				this.gameOver = true;
				return;
			}
			const gameStatus: Game = {
				ballPosition: this.game.ballPosition,
				ballVelocity: this.game.ballVelocity,
				player1Position: this.game.player1Position,
				player2Position: this.game.player2Position,
				player1Score: this.game.player1Score,
				player2Score: this.game.player2Score,
				gameStarted: this.game.gameStarted,
				gameEnded: this.game.gameEnded,
				turnPlayerOne: this.game.turnPlayerOne,
				turnPlayerTwo: this.game.turnPlayerTwo,
			};
			const data = {
				gameStatus: gameStatus,
				roomName: this.roomName,
			}
			if (this.player === 'playerone') {
				this.socket.emit('ballMovement', data);
			}
			requestAnimationFrame(this.update);
		},
	},
};
</script>

<style scoped>
@import url("../assets/game_mode/button.css");
@import url("../assets/game_mode/classic_pong.css");
@import url("../assets/game_mode/color_pong.css");
@import url("../assets/game_mode/color_toggle.css");

@font-face {

	font-family: "Joy";
	src: url("../assets/game_images/JoyfulEaster.ttf");
}

@font-face {
	font-family: "arcadeFont";
	src: url("../assets/game_images/ARCADECLASSIC.TTF");
}

@font-face {
	font-family: "excellent";
	src: url("../assets/game_images/mexcellent 3d.otf");
}

.mode h2 {
	font-family: "arcadeFont";
	color: rgb(240, 248, 89);
	top: 200px;
}
.mode-color h2 {
	font-family: "excellent";
	color: rgb(240, 248, 89);
	top: 200px;
}
.game-over-canvas {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	background-color: rgba(0, 0, 0, 0.5);
	z-index: 999;
}
.game-over-canvas h2 {
	font-family: "arcadeFont";
	font-size: 64px;
	color: white;
	margin-bottom: 16px;
}

.game-over-canvas p {
	font-family: "arcadeFont";
	font-size: 48px;
	color: white;
}

.scoreboard {
	display: flex;
	justify-content: space-between;
	align-items: center;
	position: absolute;
	top: 20px;
	left: 20px;
	right: 20px;
}
.score-player1,
.score-player2 {
	font-size: 40px;
	font-weight: normal;
	color: rgb(217, 250, 32);
	font-family: "arcadeFont";
}
.pong-game img {
	max-width: 100%;
	max-height: 100%;
}
.player1-paddle {
	left: 20px;
	top: 260px;
}
.player2-paddle {
	right: 20px;
	top: 260px;
}

.ball {
	position: absolute;
	width: 20px;
	height: 20px;
	background-color: rgb(33, 34, 32);
}

@keyframes gradient {
	0% {
		background-position: 0% 0%;
	}

	50% {
		background-position: 100% 100%;
	}

	100% {
		background-position: 0% 0%;
	}
}

.wave {

	position: fixed;
	width: 150%;
	height: 16em;
	animation: wave 15s -2s linear infinite;
	transform: translate3d(0, 0, 0);
	opacity: 0.8;
	bottom: 0;
	left: 0;
	z-index: -1;
}
</style>
