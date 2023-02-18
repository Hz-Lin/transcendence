import { Controller, Get, Request, Res, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard42 } from './guards';
import { JwtAuthGuard } from './guards';

@Controller('auth')
export class AuthController {
	constructor (private authService: AuthService) {}

	@UseGuards(AuthGuard42)
	@Get('login')
	async login (@Request() req) {
		return req.user;
	}

	@UseGuards(AuthGuard42)
	@Get('callback')
	async handleIntraReturn(@Request() req, @Res({ passthrough:true }) res: Response) {
		const user: User = req.user;
		return (this.authService.setBearerToken(user, res));
	}

	@UseGuards(JwtAuthGuard)
	@Get('protected')
	printHelloWorld() {
		return ("Hello World!");
	}
}
