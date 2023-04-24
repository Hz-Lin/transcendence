import { HttpException, HttpStatus, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Channel, Membership, User, UserMessage, ChannelType, ChannelMode, Role, AllOtherUsers } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { WsException } from '@nestjs/websockets';
import { Punishment, DMChannel, Member, Message } from './types';
import * as argon2 from "argon2";
import { BANMINUTES, BANSECONDS, MUTEMINUTES, MUTESECONDS } from './constants';
import { SharedService } from './chat.map.shared.service';
import { isEmpty } from 'class-validator';

@Injectable()
export class ChatService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly sharedService: SharedService,
	) { }

	private readonly logger: Logger = new Logger('UserService initialized');

	async createChannel(channelMode: ChannelMode, channelName: string, password: string, intraId: number): Promise<string> {
		const existingChannel: Channel = await this.getChannel(channelName);
		if (existingChannel)
			throw new HttpException({ reason: `Channel ${channelName} already exists` }, HttpStatus.BAD_REQUEST);

		let hashed_password: string;
		if (password !== null) {
			hashed_password = await this.createHashedPassword(password);
		}
		else {
			hashed_password = '';
		}
		try {
			const newChannel = await this.prisma.channel.create({
				data: {
					channelMode: channelMode,
					channelName: channelName,
					channelType: 'NORMAL',
					password: hashed_password,
					memberships: {
						create: {
							role: 'OWNER',
							user: {
								connect: {
									intraId: intraId
								},
							},
						},
					},
				},
			});
			return (newChannel.channelName);
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async createDMChannel(user: User, otherIntraId: number): Promise<string> {
		const getChannel = (intraId: number, otherIntraId: number): string => {
			let members: string[] = [intraId.toString(), otherIntraId.toString()];
			members = members.sort();
			return (`${members.at(0)}&${members.at(1)}`);
		}
		const channelName: string = getChannel(user.intraId, otherIntraId);

		const existingChannel: Channel = await this.getChannel(channelName);
		if (existingChannel)
			throw new HttpException({ reason: 'Channel already exists' }, HttpStatus.BAD_REQUEST);

		try {
			await this.prisma.channel.create({
				data: {
					channelMode: 'PRIVATE',
					channelName: channelName,
					channelType: 'DM',
					memberships: {
						create: {
							user: {
								connect: {
									intraId: user.intraId
								},
							},
						},
					},
				},
			});
			await this.addUserToChannel(otherIntraId, channelName);
			return channelName;
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async addUserToChannel(intraId: number, channelName: string): Promise<void> {
		try {
			const channel: Channel = await this.getChannel(channelName);
			if (!channel) {
				throw new HttpException({ reason: `Channel ${channelName} was not found` }, HttpStatus.BAD_REQUEST);
			}

			const isInChannel: boolean = !!await this.prisma.membership.findFirst({
				where: {
					intraId: intraId,
					channelName: channelName,
				},
			});
			if (isInChannel === true) {
				throw new HttpException({ reason: `User is already a member of ${channelName}` }, HttpStatus.BAD_REQUEST);
			}

			await this.prisma.membership.create({
				data: {
					user: {
						connect: {
							intraId: intraId,
						},
					},
					channel: {
						connect: {
							channelName: channelName,
						}
					},
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async removeUserFromChannel(intraId: number, channelName: string): Promise<void> {
		try {
			const role: Role = await this.getRole(intraId, channelName);
			const count: number = await this.getAmountOfMembersInChannel(channelName);
			if (count === 1) {
				return (this.deleteChannel(channelName));
			}
			await this.prisma.membership.delete({
				where: {
					intraId_channelName: {
						intraId: intraId,
						channelName: channelName,
					}
				}
			});
			if (role === 'OWNER') {
				return (this.transferOwnership(channelName));
			}
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async deleteChannel(channelName: string): Promise<void> {
		try {
			await this.prisma.channel.delete({
				where: {
					channelName: channelName,
				}
			})
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async transferOwnership(channelName: string): Promise<void> {
		try {
			let member: Membership = await this.prisma.membership.findFirst({
				where: {
					channelName: channelName,
					role: 'ADMIN',
				},
			});
			if (!member) {
				member = await this.prisma.membership.findFirst({
					where: {
						channelName: channelName,
					},
				});
			}
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: member.intraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'OWNER',
				},
			});
			member = await this.prisma.membership.findFirst({
				where: {
					channelName: channelName,
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async getChannel(channelName: string): Promise<Channel> {
		try {
			const channel: Channel = await this.prisma.channel.findUnique({
				where: {
					channelName: channelName,
				},
			});
			return channel;
		} catch (error: any) {
			throw new HttpException(`Cannot find channel: ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	async getMember(channelName: string, clientId: string): Promise<Member> {
		const intraId: number = this.sharedService.clientToIntraId.get(clientId);
		const memberShipAndUser: (Membership & { user: User; }) = await this.getMemberWithUser(channelName, intraId);
		return this.getMemberObject(memberShipAndUser);
	}

	async getMembers(channelName: string): Promise<Member[]> {
		const allMemberShipsAndUsers: (Membership & { user: User; })[] = await this.getMembersWithUser(channelName);
		const members: Member[] = allMemberShipsAndUsers.map((membershipAndUser: (Membership & { user: User; })): Member => {
			return this.getMemberObject(membershipAndUser);
		});
		return members;
	}

	async getActiveMembers(channelName: string, activeClientIds: string[], myIntraId: number): Promise<Member[]> {
		if (isEmpty(activeClientIds)) {
			return [];
		}
		const activeIntraIds: number[] = this.getIntraIds(activeClientIds).filter(intraId => intraId !== myIntraId);
		const uniqueActiveIntraIds: number[] = [...new Set(activeIntraIds)];
		const allMembers: Member[] = await this.getMembers(channelName);
		const activeMembers = allMembers.filter((member) => {
			return uniqueActiveIntraIds.includes(member.intraId);
		});
		return activeMembers;
	}

	private getIntraIds(clientIds: string[]): number[] {
		return clientIds.map((clientId: string): number => this.sharedService.clientToIntraId.get(clientId));
	}

	private getMemberObject(memberShipAndUser: (Membership & { user: User; })): Member {
		return {
			intraId: memberShipAndUser.user.intraId,
			name: memberShipAndUser.user.name,
			avatar: memberShipAndUser.user.avatar,
			role: memberShipAndUser.role,
		};
	}

	async getMemberWithUser(channelName: string, intraId: number): Promise<(Membership & { user: User; })> {
		try {
			const member: (Membership & { user: User; }) = await this.prisma.membership.findUnique({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				include: {
					user: true,
				},
			});
			return member;
		} catch (error: any) {
			throw new HttpException(`Cannot find user`, HttpStatus.BAD_REQUEST);
		}
	}

	async getMembersWithUser(channelName: string): Promise<(Membership & { user: User; })[]> {
		try {
			const members: (Membership & { user: User; })[] = await this.prisma.membership.findMany({
				where: {
					channelName: channelName,
				},
				include: {
					user: true,
				},
			});

			return members;
		} catch (error: any) {
			throw new HttpException(`Cannot find channel: ${channelName} with members`, HttpStatus.BAD_REQUEST);
		}
	}

	async getAllChannels(): Promise<Channel[]> {
		try {
			const channels: Channel[] = await this.prisma.channel.findMany({});
			return channels;
		} catch (error: any) {
			throw new HttpException('Cannot find channels', HttpStatus.BAD_REQUEST);
		}
	}

	async getMyChannels(user: User): Promise<Channel[]> {
		try {
			const memberships: { channelName: string }[] = await this.prisma.membership.findMany({
				where: {
					intraId: user.intraId,
				},
				select: {
					channelName: true,
				}
			});

			const channels: Channel[] = await Promise.all(
				memberships.map((membership) =>
					this.prisma.channel.findUnique({ where: { channelName: membership.channelName } })
				)
			);
			return channels;
		} catch (error: any) {
			throw new HttpException(`Cannot find ${user.name}'s channels`, HttpStatus.BAD_REQUEST);
		}
	}

	async getMyDMChannelsWithUser(user: User): Promise<DMChannel[]> {
		try {
			const channelsWithMemberships: (Channel & { memberships: (Membership & { user: User; })[]; })[] =
				await this.prisma.channel.findMany({
					where: {
						channelType: 'DM',
						memberships: {
							some: {
								intraId: user.intraId,
							},
						},
					},
					include: {
						memberships: {
							where: {
								NOT: {
									intraId: user.intraId,
								},
							},
							include: {
								user: true,
							},
						},
					},
				});

			const DMChannels: DMChannel[] = channelsWithMemberships.map((channel) => {
				const otherUser = channel.memberships[0]?.user;

				return {
					channel,
					otherUser: otherUser,
					user: user,
				};
			});
			return (DMChannels);
		} catch (error: any) {
			throw new HttpException(`Cannot find ${user.name}'s direct messages`, HttpStatus.BAD_REQUEST);

		}
	}

	async getMessages(channelName: string): Promise<Message[]> {
		try {
			const channel: Channel & { userMessages: (UserMessage & { user: { intraId: number; intraName: string; avatar: string; }; })[]; } = await this.prisma.channel.findUnique({
				where: {
					channelName: channelName,
				},
				include: {
					userMessages: {
						include: {
							user: {
								select: {
									intraId: true,
									intraName: true,
									avatar: true,
								},
							},
						},
					},
				},
			});

			const messages: Message[] = channel.userMessages.map((mes) => ({
				channelName: channelName,
				intraId: mes.user.intraId,
				name: mes.user.intraName,
				avatar: mes.user.avatar,
				text: mes.text,
			}));
			return messages;
		} catch (error: any) {
			throw new HttpException(`Cannot find messages in ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	async getFilteredMessages(user: User, channelName: string): Promise<Message[]> {
		const messages: (UserMessage & { user: User })[] = await this.prisma.userMessage.findMany({
			where: {
				channelName: channelName,
			},
			include: {
				user: true,
			},
		});

		const otherUsers: { intraId: number, blockedStatus: boolean; otherIntraId: number; }[] = await this.prisma.allOtherUsers.findMany({
			where: {
				intraId: user.intraId,
			},
			select: {
				intraId: true,
				blockedStatus: true,
				otherIntraId: true,
			},
		});

		const filteredMessages: Message[] = [];

		messages.forEach((message) => {
			const messageIntraId: number = message.user.intraId;

			const goodUser = otherUsers.find((user) => {
				return (user.intraId === user.intraId && user.otherIntraId === messageIntraId && user.blockedStatus === false);
			});
			if (messageIntraId === user.intraId || goodUser) {
				filteredMessages.push({
					channelName: channelName,
					intraId: message.user.intraId,
					name: message.user.intraName,
					avatar: message.user.avatar,
					text: message.text,
				});
			}
		});

		return filteredMessages;
	}

	async handleChannelMessage(intraId: number, channelName: string, text: string): Promise<Message> {
		const user: User = await this.prisma.user.findUnique({ where: { intraId: intraId } });

		const message: Message = {
			channelName: channelName,
			intraId: user.intraId,
			name: user.name,
			avatar: user.avatar,
			text: text,
		};

		try {
			this.addMessageToChannel(user.intraId, channelName, text);
			return (message);
		} catch (error: any) {
			throw new WsException(error.message);
		}
	}

	async addMessageToChannel(intraId: number, channelName: string, text: string): Promise<void> {
		const channel = await this.prisma.channel.findUnique({
			where: {
				channelName
			}
		});
		if (!channel) {
			throw new HttpException({ reason: `Channel ${channelName} was not found` }, HttpStatus.BAD_REQUEST);
		}

		try {
			await this.prisma.userMessage.create({
				data: {
					text: text,
					channel: {
						connect: { channelName },
					},
					user: {
						connect: { intraId },
					}
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async checkPassword(channelName: string, password: string): Promise<boolean> {
		try {
			const channel: Channel = await this.getChannel(channelName);

			const hashed_password: string = channel.password;

			return (argon2.verify(hashed_password, password));
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async changePassword(user: User, channelName: string, oldPassword: string, newPassword: string): Promise<void> {
		await this.checkCredentials(user, channelName, oldPassword);

		try {
			const hashed_password = await this.createHashedPassword(newPassword);

			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: hashed_password,
				}
			})
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async deletePasswordAndSetChannelModeToPublic(user: User, channelName: string, password: string): Promise<void> {
		await this.checkCredentials(user, channelName, password);
		try {
			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: '',
					channelMode: 'PUBLIC',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	async setPasswordAndSetChannelModeToProtected(user: User, channelName: string, password: string): Promise<void> {
		await this.checkCredentials(user, channelName, '');
		try {
			const hashed_password = await this.createHashedPassword(password);

			await this.prisma.channel.update({
				where: {
					channelName: channelName,
				},
				data: {
					password: hashed_password,
					channelMode: 'PROTECTED',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async checkCredentials(user: User, channelName: string, password: string) {
		if (await this.getRole(user.intraId, channelName) !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to change password', HttpStatus.BAD_REQUEST);
		}
		if (await this.getChannelType(channelName) === 'DM') {
			throw new HttpException('Channel is a direct message and cannot have a password', HttpStatus.BAD_REQUEST);
		}
		if (password !== '' && await this.checkPassword(channelName, password) === false) {
			throw new HttpException('Old password is not correct', HttpStatus.BAD_REQUEST);
		}
	}

	private async getAmountOfMembersInChannel(channelName: string) {
		try {
			const count: number = await this.prisma.membership.count({
				where: {
					channelName: channelName,
				},
			});
			return (count);
		} catch (error: any) {
			throw new InternalServerErrorException(error.message);
		}
	}

	private async getRole(intraId: number, channelName: string): Promise<Role> {
		try {
			const membership: Membership = await this.prisma.membership.findUnique({
				where: {
					intraId_channelName: {
						intraId: intraId,
						channelName: channelName,
					},
				},
			});
			const role: Role = membership.role;
			return (role);
		} catch (error: any) {
			throw new HttpException(`Cannot find membership of user with intraId: ${intraId} to ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	private async getChannelType(channelName: string): Promise<ChannelType> {
		try {
			const channel: Channel = await this.getChannel(channelName);
			return (channel.channelType);
		} catch (error: any) {
			throw new HttpException(`Cannot find type of channel: ${channelName}`, HttpStatus.BAD_REQUEST);
		}
	}

	private async createHashedPassword(password: string): Promise<string> {
		const hashed_password: string = await argon2.hash(password);
		return (hashed_password);
	}

	async getMembersInChannel(channelName: string): Promise<Member[]> {
		const membershipsWithUser: (Membership & { user: User; })[] = await this.getMembersWithUser(channelName);
		const members: Member[] = membershipsWithUser.map((member: (Membership & { user: User })) => ({
			intraId: member.user.intraId,
			name: member.user.name,
			avatar: member.user.avatar,
			role: member.role,
		}));
		return members;
	}

	async promoteMemberToAdmin(user: User, channelName: string, otherIntraId: number): Promise<void> {
		const userRole: Role = await this.getRole(user.intraId, channelName);
		const otherUserRole: Role = await this.getRole(otherIntraId, channelName);
		if (userRole !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to promote member', HttpStatus.BAD_REQUEST);
		}
		if (otherUserRole !== 'MEMBER') {
			throw new HttpException('Other user is not a member', HttpStatus.BAD_REQUEST);
		}
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: otherIntraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'ADMIN',
				},
			});
		}
		catch (error: any) {
			throw new InternalServerErrorException();
		}
	}

	async demoteAdminToMember(user: User, channelName: string, otherIntraId: number): Promise<void> {
		const userRole: Role = await this.getRole(user.intraId, channelName);
		const otherUserRole: Role = await this.getRole(otherIntraId, channelName);
		if (userRole !== 'OWNER') {
			throw new HttpException('User is not the owner of the channel and does not have the rights to demote admin', HttpStatus.BAD_REQUEST);
		}
		if (otherUserRole !== 'ADMIN') {
			throw new HttpException('Other user is not an admin', HttpStatus.BAD_REQUEST);
		}

		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: {
						intraId: otherIntraId,
						channelName: channelName,
					},
				},
				data: {
					role: 'MEMBER',
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException();
		}
	}

	async canBePunished(intraId: number, otherIntraId: number, channelName: string): Promise<boolean> {
		const memberships: Membership[] = await this.prisma.membership.findMany({
			where: {
				intraId: {
					in: [intraId, otherIntraId],
				},
				channelName: channelName,
			},
		});

		if (!memberships) {
			throw new HttpException('Could not find user and otheruser', HttpStatus.BAD_REQUEST);
		}

		const userRole: Role = memberships.find((member: Membership) => member.intraId === intraId).role;
		const otherUserRole: Role = memberships.find((member: Membership) => member.intraId === otherIntraId).role;

		return this.hasAuthority(userRole, otherUserRole);
	}

	private hasAuthority(userRole: Role, otherUserRole: Role): boolean {
		const rank = {
			OWNER: 3,
			ADMIN: 2,
			MEMBER: 1,
		};

		return rank[userRole] > rank[otherUserRole];
	}

	async banUser(intraId: number, channelName: string): Promise<void> {
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				data: {
					banStatus: true,
					banTimer: new Date(),
				},
			});

			setTimeout(async () => {
				await this.unbanUser(intraId, channelName);
			},
				60 * BANMINUTES * 1000,
			);
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to set banStatus and banTimer');
		}
	}

	async unbanUser(intraId: number, channelName: string): Promise<void> {
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				data: {
					banStatus: false,
					banTimer: null,
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to set banStatus and banTimer');
		}
	}

	async muteUser(intraId: number, channelName: string): Promise<void> {
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				data: {
					muteStatus: true,
					muteTimer: new Date(),
				},
			});

			setTimeout(async () => {
				await this.unmuteUser(intraId, channelName);
			},
				60 * MUTEMINUTES * 1000,
			);
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to set muteStatus and muteTimer');
		}
	}

	async unmuteUser(intraId: number, channelName: string): Promise<void> {
		try {
			await this.prisma.membership.update({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				data: {
					muteStatus: false,
					muteTimer: null,
				},
			});
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to set muteStatus and muteTimer');
		}
	}

	async isMemberBanned(intraId: number, channelName: string): Promise<Punishment> {
		try {
			const { banStatus, banTimer }: { banStatus: boolean, banTimer: Date } = await this.prisma.membership.findUnique({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				select: {
					banStatus: true,
					banTimer: true,
				},
			});

			let ban: Punishment;
			if (banStatus === true) {
				const banTime: number = Math.floor(BANSECONDS + ((banTimer.getTime() - new Date().getTime()) / 1000));
				ban = {
					status: banStatus,
					time: banTime,
				};
			}
			else {
				ban = {
					status: false,
					time: null,
				};
			}
			return ban;
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to get ban status and ban time information');
		}
	}

	async isMemberMuted(intraId: number, channelName: string): Promise<Punishment> {
		try {
			const { muteStatus, muteTimer }: { muteStatus: boolean, muteTimer: Date } = await this.prisma.membership.findUnique({
				where: {
					intraId_channelName: { intraId: intraId, channelName: channelName },
				},
				select: {
					muteStatus: true,
					muteTimer: true,
				},
			});

			let mute: Punishment;
			if (muteStatus === true) {
				const muteTime: number = Math.floor(MUTESECONDS - ((Math.floor(new Date().getTime() - muteTimer.getTime())) / 1000));
				mute = {
					status: muteStatus,
					time: muteTime,
				};
			}
			else {
				mute = {
					status: false,
					time: null,
				};
			}
			return mute;
		} catch (error: any) {
			throw new InternalServerErrorException('Failed to get mute status and mute time information');
		}
	}

	async getNonBlockedClientIds(senderIntraId: number, senderclientId: string, allClientIds: string[]): Promise<string[]> {
		const nonBlockedClientIds: string[] = [senderclientId];

		const relationships: { intraId: number; }[] = await this.prisma.allOtherUsers.findMany({
			where: {
				otherIntraId: senderIntraId,
				blockedStatus: false,
			},
			select: {
				intraId: true,
			},
		});

		console.log(relationships);

		for (const clientId of allClientIds) {
			const intraId = this.sharedService.clientToIntraId.get(clientId);
			if (intraId && intraId !== senderIntraId && relationships.some((relationship) => { return relationship.intraId === intraId })) {
				nonBlockedClientIds.push(clientId);
			}
		}

		return nonBlockedClientIds;
	}
}
