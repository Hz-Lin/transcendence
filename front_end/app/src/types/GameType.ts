export interface Game {
	player1Position: number;
	player2Position: number;
	ballPosition: { top: number, left: number };
	ballVelocity: { x: number, y: number };
	gameStarted: boolean;
	player1Score: number;
    player2Score: number;
}

export interface PlayerData {
	player1: {
		intraId: number,
	};
	player2: {
		intraId: number,
	};
}