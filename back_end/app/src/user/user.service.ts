import { Injectable } from '@nestjs/common';
import { ActivityStatus, AllOtherUsers, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { userElement } from './types';

@Injectable()
export class UserService {
	constructor(private prisma: PrismaService) { }

	async getUserElements(user: User): Promise<userElement[]> {
		const userlist: (User & { allOtherUsers: AllOtherUsers[]; })[] = await this.getUserListExceptSelf(user);
		const userElements: userElement[] = await Promise.all(userlist.map(otherUser => this.createUserElement(otherUser, user)));

		return (userElements);
	}

	async getUserListExceptSelf(user: User): Promise<(User & { allOtherUsers: AllOtherUsers[]; })[]> {
		const userlist: (User & { allOtherUsers: AllOtherUsers[]; })[] = await this.prisma.user.findMany({
			where: {
				NOT: {
					intraId: user.intraId,
				},
			},
			include: {
				allOtherUsers: true,
			},
		});

		return (userlist);
	}

	async createUserElement(otherUser: (User & { allOtherUsers: AllOtherUsers[]; }), user: User): Promise<userElement> {
		const singleElement: userElement = {
			avatar: otherUser.avatar,
			intraId: otherUser.intraId,
			username: otherUser.name,
			activityStatus: otherUser.activityStatus,
			blockedState: otherUser.allOtherUsers.find(x => x.otherIntraId === user.intraId).blockedStatus,
			friendStatus: otherUser.allOtherUsers.find(x => x.otherIntraId === user.intraId).friendStatus,
		}

		return (singleElement);
	}

	async blockUser(user: (User & { allOtherUsers: AllOtherUsers[]; }), otherUserIntraId: number) {
		try {
			await this.prisma.allOtherUsers.update({
				where: {
					intraId_otherIntraId: {
						intraId: user.intraId,
						otherIntraId: otherUserIntraId,
					}
				},
				data: {
					blockedStatus: true,
				}
			});
		}
		catch(error) {

		}
	}

	async unblockUser(user: (User & { allOtherUsers: AllOtherUsers[]; }), otherUserIntraId: number) {
		try {
			await this.prisma.allOtherUsers.update({
				where: {
					intraId_otherIntraId: {
						intraId: user.intraId,
						otherIntraId: otherUserIntraId,
					}
				},
				data: {
					blockedStatus: false,
				}
			});
		}
		catch(error) {

	async getActivityStatus(intraId: number): Promise<ActivityStatus> {
		try {
			const user: User = await this.prisma.user.findUnique({
				where: {
					intraId: intraId,
				},
			});
			return user.activityStatus;
		} catch (error: any) {
			throw new Error(error);
		}
	}

	async setActivityStatus(intraId: number, status: ActivityStatus): Promise<ActivityStatus> {
		try {
			await this.prisma.user.update({
				where: {
					intraId: intraId,
				},
				data: {
					activityStatus: status,
				}
			});
			const user: User = await this.prisma.user.findUnique({
				where: {
					intraId: intraId,
				},
			});
			return (user.activityStatus);
		} catch (error: any) {
			throw new Error(error);
		}
	}
}
