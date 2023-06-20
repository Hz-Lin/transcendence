import * as cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
	const app = await NestFactory.create(AppModule);

	app.enableCors({
		origin: `http://${process.env.HOST}:5173`,
		credentials: true
	});
	app.use(cookieParser());
	app.useGlobalPipes(new ValidationPipe({
		whitelist: true,
		forbidNonWhitelisted: true,
	}));
	await app.listen(3001);
}
bootstrap();
