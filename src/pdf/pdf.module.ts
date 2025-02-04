// src/pdf/pdf.module.ts
import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { PriceService } from 'src/price/price.service';
import { RoutesService } from './../routes/routes.service';

@Module({
  controllers: [PdfController],
  providers: [PdfService, PriceService, RoutesService],
})
export class PdfModule {}
