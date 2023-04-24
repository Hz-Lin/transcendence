import { Body, Controller, Get, Post, Patch, Query, Req, UseGuards, Delete } from '@nestjs/common';
import { Channel, ChannelMode, User } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards';
import { ChatService } from './chat.service';
import { AddUserToChannelDto, ChangePasswordDto, CreateChannelDto, CreateDMChannelDto, DeletePasswordDto, PromoteMemberToAdminDto } from './dto';
import { RemoveUserFromChannelDto } from './dto/remove-user-from-channel.dto';
import { Punishment, DMChannel, Member, Message } from './types';
import { GetUser } from 'src/decorators/get-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
	constructor(private readonly chatService: ChatService) { }

	@Post('createChannel')
	async createChannel(@Req() request, @Body() createChannelDto: CreateChannelDto): Promise<string> {
		const channelMode: ChannelMode = createChannelDto.channelMode;
		const channelName: string = createChannelDto.channelName;
		let password: string = null;
		if (channelMode === 'PROTECTED') {
			password = createChannelDto.password;
		}
		const user: User = request.user;
		return await this.chatService.createChannel(channelMode, channelName, password, user.intraId);
	}

	@Post('createDMChannel')
	async createDMChannel(@Req() request, @Body() createDMChannelDto: CreateDMChannelDto): Promise<string> {
		const user: User = request.user;
		const otherIntraId: number = createDMChannelDto.otherIntraId;
		return await this.chatService.createDMChannel(user, otherIntraId);
	}

	@Post('addUserToChannel')
	async addUserToChannel(@Req() request, @Body() addUserToChannel: AddUserToChannelDto): Promise<void> {
		const user: User = request.user;
		const intraId: number = user.intraId;
		const channelName: string = addUserToChannel.channelName;
		return await this.chatService.addUserToChannel(intraId, channelName);
	}

	@Delete('removeUserFromChannel')
	async removeUserFromChannel(@Req() request, @Body() removeUserFromChannelDto: RemoveUserFromChannelDto): Promise<void> {
		const user: User = request.user;
		const intraId: number = user.intraId;
		const channelName: string = removeUserFromChannelDto.channelName;
		return await this.chatService.removeUserFromChannel(intraId, channelName);
	}

	@Get('getAllChannels')
	async getAllChannels(): Promise<Channel[]> {
		return await this.chatService.getAllChannels();
	}

	@Get('getMyChannels')
	async getMyChannels(@Req() request): Promise<Channel[]> {
		const user = request.user;
		return await this.chatService.getMyChannels(user);
	}

	@Get('getMyDMChannelsWithUser')
	async getMyDMChannelsWithUser(@Req() request): Promise<DMChannel[]> {
		const user: User = request.user;
		return await this.chatService.getMyDMChannelsWithUser(user);
	}

	@Get('getAllMessagesInChannel')
	async getAllMessagesInChannel(@GetUser() user: User, @Query() params: { channelName: string }): Promise<Message[]> {
		const channelName: string = params.channelName;
		return await this.chatService.getFilteredMessages(user, channelName);
	}

	@Get('checkPassword')
	async checkPassword(@Query() params: { channelName: string, password: string }): Promise<boolean> {
		const channelName: string = params.channelName;
		const password: string = params.password;
		return await this.chatService.checkPassword(channelName, password);
	}

	@Patch('changePassword')
	async changePassword(@Req() request, @Body() changePasswordDto: ChangePasswordDto): Promise<void> {
		const channelName: string = changePasswordDto.channelName;
		const oldPassword: string = changePasswordDto.oldPassword;
		const newPassword: string = changePasswordDto.newPassword;
		const user: User = request.user;
		return await this.chatService.changePassword(user, channelName, oldPassword, newPassword);
	}

	@Patch('deletePassword')
	async deletePassword(@Req() request, @Body() deletePasswordDto: DeletePasswordDto): Promise<void> {
		const channelName: string = deletePasswordDto.channelName;
		const password: string = deletePasswordDto.password;
		const user: User = request.user;
		return await this.chatService.deletePasswordAndSetChannelModeToPublic(user, channelName, password);
	}

	@Patch('setPassword')
	async setPassword(@Req() request, @Body() setPasswordDto: DeletePasswordDto): Promise<void> {
		const channelName: string = setPasswordDto.channelName;
		const password: string = setPasswordDto.password;
		const user: User = request.user;
		return await this.chatService.setPasswordAndSetChannelModeToProtected(user, channelName, password);
	}

	@Get('getMembersInChannel')
	async getMembersInChannel(@Query() params: { channelName: string }): Promise<Member[]> {
		const channelName: string = params.channelName;
		return await this.chatService.getMembersInChannel(channelName);
	}

	@Patch('promoteMemberToAdmin')
	async promoteMember(@Req() request, @Body() promoteMemberToAdminDto: PromoteMemberToAdminDto): Promise<void> {
		const channelName: string = promoteMemberToAdminDto.channelName;
		const otherIntraId: number = promoteMemberToAdminDto.otherIntraId;
		const user: User = request.user;
		return await this.chatService.promoteMemberToAdmin(user, channelName, otherIntraId);
	}

	@Patch('demoteAdminToMember')
	async demoteAdmin(@Req() request, @Body() demoteAdminToMember: PromoteMemberToAdminDto): Promise<void> {
		const channelName: string = demoteAdminToMember.channelName;
		const otherIntraId: number = demoteAdminToMember.otherIntraId;
		const user: User = request.user;
		return await this.chatService.demoteAdminToMember(user, channelName, otherIntraId);
	}

	// returns a Punishment object
	// - status: boolean
	// - time: number | null, duration of punishment that is left in seconds
	@Get('amIBanned')
	async amIBanned(@Req() request, @Query() params: { channelName: string }): Promise<Punishment> {
		const intraId: number = request.user.intraId;
		const channelName: string = params.channelName;
		return await this.chatService.isMemberBanned(intraId, channelName);
	}

	// returns a Punishment object
	// - status: boolean
	// - time: number | null, duration of punishment that is left in seconds
	@Get('isMemberBanned')
	async isMemberBanned(@Query() params: { intraId: number, channelName: string }): Promise<Punishment> {
		const intraId: number = params.intraId;
		const channelName: string = params.channelName;
		return await this.chatService.isMemberBanned(intraId, channelName);
	}

	// returns a Punishment object
	// - status: boolean
	// - time: number | null, duration of punishment that is left in seconds
	@Get('amIMuted')
	async amIMuted(@GetUser() user: User, @Query() params: { channelName: string }): Promise<Punishment> {
		const intraId: number = user.intraId;
		const channelName: string = params.channelName;
		return await this.chatService.isMemberMuted(intraId, channelName);
	}

	// returns a Punishment object
	// - status: boolean
	// - time: number | null, duration of punishment that is left in seconds
	@Get('isMemberMuted')
	async isMemberMuted(@Query() params: { intraId: number, channelName: string }): Promise<Punishment> {
		const intraId: number = params.intraId;
		const channelName: string = params.channelName;
		return await this.chatService.isMemberMuted(intraId, channelName);
	}
}
