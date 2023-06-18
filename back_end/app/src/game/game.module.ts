import { Module } from '@nestjs/common';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { UserModule } from 'src/user/user.module';
import { GameSharedService } from './game.shared.service';
import { AuthModule } from 'src/auth/auth.module';
import { AchievementsModule } from 'src/achievements/achievements.module';
import { AchievementsService } from 'src/achievements/achievements.service';

@Module({
	imports: [UserModule, AuthModule, AchievementsModule],
	providers: [GameGateway, GameService, GameSharedService, AchievementsService],
	exports: [GameSharedService],
})
export class GameModule { }
