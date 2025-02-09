// src/pdf/pdf.controller.ts
import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { Response } from 'express';
import { GeneratePdfDto } from './dto/generate-pdf.dto';

@Controller('pdf')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Post()
  async generatePdf(
    @Body() generatePdfDto: GeneratePdfDto,
    @Res() res: Response,
  ) {
    try {
      // Llama al servicio pasando todos los datos recibidos en el DTO
      const pdfUrl = await this.pdfService.generatePDF(
        generatePdfDto.travelId,
        generatePdfDto.usePage,
        generatePdfDto.addQr,
        generatePdfDto.addStartImagesVehicule,
        generatePdfDto.addBothSignature,
        generatePdfDto.addEndImagesVehicule,
        generatePdfDto.addDniClient,
        generatePdfDto.detailInfo,
        generatePdfDto.step,
      );

      // Si el servicio retorna una URL (resultado final tras subir el PDF)
      return res.status(HttpStatus.OK).json({ pdfUrl });

      // Si por el contrario deseas enviar el PDF directamente como archivo adjunto,
      // podrías obtener un Buffer y luego usar:
      //
      // res.set({
      //   'Content-Type': 'application/pdf',
      //   'Content-Disposition': 'attachment; filename="file.pdf"',
      //   'Content-Length': pdfBuffer.length,
      // });
      // return res.send(pdfBuffer);
    } catch (error) {
      console.error(error);
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'Error generando el PDF' });
    }
  }
}
