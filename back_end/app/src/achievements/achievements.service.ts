import { Injectable } from '@nestjs/common';
import { Achievements, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AchievementsService {
    constructor(
        private readonly prisma: PrismaService,
    ) {}

    async getAchievements(user: User): Promise<Achievements> {
        try {
            const achievements: Achievements = await this.prisma.achievements.findUnique({
                where: {
                    intraId: user.intraId,
                },
            });
            return (achievements);
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async getAchievementsBasedOnIntraId(otherIntraId: number): Promise<Achievements> {
        try {
            const achievements: Achievements = await this.prisma.achievements.findUnique({
                where: {
                    intraId: otherIntraId,
                },
            });
            return (achievements);
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkWonGame(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.wonGame === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    wonGame: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkWon3Game(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.won3Game === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    won3Game: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkWon3GameRow(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.won3GameRow === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    won3GameRow: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkLoseGame(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.loseGame === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    loseGame: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkLose3GameRow(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.lose3GameRow === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    lose3GameRow: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkPlayedGame(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.playedGame === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    playedGame: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }
    async checkChangedName(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.changedName === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    changedName: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }
    async checkUploadedAvatar(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.uploadedAvatar === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    uploadedAvatar: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkAdded2FA(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.added2FA === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    added2FA: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }

    async checkRank1(user: (User &  {achievements: Achievements;})): Promise<void> {
        if (user.achievements.rank1 === true)
            return ;
        try {
            await this.prisma.achievements.update({
                where: {
                    intraId: user.intraId, 
                },
                data: {
                    rank1: true,
                }
            });
        } catch(error: any) {
            throw new Error(error);
        }
    }
}
