import { Injectable, InternalServerErrorException, Logger, NotFoundException, Res, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AllOtherUsers, Prisma, User } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import { Socket } from 'socket.io';

@Injectable()
export class AuthService {
	constructor(
		private readonly configService: ConfigService,
		private readonly prisma: PrismaService,
		private readonly jwtService: JwtService,
	) { }
	private readonly logger: Logger = new Logger('AuthService');

	async validateUser(profile: any): Promise<User> | null {
		const user: User = await this.findUserById(profile.intraid);
		if (!user) {
			return this.createUser(profile);
		}

		return user;
	}

	async findUserById(id: number): Promise<User> | null {
		try {
			const user: User = await this.prisma.user.findUnique({
				where: {
					intraId: id,
				},
			});
			return user;
		} catch (error) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async setBearerToken(
		user: User,
		@Res({ passthrough: true }) res: Response,
	): Promise<void> {
		const token: { access_token: string } = await this.signToken(user);

		res.cookie('jwt', token.access_token, {
			httpOnly: true,
			domain: `${process.env.HOST}`,
		});

		res.redirect(`http://${process.env.HOST}:5173`);
	}

	async setBearerTokenForTwofa(
		user: User,
		@Res({ passthrough: true }) res: Response,
	): Promise<void> {
		const token = await this.signToken(user);

		res.cookie('jwt', token.access_token, {
			httpOnly: true,
			domain: `${process.env.HOST}`,
		});
	}

	async signToken(user: User): Promise<{ access_token: string }> {
		const payload = { name: user.intraName, sub: user.intraId };

		return {
			access_token: await this.jwtService.signAsync(payload, {
				expiresIn: '24h',
				secret: this.configService.get('JWT_SECRET'),
			}),
		};
	}

	getJwtTokenFromSocket(client: Socket): string {
		const { headers } = client.handshake;
		const allCookies = headers?.cookie;

		if (!allCookies) {
			throw new UnauthorizedException('Could not find cookies');
		}

		const jwtCookie = allCookies
			.split(';')
			.map((cookie: string) => cookie.trim())
			.find((cookie: string) => cookie.startsWith('jwt='));

		if (!jwtCookie) {
			throw new UnauthorizedException('Could not find cookie with jwt token');
		}

		const [, token] = jwtCookie.split('=');

		if (!token) {
			throw new UnauthorizedException('Could not find jwt token');
		}

		return token;
	}

	async verifyToken(token: string): Promise<{ name: string; sub: number }> {
		try {
			const secret: string = this.configService.get('JWT_SECRET');

			const payload: any = await this.jwtService.verify(token, {
				secret: secret,
				clockTolerance: 100,
			});

			const name: string = payload.name;
			const sub: number = payload.sub;
			return { name, sub };
		} catch (error) {
			throw new UnauthorizedException('Token is invalid');
		}
	}

	logout(user: User, @Res({ passthrough: true }) res: Response) {
		res.cookie('jwt', '', {
			httpOnly: true,
			domain: `${process.env.HOST}`
		});
	}

	async createUser(profile: any): Promise<User> | null {
		const default_avatar: string = this.pick_random_default_avatar();

		try {
			const user: User = await this.prisma.user.create({
				data: {
					name: profile.username,
					intraId: profile.intraid,
					intraName: profile.username,
					avatar: default_avatar,
					allOtherUsers: {
						create: [],
					},
					achievements: {
						create: {}
					},
				},
			});
			this.updateUsersOfNewUser(user.intraId);
			this.updateSelfWithOtherUsers(user.intraId);

			return (user);
		} catch (error) {
			throw new InternalServerErrorException(error.message);
		}
	}

	pick_random_default_avatar(): string {
		const avatar_array: string[] = [
			"src/assets/default_avatars/Cody_Christmas1.jpeg",
			"src/assets/default_avatars/Cody_Christmas2.jpeg",
			"src/assets/default_avatars/Cody_Cute.jpeg",
			"src/assets/default_avatars/Cody_Droopy.jpeg",
			"src/assets/default_avatars/Cody_Majestic.jpeg",
			"src/assets/default_avatars/Cody_Outside.jpeg",
			"src/assets/default_avatars/Cody_Pancake.jpeg",
			"src/assets/default_avatars/Cody_Punky.jpeg",
			"src/assets/default_avatars/Cody_Puppy.jpeg",
			"src/assets/default_avatars/Cody_Sad.jpeg",
			"src/assets/default_avatars/Cody_Seal.jpeg",
			"src/assets/default_avatars/Cody_Sleepy.jpeg",
			"src/assets/default_avatars/Cody_Stare.jpeg",
			"src/assets/default_avatars/Cody_Stuffed_Animal.jpeg",
			"src/assets/default_avatars/Cody_Sunset.jpeg",
			"src/assets/default_avatars/Cody_Young.jpeg",
		];
		const random_number = Math.floor(Math.random() * 16);
		return avatar_array[random_number];
	}

	async updateSelfWithOtherUsers(intraId: number) {
		try {
			const userlist: User[] = await this.prisma.user.findMany({
				where: {
					NOT: {
						intraId: intraId,
					}
				}
			});

			const intraIds: number[] = userlist.map(userlist => userlist.intraId);
			let relationArray: AllOtherUsers[] = [];

			intraIds.forEach((value: number) => {
				const otherUser = this.newRelationObject(value);
				relationArray.push(otherUser);
			});

			await this.prisma.user.update({
				where: { intraId: intraId },
				data: {
					allOtherUsers: {
						create: relationArray,
					},
				},
				include: {
					allOtherUsers: true,
				},
			});
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				if (error.code === 'P2001') {
					throw new NotFoundException('Unable to update self with others, others not found');
				}
			}
			throw new InternalServerErrorException(error.message);
		}
	}

	async updateUsersOfNewUser(intraId: number) {
		try {
			const usersToUpdate = await this.prisma.user.findMany({
				where: {
					intraId: {
						not: intraId,
					},
				},
				include: {
					allOtherUsers: true,
				},
			});
			const newRelationObject = this.newRelationObject(intraId)

			const promises = usersToUpdate.map(async (user) => {
				await this.prisma.user.update({
					where: {
						intraId: user.intraId,
					},
					data: {
						allOtherUsers: {
							create: newRelationObject
						},
					},
				});
			});

			await Promise.all(promises);
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				if (error.code === 'P2001') {
					throw new NotFoundException('Unable to update other users with self, others not found');
				}
			}
			throw new InternalServerErrorException(error.message);
		}
	}

	newRelationObject(intraId: number): any {
		return {
			otherIntraId: intraId,
		};
	}
}
