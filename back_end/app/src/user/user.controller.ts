import { Body, Controller, Get, Post, Req, UseGuards, Param, UseInterceptors, BadRequestException, UploadedFile, Query, StreamableFile, Put } from '@nestjs/common';
import { Achievements, User } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards';
import { PrismaService } from 'src/prisma/prisma.service';
import { OtherUserIntraDto } from './dto/other-user-intra.dto';
import { FriendRequestList, UserElement } from './types';
import { UserService } from './user.service';
import { UploadAvatarDto } from './dto/upload-avatar-dto';
import { AvatarInterceptor } from './interceptor/avatar.interceptor';
import { UPLOADS_DIRECTORY } from './utils/constants';
import { GetUser } from 'src/decorators/get-user.decorator';
import { UpdateUsernameDto } from './dto/update-username-dto';
import { AchievementsService } from 'src/achievements/achievements.service';

@UseGuards(JwtAuthGuard)
@Controller('user')
export class UserController {
	constructor(private userService: UserService, private achievementService: AchievementsService, private prisma: PrismaService) { }

	@Get('/')
	async getUser(@Req() request): Promise<User> {
		return (await request.user);
	}

	@Get('users')
	async returnUserElements(@Req() request): Promise<UserElement[]> {
		return (await this.userService.getUserElements(request.user));
	}

	@Post('block_user')
	async blockUser(@Req() request, @Body() otherUserIntraDto: OtherUserIntraDto) {
		return (await this.userService.blockUser(request.user, otherUserIntraDto.otherIntraId));
	}

	@Post('unblock_user')
	async unblockUser(@Req() request, @Body() otherUserIntraDto: OtherUserIntraDto) {
		return (await this.userService.unblockUser(request.user, otherUserIntraDto.otherIntraId));
	}

	@Post('friend_request')
	async handleFriendRequest(@Req() request, @Body() otherUserIntraDto: OtherUserIntraDto) {
		return (await this.userService.handleFriendRequest(request.user, otherUserIntraDto.otherIntraId));
	}

	@Get('usersexceptself')
	async getUserListExceptSelf(@Req() request): Promise<User[]> {
		return (await this.userService.getUserListExceptSelf(request.user));
	}

	@Get('friend_request_list')
	async getFriendRequests(@Req() request): Promise<FriendRequestList[]> {
		return (await this.userService.getFriendRequests(request.user));
	}

	@Get('createdummy')
	async createDummyUser(): Promise<void> {
		return (await this.userService.createDummyUser());
	}

	@Get('get_avatar')
	getAvatar(@Query('avatar') avatar: string): StreamableFile {
		return (this.userService.getAvatar(avatar));
	}
	
	@Get('achievements')
	async getAchievements(@GetUser() user: User): Promise<Achievements>{
		return (await this.achievementService.getAchievements(user));
	}
	
	@Get('achievements_other')
	async getAchievementsBasedOnIntraId(@Param() params): Promise<Achievements> {
		const otherIntraId: number = parseInt(params.id);
		return (await this.achievementService.getAchievementsBasedOnIntraId(otherIntraId));
	}

	@Get(':id')
	async getUserElementBasedOnIntraId(@Req() request, @Param() params): Promise<UserElement> {
		const user: User = request.user;
		const otherIntraId: number = parseInt(params.id);
		return (await this.userService.getUserElementBasedOnIntraId(user, otherIntraId));
	}

	@Put('update_username')
	async updateUsername(@GetUser() user: User, @Body() updateUsernameDto: UpdateUsernameDto) {
		return (await this.userService.updateUsername(user, updateUsernameDto.username))
	}

	@Post('avatar')
	@UseInterceptors(AvatarInterceptor)
	async uploadAvatar(
		@GetUser() user: User,
		@UploadedFile() file: Express.Multer.File
		): Promise<void> {
			if (!file || !file.filename) {
				throw new BadRequestException('No file uploaded');
			}
			const filePath = `${UPLOADS_DIRECTORY}/${file.filename}`;
			
			await this.userService.updateAvatar(user.intraId, filePath);
		}
}
