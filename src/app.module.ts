import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PdfService } from './pdf/pdf.service';
import { PdfController } from './pdf/pdf.controller';
import { PdfModule } from './pdf/pdf.module';
import { RoutesModule } from './routes/routes.module';
import { PriceService } from './price/price.service';
import { PriceController } from './price/price.controller';
import { PriceModule } from './price/price.module';
import { RoutesController } from './routes/routes.controller';
import { RoutesService } from './routes/routes.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PdfModule,
    PriceModule,
    RoutesModule,
  ],
  controllers: [
    AppController,
    PdfController,
    PriceController,
    RoutesController,
  ],
  providers: [AppService, PdfService, PriceService, RoutesService],
})
export class AppModule {}
