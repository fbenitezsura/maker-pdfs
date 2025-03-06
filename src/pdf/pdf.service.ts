// src/pdf/pdf.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QrImage from 'qr-image';
import fetch from 'node-fetch';
import { PriceService } from './../price/price.service';
import { promises as fs } from 'fs';
import * as path from 'path';
import { RoutesService } from './../routes/routes.service';
import { S3 } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PdfService {
  private s3client: S3;

  constructor(
    private readonly configService: ConfigService,
    private readonly priceService: PriceService,
    private readonly routesService: RoutesService,
  ) {
    this.s3client = new S3({
      region: this.configService.get<string>('AWS_S3_REGION'),
      credentials: {
        accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY'),
        secretAccessKey: this.configService.get<string>(
          'AWS_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async generatePDF(
    travelId: any,
    usePage: string,
    addQr: boolean,
    addStartImagesVehicule: boolean,
    addBothSignature: boolean,
    addEndImagesVehicule: boolean,
    addDniClient: boolean,
    detailInfo: string,
    step: number,
  ): Promise<any> {
    try {
      let url_pdf;
      console.log('travelId', travelId);
      const travel = await this.getTravel(travelId);
      if (!travel) {
        throw new InternalServerErrorException('No se encontró el viaje');
      }
      switch (usePage) {
        case 'withdrawals':
        case 'delivery':
          url_pdf = await this.makePDF(
            travel,
            usePage,
            addQr,
            addStartImagesVehicule,
            addBothSignature,
            addEndImagesVehicule,
            addDniClient,
            detailInfo,
            step,
          );
          break;
        case 'invoice':
          url_pdf = await this.generatePDFInvoice();
          break;
        default:
          break;
      }
      return url_pdf;
    } catch (e) {
      console.log(e);
      throw new InternalServerErrorException(`Error generando el PDF: ${e}`);
    }
  }

  /**
   * Genera un código QR en formato PNG usando la librería qr‑image.
   */
  async generateQR(idTravel: string, page: string): Promise<Buffer> {
    try {
      console.log('generando qr', page);
      const base_url = 'https://drove.es/';
      const url =
        page === 'withdrawals'
          ? `${base_url}retiro?idTravel=${idTravel}`
          : `${base_url}entrega?idTravel=${idTravel}`;
      const qrPng: Buffer = QrImage.imageSync(url, { type: 'png' });
      return qrPng;
    } catch (error) {
      console.log(error);
      throw new InternalServerErrorException('Error generando QR');
    }
  }

  /**
   * Función que genera el PDF dinámico cumpliendo todas las condiciones del código original.
   */
  async makePDF(
    travel: any,
    usePage: string,
    addQr: boolean,
    addStartImagesVehicule: boolean,
    addBothSignature: boolean,
    addEndImagesVehicule: boolean,
    addDniClient: boolean,
    detailInfo: string,
    step: number,
  ): Promise<any> {
    try {
      // Cálculos iniciales para la altura de la página
      const qrSectionHeight = 140;
      const baseWithImage =
        addStartImagesVehicule || addEndImagesVehicule
          ? addDniClient
            ? 3400
            : 3200
          : 2000;
      let extraHeight = 0;
      const mustAddCertificate =
        step === 4 &&
        addDniClient &&
        travel.deliveryCertificate &&
        typeof travel.deliveryCertificate === 'string' &&
        travel.deliveryCertificate.trim() !== '';

      if (mustAddCertificate) {
        extraHeight = 900; // Aumentaremos 300px
      }

      let pageHeight = addQr ? baseWithImage : baseWithImage - qrSectionHeight;
      pageHeight += extraHeight;
      // Crear el documento PDF y agregar la página
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([600, pageHeight]);
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await pdfDoc.embedFont(
        StandardFonts.HelveticaBold,
      );
      const fontTitle = 24;
      const fontSize = 12;

      // Obtener información del cliente y del chofer
      const client = await this.getUser(travel.idClient);
      const chofer = await this.getUser(travel.idChofer);

      // Calcular el tiempo de uso y normalizarlo
      const timeUse =
        step === 3
          ? travel.travelDateEnd
          : step === 4
            ? travel.travelTimeReception
            : travel.travelTime;
      console.log('timeUse', timeUse);
      const normalizedTravelTime = this.normalizeTime(timeUse);

      // Obtener datos de la ruta y detalles adicionales
      const detailRoute = await this.getRouteMap(
        {
          lat: travel.startAddress.location.latitude,
          lng: travel.startAddress.location.longitude,
        },
        {
          lat: travel.endAddress.location.latitude,
          lng: travel.endAddress.location.longitude,
        },
      );
      const detailText = this.getDetailText(
        detailInfo,
        chofer,
        travel.personDelivery,
        travel.personReceive,
      );
      console.log('datos del chofer', chofer);
      // Si se trata de la sección chofer y no es step 4, incluir la selfie
      if (
        (step !== 4 && detailInfo === 'chofer') ||
        (step !== 4 && detailInfo === 'selfChofer')
      ) {
        const wixImageUrlSelfie = chofer?.detailRegister?.selfie;
        if (wixImageUrlSelfie && typeof wixImageUrlSelfie === 'string') {
          const imageId = wixImageUrlSelfie;
          let directImageUrl;
          if (!imageId.includes('static.wixstatic.com')) {
            directImageUrl = `https://wixmp-168aa19777669ff0d074d7f2.wixmp.com/${imageId}`;
          } else {
            directImageUrl = imageId;
          }
          const imageFormat: any = wixImageUrlSelfie.includes('.png')
            ? 'png'
            : 'jpg';
          const response = await fetch(directImageUrl);
          const arrayBuffer = await response.arrayBuffer();
          const imageBuffer = Buffer.from(arrayBuffer);
          let emblemSelfieImage;
          if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
            emblemSelfieImage = await pdfDoc.embedJpg(imageBuffer);
          } else if (imageFormat === 'png') {
            emblemSelfieImage = await pdfDoc.embedPng(imageBuffer);
          } else {
            console.warn(`Formato de imagen no soportado para la selfie`);
          }
          if (emblemSelfieImage) {
            const pngDims = emblemSelfieImage.scale(0.5);
            page.drawImage(emblemSelfieImage, {
              x: 50,
              y: pageHeight - 90,
              width: 70,
              height: 70,
            });
          }
        } else {
          console.warn(
            'No se encontró una URL de imagen válida para la selfie del chofer.',
          );
        }
      }
      if (step !== 4) {
        page.drawText(detailText.title, {
          x: detailInfo === 'chofer' || detailInfo === 'selfChofer' ? 125 : 50,
          y: pageHeight - 70,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(detailText.nameKey, {
          x:
            detailInfo === 'delivery'
              ? 270
              : detailInfo === 'reception'
                ? 180
                : 242,
          y: pageHeight - 70,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
      if (
        (step !== 4 && detailInfo === 'chofer') ||
        (step !== 4 && detailInfo === 'selfChofer')
      ) {
        page.drawText('Télefono:', {
          x: 125,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(detailText.phoneKey, {
          x: 180,
          y: pageHeight - 90,
          size: fontSize,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
      if (
        step !== 4 &&
        (detailInfo === 'delivery' || detailInfo === 'reception')
      ) {
        const titleDNI =
          detailInfo === 'delivery'
            ? 'NIF o CIF de quien entrega el vehiculo:'
            : 'NIF o CIF receptor:';
        page.drawText(titleDNI, {
          x: 50,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const dniValue =
          detailInfo === 'delivery'
            ? travel?.personDelivery?.dni
            : travel?.personReceive?.dni;
        const positionXDni = detailInfo === 'delivery' ? 273 : 160;
        page.drawText(dniValue, {
          x: positionXDni,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText('Télefono:', {
          x: 49,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(detailText.phoneKey, {
          x: 110,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
      }
      if (step === 4 && detailInfo === 'chofer') {
        page.drawText('Nombre del chofer:', {
          x: 50,
          y: pageHeight - 73, // 20 pixeles por encima
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(detailText.nameKey, {
          x: 160,
          y: pageHeight - 73,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText('Nombre del receptor:', {
          x: 50,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(travel.personReceive.fullName, {
          x: 175,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const titleDNI = 'NIF o CIF receptor:';
        page.drawText(titleDNI, {
          x: 50,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const dniValue = travel?.personReceive?.dni;
        page.drawText(dniValue, {
          x: 160,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
      }
      if (step === 4 && detailInfo === 'reception') {
        page.drawText('Nombre del receptor:', {
          x: 50,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(travel.personReceive.fullName, {
          x: 175,
          y: pageHeight - 90,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const titleDNI = 'NIF o CIF receptor:';
        page.drawText(titleDNI, {
          x: 50,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const dniValue = travel?.personReceive?.dni;
        page.drawText(dniValue, {
          x: 160,
          y: pageHeight - 107,
          size: fontSize,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
      }
      const fixVertical = step === 4 && detailInfo !== 'chofer' ? -10 : -10;
      let dateUse =
        step === 3
          ? travel.travelDateEnd
          : step === 4
            ? travel.travelDateReception
            : travel.travelDate;
      dateUse =
        typeof dateUse === 'object' && dateUse.$date ? dateUse.$date : dateUse;
      const travelDate = new Date(dateUse).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
      const textLabel =
        step === 3 || step === 4 ? 'Fecha de entrega:' : 'Fecha de recogida:';
      page.drawText(textLabel, {
        x: 50,
        y: pageHeight - 123,
        size: fontSize,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      page.drawText(travelDate, {
        x: step === 4 || step === 3 ? 155 : step === 1 ? 162 : 160,
        y: pageHeight - 123,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      const textTime =
        step === 3
          ? 'Hora llegada:'
          : step === 4
            ? 'Hora de recepción:'
            : 'Hora de recogida:';
      page.drawText(textTime, {
        x: 50,
        y: pageHeight - 127 + fixVertical,
        size: fontSize,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      const timeReceptionX =
        step === 4 ? 161 : step === 3 ? 128 : step === 1 ? 155 : 160;
      console.log('timeReceptionX', timeReceptionX);
      page.drawText(normalizedTravelTime, {
        x: timeReceptionX,
        y: pageHeight - 127 + fixVertical,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      page.drawText('Cliente:', {
        x: 50,
        y: pageHeight - 144 + fixVertical,
        size: fontSize,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      const nombreCliente =
        client?.contactInfo?.info?.extendedFields?.items['custom.fullname'] ||
        client?.contactInfo?.info?.extendedFields?.items[
          'contacts.displayByFirstName'
        ] ||
        client?.detailRegister?.name ||
        'Nombre Cliente';
      page.drawText(nombreCliente, {
        x: 97,
        y: pageHeight - 144 + fixVertical,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      page.drawText('ID:', {
        x: 50,
        y: pageHeight - 160 + fixVertical,
        size: fontSize,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      page.drawText(travel?.idClient, {
        x: 70,
        y: pageHeight - 160 + fixVertical,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      page.drawText('DROVE', {
        x: 464,
        y: pageHeight - 65,
        size: 24,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });

      // Switch según el step (se han incluido todos los casos)
      switch (step) {
        case 1:
          {
            const X = detailInfo === 'delivery' ? 424 : 404;
            pageHeight =
              detailInfo === 'delivery' ? pageHeight - 10 : pageHeight;
            page.drawText('Comprobante de', {
              x: X,
              y: pageHeight - 85,
              size: 10,
              font: font,
              color: rgb(0, 0, 0),
            });
            const firstText =
              detailInfo === 'delivery' ? 'asignación' : 'solicitud de';
            const firstX = detailInfo === 'delivery' ? 502 : 480;
            page.drawText(firstText, {
              x: firstX,
              y: pageHeight - 85,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            const secondText =
              detailInfo === 'delivery'
                ? 'de traslado de vehículo'
                : 'traslado de vehículo';
            const secondX = detailInfo === 'delivery' ? 444 : 439;
            page.drawText(secondText, {
              x: secondX,
              y: pageHeight - 97,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            if (detailInfo === 'chofer') {
              page.drawText('completado por el cliente.', {
                x: 424,
                y: pageHeight - 108,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('Por su seguridad,', {
                x: 399,
                y: pageHeight - 120,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('no comparta', {
                x: 477,
                y: pageHeight - 120,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawText('este documento y solo', {
                x: 429,
                y: pageHeight - 133,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawText('muestre en persona el código', {
                x: 396,
                y: pageHeight - 144,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawText('QR al chofer asignado', {
                x: 431,
                y: pageHeight - 155,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
            } else {
              page.drawText('No comparta este documento.', {
                x: 424,
                y: pageHeight - 108,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('Para recoger el vehículo debe,', {
                x: 413,
                y: pageHeight - 120,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawText('escanear el código QR de', {
                x: 433,
                y: pageHeight - 133,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawText('seguridad que tiene el cliente.', {
                x: 416,
                y: pageHeight - 145,
                size: 10,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
            }
          }
          break;
        case 2:
          {
            const X = detailInfo === 'delivery' ? 424 : 430;
            pageHeight =
              detailInfo === 'delivery' ? pageHeight - 10 : pageHeight;
            page.drawText('Comprobante de inicio de', {
              x: X,
              y: pageHeight - 85,
              size: 10,
              font: font,
              color: rgb(0, 0, 0),
            });
            const secondText =
              detailInfo === 'delivery'
                ? 'de traslado de vehículo'
                : 'traslado del vehículo';
            const secondX = detailInfo === 'delivery' ? 444 : 445;
            page.drawText(secondText, {
              x: secondX,
              y: pageHeight - 97,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            if (detailInfo === 'chofer') {
              page.drawText('completado por el chofer al', {
                x: 423,
                y: pageHeight - 108,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('escanear el código QR del cliente,', {
                x: 394,
                y: pageHeight - 120,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('para llenar el formulario y', {
                x: 432,
                y: pageHeight - 133,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('proceder con la recogida del', {
                x: 418,
                y: pageHeight - 145,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('vehículo.', {
                x: 507,
                y: pageHeight - 156,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
            } else {
              page.drawText('completado por ti al escanear el', {
                x: 402,
                y: pageHeight - 108,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('código QR del cliente para llenar', {
                x: 399,
                y: pageHeight - 120,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('el formulario y proceder con el', {
                x: 409,
                y: pageHeight - 133,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('traslado del vehículo.', {
                x: 453,
                y: pageHeight - 145,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
            }
          }
          break;
        case 3:
          {
            const X = detailInfo === 'delivery' ? 424 : 430;
            pageHeight =
              detailInfo === 'delivery' ? pageHeight - 10 : pageHeight;
            page.drawText('Comprobante de inicio de', {
              x: X,
              y: pageHeight - 85,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            const secondText =
              detailInfo === 'delivery'
                ? 'de traslado de vehículo'
                : 'entrega del vehículo.';
            const secondX = detailInfo === 'delivery' ? 444 : 455;
            page.drawText(secondText, {
              x: secondX,
              y: pageHeight - 97,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            if (detailInfo === 'chofer' || detailInfo === 'selfChofer') {
              page.drawText('El vehículo a llegado a destino. El', {
                x: 401,
                y: pageHeight - 108,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('chofer debe escanear el QR,', {
                x: 426,
                y: pageHeight - 121,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('adjunto a este documento, para', {
                x: 412,
                y: pageHeight - 133,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('completar el formulario de', {
                x: 437,
                y: pageHeight - 145,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('entrega final.', {
                x: 497,
                y: pageHeight - 156,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
            }
          }
          break;
        case 4:
          {
            const X = 430;
            pageHeight =
              detailInfo === 'delivery' ? pageHeight - 10 : pageHeight;
            page.drawText('Comprobante de recepción', {
              x: X,
              y: pageHeight - 85,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            const secondText =
              detailInfo === 'delivery'
                ? 'segura del vehículo'
                : 'segura del vehículo.';
            const secondX = 464;
            page.drawText(secondText, {
              x: secondX,
              y: pageHeight - 97,
              size: 10,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            if (detailInfo === 'chofer') {
              page.drawText('Completada por el chofer al', {
                x: 436,
                y: pageHeight - 110,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('escanear el código QR del cliente', {
                x: 410,
                y: pageHeight - 121,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('para llenar el formulario y', {
                x: 445,
                y: pageHeight - 133,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('proceder con la entrega del', {
                x: 436,
                y: pageHeight - 145,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('vehículo al cliente.', {
                x: 478,
                y: pageHeight - 156,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
            } else {
              page.drawText('Haz completado la entrega del', {
                x: 423,
                y: pageHeight - 110,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('vehículo al escanear el código QR', {
                x: 407,
                y: pageHeight - 122,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('para llenar el formulario y', {
                x: 445,
                y: pageHeight - 133,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('proceder con la entrega del', {
                x: 436,
                y: pageHeight - 145,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
              page.drawText('vehículo al cliente.', {
                x: 478,
                y: pageHeight - 156,
                size: 10,
                font: font,
                color: rgb(0, 0, 0),
              });
            }
          }
          break;
      }
      console.log('Agregar codigo QR ?', addQr);
      if (addQr) {
        const imgQrWithdrawals = await this.generateQR(travel._id, usePage);
        const emblemImage = await pdfDoc.embedPng(imgQrWithdrawals);
        const pngDims = emblemImage.scale(0.5);
        page.drawImage(emblemImage, {
          x: 50,
          y: pageHeight - 320,
          width: pngDims.width,
          height: pngDims.height,
        });
        page.drawText('Muestre este código QR', {
          x: 308,
          y: pageHeight - 220,
          size: 20,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText('al Chofer para que pueda', {
          x: 298,
          y: pageHeight - 245,
          size: 20,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const qrText =
          usePage === 'withdrawals'
            ? 'escanearlo e iniciar el'
            : 'escanearlo e iniciar la';
        page.drawText(qrText, {
          x: 329,
          y: pageHeight - 268,
          size: 20,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        const qrText2 =
          usePage === 'withdrawals'
            ? 'traslado del vehículo.'
            : 'entrega del vehículo.';
        page.drawText(qrText2, {
          x: 334,
          y: pageHeight - 290,
          size: 20,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        page.drawText('DROVE', {
          x: 503,
          y: pageHeight - 310,
          size: 9,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
      }

      const contentStartY = addQr ? pageHeight - 350 : pageHeight - 210;
      page.drawText('INFORMACIÓN DEL VEHÍCULO', {
        x: 56,
        y: contentStartY,
        size: 20,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      const tableTop = contentStartY - 17;
      const tableLeft = 50;
      const rowHeight = 30;
      const colWidth = 250;
      const tableWidth = colWidth * 2;
      const tableHeight = rowHeight * 6;
      console.log('marca', travel?.brandVehicle);
      const datosTabla = [
        ['Tipo', travel?.typeVehicle ?? 'Sin tipo'],
        ['Marca', travel?.brandVehicle ?? 'Sin marca'],
        ['Año', travel?.yearVehicle ?? 'Sin año'],
        ['Matrícula', travel?.patentVehicle ?? 'Sin matrícula'],
        ['Modelo', travel?.modelVehicle ?? 'Sin modelo'],
        ['Bastidor', travel?.bastidor ?? 'Sin bastidor'],
      ];
      datosTabla.forEach((fila, filaIndex) => {
        const x = tableLeft;
        const y = tableTop - filaIndex * rowHeight;
        page.drawRectangle({
          x,
          y: y - rowHeight,
          width: 150,
          height: rowHeight,
          color: rgb(0.9, 0.9, 0.9),
        });
      });
      for (let i = 0; i <= datosTabla.length; i++) {
        const y = tableTop - i * rowHeight;
        page.drawLine({
          start: { x: tableLeft, y },
          end: { x: tableLeft + tableWidth, y },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
      }
      page.drawLine({
        start: { x: 200, y: tableTop },
        end: { x: 200, y: tableTop - tableHeight },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      datosTabla.forEach((fila, filaIndex) => {
        fila.forEach((celda, colIndex) => {
          const x = tableLeft + colIndex * colWidth + 10;
          const y = tableTop - (filaIndex + 0.5) * rowHeight - fontSize / 2;
          const selectedFont = colIndex === 0 ? helveticaBoldFont : font;
          const xUse = colIndex === 0 ? x : x - 100;
          console.log('celda', celda);
          page.drawText(celda, {
            x: xUse,
            y,
            size: fontSize,
            font: selectedFont,
            color: rgb(0, 0, 0),
          });
        });
      });
      page.drawLine({
        start: { x: 50, y: tableTop - tableHeight },
        end: { x: 550, y: tableTop - tableHeight },
        thickness: 3,
        color: rgb(0, 0, 0),
      });
      const datosImagenesWithdrawalsVehiculo = [
        ['Parte frontal', travel.withdrawalImgFront],
        ['Lado derecho delantero', travel.withdrawalImgFrontRightSide],
        ['Lado derecho trasero', travel.withdrawalImgBackRightSide],
        ['Parte trasera', travel.withdrawalImgBack],
        ['Lado izquierdo trasero', travel.withdrawalImgFrontLeftSide],
        ['Lado izquierdo delantero', travel.withdrawalImgBackLeftSide],
        ['Cuadro de mando', travel.withdrawalImgDashboard],
        ['Interior maletero', travel.withdrawalImgInteriorTrunk],
        ['Interior asiento conductor', travel.withdrawalImgDriverSeat],
        ['Interior asiento acompañante', travel.withdrawalImgCopilotSeat],
        [
          'Asientos traseros lado derecho',
          travel.withdrawalImgBackRightSideSeat,
        ],
        [
          'Asientos traseros lado izquierdo',
          travel.withdrawalImgBackLeftSideSeat,
        ],
      ];
      const datosImagenesDeliveryVehiculo = [
        ['Parte frontal', travel.deliveryImgFront],
        ['Lado derecho delantero', travel.deliveryImgFrontRightSide],
        ['Lado derecho trasero', travel.deliveryImgBackRightSide],
        ['Parte trasera', travel.deliveryImgBack],
        ['Lado izquierdo trasero', travel.deliveryImgFrontLeftSide],
        ['Lado izquierdo delantero', travel.deliveryImgBackLeftSide],
        ['Cuadro de mando', travel.deliveryImgDashboard],
        ['Interior maletero', travel.deliveryImgInteriorTrunk],
        ['Interior asiento conductor', travel.deliveryImgDriverSeat],
        ['Interior asiento acompañante', travel.deliveryImgCopilotSeat],
        ['Asientos traseros lado derecho', travel.deliveryImgBackRightSideSeat],
        [
          'Asientos traseros lado izquierdo',
          travel.deliveryImgBackLeftSideSeat,
        ],
      ];
      let currentY = tableTop - tableHeight - 50;
      const datosImagenesVehiculo = addStartImagesVehicule
        ? datosImagenesWithdrawalsVehiculo
        : datosImagenesDeliveryVehiculo;
      try {
        if (addStartImagesVehicule || addEndImagesVehicule) {
          currentY -= -30;
          const imagesPerRow = 2;
          const cellWidth = 250;
          const cellHeight = 200;
          const imageWidth = cellWidth - 20;
          const imageHeight = 150;
          const paddingX = 50;
          const titleHeight = 20;
          const titlePadding = 5;
          const indexCuadroDeMando = datosImagenesVehiculo.findIndex(
            ([description]) => description === 'Cuadro de mando',
          );
          const indexInterior = datosImagenesVehiculo.findIndex(
            ([description]) => description === 'Interior asiento conductor',
          );
          const indexInteriorBack = datosImagenesVehiculo.findIndex(
            ([description]) => description === 'Asientos traseros lado derecho',
          );
          for (let i = 0; i < datosImagenesVehiculo.length; i += imagesPerRow) {
            const rowItems = datosImagenesVehiculo.slice(i, i + imagesPerRow);
            let xPosition = paddingX;
            let paddingY = 0;
            if (i >= indexCuadroDeMando) paddingY = 10;
            if (i >= indexInterior) paddingY = 0;
            if (i >= indexInteriorBack) paddingY = 10;
            currentY -= cellHeight + paddingY;
            for (let j = 0; j < rowItems.length; j++) {
              const [description, wixImageUrl] = rowItems[j];
              page.drawRectangle({
                x: xPosition,
                y: currentY,
                width: cellWidth,
                height: cellHeight,
                borderWidth: 1,
                borderColor: rgb(0, 0, 0),
                color: rgb(1, 1, 1),
              });
              const titleBoxHeight = titleHeight + titlePadding * 2;
              const titleYPosition = currentY + cellHeight - titleBoxHeight;
              page.drawLine({
                start: { x: xPosition, y: titleYPosition + titleBoxHeight },
                end: {
                  x: xPosition + cellWidth,
                  y: titleYPosition + titleBoxHeight,
                },
                thickness: 1,
                color: rgb(0, 0, 0),
              });
              const textWidth = helveticaBoldFont.widthOfTextAtSize(
                description,
                fontSize,
              );
              page.drawText(description, {
                x: xPosition + cellWidth / 2 - textWidth / 2,
                y: titleYPosition + titlePadding + 5,
                size: fontSize,
                font: helveticaBoldFont,
                color: rgb(0, 0, 0),
              });
              page.drawLine({
                start: { x: xPosition, y: titleYPosition },
                end: { x: xPosition + cellWidth, y: titleYPosition },
                thickness: 1,
                color: rgb(0, 0, 0),
              });
              if (wixImageUrl && typeof wixImageUrl === 'string') {
                const wixImagePattern = /^wix:image:\/\/v1\/(.+?)\//;
                const match = wixImageUrl.match(wixImagePattern);
                if (match && match[1]) {
                  const imageId = match[1];
                  const directImageUrl = `https://static.wixstatic.com/media/${imageId}`;
                  const imageFormat: any = wixImageUrl.includes('.png')
                    ? 'png'
                    : 'jpg';
                  const response = await fetch(directImageUrl);
                  const arrayBuffer = await response.arrayBuffer();
                  const imageBuffer = Buffer.from(arrayBuffer);
                  let embeddedImage;
                  if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
                    embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                  } else if (imageFormat === 'png') {
                    embeddedImage = await pdfDoc.embedPng(imageBuffer);
                  } else {
                    console.warn(
                      `Formato de imagen no soportado para ${description}`,
                    );
                    continue;
                  }
                  page.drawImage(embeddedImage, {
                    x: xPosition + 10,
                    y: currentY + 10,
                    width: imageWidth,
                    height: imageHeight,
                  });
                } else {
                  console.warn(
                    `No se pudo extraer el ID de la imagen para ${description}`,
                  );
                }
              } else {
                console.warn(`No hay imagen disponible para ${description}`);
              }
              xPosition += cellWidth;
            }
          }
        }
      } catch (e) {
        console.log('error', e);
      }
      currentY -= 40;
      page.drawText('DIRECCIÓN DE RECOGIDA', {
        x: 56,
        y: currentY,
        size: 20,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 15;
      const tableAddressTop = currentY;
      const tableAddressLeft = 50;
      const rowAddressHeight = 30;
      const colAddressWidth = 250;
      const tableAddressWidth = colAddressWidth * 2;
      const tableAddressHeight = rowAddressHeight * 6;
      const AddressTabla = [
        ['Calle', travel?.startAddress?.streetAddress.formattedAddressLine],
        ['Código postal', travel?.startAddress?.postalCode || ''],
        ['Ciudad', travel?.startAddress?.city],
        ['País', travel?.startAddress?.country],
        ['Provincia', 'xxxxxx'],
        ['Comunidad autónoma', 'xxxxxx'],
      ];
      AddressTabla.forEach((fila, filaIndex) => {
        const x = tableAddressLeft;
        const y = tableAddressTop - filaIndex * rowAddressHeight;
        page.drawRectangle({
          x,
          y: y - rowAddressHeight,
          width: 150,
          height: rowAddressHeight,
          color: rgb(0.9, 0.9, 0.9),
        });
      });
      for (let i = 0; i <= AddressTabla.length; i++) {
        const y = tableAddressTop - i * rowAddressHeight;
        page.drawLine({
          start: { x: tableAddressLeft, y },
          end: { x: tableAddressLeft + tableAddressWidth, y },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
      }
      page.drawLine({
        start: { x: 200, y: tableAddressTop },
        end: { x: 200, y: tableAddressTop - tableAddressHeight },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      AddressTabla.forEach((fila, filaIndex) => {
        fila.forEach((celda, colIndex) => {
          if (typeof celda !== 'string') {
            console.error(
              `Invalid value at filaIndex ${filaIndex}, colIndex ${colIndex}:`,
              celda,
            );
            return;
          }
          const x = tableAddressLeft + colIndex * colAddressWidth + 10;
          const y =
            tableAddressTop -
            (filaIndex + 0.5) * rowAddressHeight -
            fontSize / 2;
          const selectedFont = colIndex === 0 ? helveticaBoldFont : font;
          const xUse = colIndex === 0 ? x : x - 100;
          page.drawText(celda, {
            x: xUse,
            y,
            size: fontSize,
            font: selectedFont,
            color: rgb(0, 0, 0),
          });
        });
      });
      page.drawLine({
        start: { x: 50, y: tableAddressTop - tableAddressHeight },
        end: { x: 550, y: tableAddressTop - tableAddressHeight },
        thickness: 3,
        color: rgb(0, 0, 0),
      });
      currentY = tableAddressTop - tableAddressHeight - 50;
      page.drawText('DIRECCIÓN DE ENTREGA', {
        x: 56,
        y: currentY,
        size: 20,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 15;
      const tableAddressDeliveryTop = currentY;
      const tableAddressDeliveryLeft = 50;
      const rowAddressDeliveryHeight = 30;
      const colAddressDeliveryWidth = 250;
      const tableAddressDeliveryWidth = colAddressDeliveryWidth * 2;
      const tableAddressDeliveryHeight = rowAddressDeliveryHeight * 6;
      const AddressDeliveryTabla = [
        ['Calle', travel?.endAddress?.streetAddress.formattedAddressLine],
        ['Código postal', travel?.endAddress?.postalCode || ''],
        ['Ciudad', travel?.endAddress?.city],
        ['País', travel?.endAddress?.country],
        ['Provincia', 'xxxxxx'],
        ['Comunidad autónoma', 'xxxxxx'],
      ];
      AddressDeliveryTabla.forEach((fila, filaIndex) => {
        const x = tableAddressDeliveryLeft;
        const y =
          tableAddressDeliveryTop - filaIndex * rowAddressDeliveryHeight;
        page.drawRectangle({
          x,
          y: y - rowAddressDeliveryHeight,
          width: 150,
          height: rowAddressDeliveryHeight,
          color: rgb(0.9, 0.9, 0.9),
        });
      });
      for (let i = 0; i <= AddressDeliveryTabla.length; i++) {
        const y = tableAddressDeliveryTop - i * rowAddressDeliveryHeight;
        page.drawLine({
          start: { x: tableAddressDeliveryLeft, y },
          end: { x: tableAddressDeliveryLeft + tableAddressDeliveryWidth, y },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
      }
      page.drawLine({
        start: { x: 200, y: tableAddressDeliveryTop },
        end: {
          x: 200,
          y: tableAddressDeliveryTop - tableAddressDeliveryHeight,
        },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      AddressDeliveryTabla.forEach((fila, filaIndex) => {
        fila.forEach((celda, colIndex) => {
          const x =
            tableAddressDeliveryLeft + colIndex * colAddressDeliveryWidth + 10;
          const y =
            tableAddressDeliveryTop -
            (filaIndex + 0.5) * rowAddressDeliveryHeight -
            fontSize / 2;
          const selectedFont = colIndex === 0 ? helveticaBoldFont : font;
          const xUse = colIndex === 0 ? x : x - 100;
          page.drawText(celda, {
            x: xUse,
            y,
            size: fontSize,
            font: selectedFont,
            color: rgb(0, 0, 0),
          });
        });
      });
      page.drawLine({
        start: {
          x: 50,
          y: tableAddressDeliveryTop - tableAddressDeliveryHeight,
        },
        end: {
          x: 550,
          y: tableAddressDeliveryTop - tableAddressDeliveryHeight,
        },
        thickness: 3,
        color: rgb(0, 0, 0),
      });
      currentY = tableAddressDeliveryTop - tableAddressDeliveryHeight - 50;
      page.drawText('DETALLES DEL TRASLADO', {
        x: 56,
        y: currentY,
        size: 20,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 17;
      const tableDetailTop = currentY;
      const tableDetailLeft = 50;
      const rowDetailHeight = 30;
      const colDetailWidth = 250;
      const tableDetailWidth = colDetailWidth * 2;
      const tableDetailHeight = rowDetailHeight * 2;
      const detailTravelTabla = [
        ['Distancia', `${detailRoute.DistanceInKM} Kilometros`],
        ['Total con I.V.A', `${detailRoute?.priceResult?.Total_Cliente} €`],
      ];
      detailTravelTabla.forEach((fila, filaIndex) => {
        const x = tableDetailLeft;
        const y = tableDetailTop - filaIndex * rowDetailHeight;
        page.drawRectangle({
          x,
          y: y - rowDetailHeight,
          width: 150,
          height: rowDetailHeight,
          color: rgb(0.9, 0.9, 0.9),
        });
      });
      for (let i = 0; i <= detailTravelTabla.length; i++) {
        const y = tableDetailTop - i * rowDetailHeight;
        page.drawLine({
          start: { x: tableDetailLeft, y },
          end: { x: tableDetailLeft + tableDetailWidth, y },
          thickness: 1,
          color: rgb(0, 0, 0),
        });
      }
      page.drawLine({
        start: { x: 200, y: tableDetailTop },
        end: { x: 200, y: tableDetailTop - tableDetailHeight },
        thickness: 1,
        color: rgb(0, 0, 0),
      });
      detailTravelTabla.forEach((fila, filaIndex) => {
        fila.forEach((celda, colIndex) => {
          const x = tableDetailLeft + colIndex * colDetailWidth + 10;
          const y =
            tableDetailTop - (filaIndex + 0.5) * rowDetailHeight - fontSize / 2;
          const selectedFont = colIndex === 0 ? helveticaBoldFont : font;
          const xUse = colIndex === 0 ? x : x - 100;
          if (fila[0] === 'Total con I.V.A' && colIndex === 1) {
            if (chofer?.detailRegister?.typeUser === 'Chofer') {
              page.drawText(celda, {
                x: xUse,
                y,
                size: fontSize,
                font: selectedFont,
                color: rgb(0, 0, 0),
              });
            } else {
              page.drawText('', {
                x: xUse,
                y,
                size: fontSize,
                font: selectedFont,
                color: rgb(0, 0, 0),
              });
            }
          } else {
            page.drawText(celda, {
              x: xUse,
              y,
              size: fontSize,
              font: selectedFont,
              color: rgb(0, 0, 0),
            });
          }
        });
      });
      currentY = tableDetailTop - tableDetailHeight - 50;
      if (travel.status === 'REQUEST_FINISH') {
        const mapToEnd = await this.getMapImage(
          travel.endAddress.location.latitude,
          travel.endAddress.location.longitude,
        );
        const imgMapEnd = mapToEnd.split(',')[1];
        const imgEndMapReady = await pdfDoc.embedPng(
          Buffer.from(imgMapEnd, 'base64'),
        );
        page.drawImage(imgEndMapReady, {
          x: 50,
          y: currentY - 280,
          width: 500,
          height: 300,
        });
      }
      if (travel.status === 'FINISH') {
        const mapWithRoute = await this.getMapImageWithRoute(
          {
            lat: travel.startAddress.location.latitude,
            lng: travel.startAddress.location.longitude,
          },
          {
            lat: travel.endAddress.location.latitude,
            lng: travel.endAddress.location.longitude,
          },
          travel.finalRoutePolyline,
        );
        const imgMapRoute = mapWithRoute.split(',')[1];
        const imgRouteMapReady = await pdfDoc.embedPng(
          Buffer.from(imgMapRoute, 'base64'),
        );
        page.drawImage(imgRouteMapReady, {
          x: 50,
          y: currentY - 280,
          width: 500,
          height: 300,
        });
      }
      if (travel.status !== 'REQUEST_FINISH' && travel.status !== 'FINISH') {
        const mapToStart = await this.getMapImage(
          travel.startAddress.location.latitude,
          travel.startAddress.location.longitude,
        );
        const imgMap = mapToStart.split(',')[1];
        const imgMapReady = await pdfDoc.embedPng(
          Buffer.from(imgMap, 'base64'),
        );
        page.drawImage(imgMapReady, {
          x: 50,
          y: currentY - 280,
          width: 500,
          height: 300,
        });
      }

      if (step === 4) {
        // BLOQUE EXCLUSIVO PARA STEP 4

        // 1. Dibujar Documentos del Usuario (DNI)
        if (addDniClient) {
          const datosImagenesDNICliente = [
            ['Anverso DNI cliente', travel.frontDniReceiver],
            ['Reverso DNI cliente', travel.backDniReceiver],
          ];
          const imagesPerRowDNI = 2;
          const cellWidthDNI = 250;
          const cellHeightDNI = 200;
          const imageWidthDNI = cellWidthDNI - 20;
          const imageHeightDNI = 150;
          const paddingXDNI = 50;
          const titleHeightDNI = 20;
          const titleHeight = 20;
          const titlePaddingDNI = 5;
          const titlePadding = 5;
          let xPositionDNI = paddingXDNI;
          // Ajustamos currentY para que los documentos queden en la parte superior del bloque final.
          // (Ajusta este valor según tus necesidades)
          currentY -= 500;
          for (let i = 0; i < datosImagenesDNICliente.length; i++) {
            const [description, wixImageUrl] = datosImagenesDNICliente[i];
            page.drawRectangle({
              x: xPositionDNI,
              y: currentY,
              width: cellWidthDNI,
              height: cellHeightDNI,
              borderWidth: 1,
              borderColor: rgb(0, 0, 0),
              color: rgb(1, 1, 1),
            });
            const titleBoxHeightDNI = titleHeightDNI + titlePaddingDNI * 2;
            const titleYPositionDNI =
              currentY + cellHeightDNI - titleBoxHeightDNI;
            page.drawLine({
              start: {
                x: xPositionDNI,
                y: titleYPositionDNI + titleBoxHeightDNI,
              },
              end: {
                x: xPositionDNI + cellWidthDNI,
                y: titleYPositionDNI + titleBoxHeightDNI,
              },
              thickness: 1,
              color: rgb(0, 0, 0),
            });
            const textWidthDNI = helveticaBoldFont.widthOfTextAtSize(
              description,
              fontSize,
            );
            page.drawText(description, {
              x: xPositionDNI + cellWidthDNI / 2 - textWidthDNI / 2,
              y: titleYPositionDNI + titlePaddingDNI + 5,
              size: fontSize,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            page.drawLine({
              start: { x: xPositionDNI, y: titleYPositionDNI },
              end: { x: xPositionDNI + cellWidthDNI, y: titleYPositionDNI },
              thickness: 1,
              color: rgb(0, 0, 0),
            });
            if (wixImageUrl) {
              const wixImagePattern = /^wix:image:\/\/v1\/(.+?)\//;
              const match = wixImageUrl.match(wixImagePattern);
              if (match && match[1]) {
                const imageId = match[1];
                const directImageUrl = `https://static.wixstatic.com/media/${imageId}`;
                const imageFormat: any = wixImageUrl.includes('.png')
                  ? 'png'
                  : 'jpg';
                const response = await fetch(directImageUrl);
                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);
                let embeddedImage;
                if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
                  embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                } else if (imageFormat === 'png') {
                  embeddedImage = await pdfDoc.embedPng(imageBuffer);
                } else {
                  console.warn(
                    `Formato de imagen no soportado para ${description}`,
                  );
                  continue;
                }
                page.drawImage(embeddedImage, {
                  x: xPositionDNI + 10,
                  y: currentY + 10,
                  width: imageWidthDNI,
                  height: imageHeightDNI,
                });
              } else {
                console.warn(
                  `No se pudo extraer el ID de la imagen para ${description}`,
                );
              }
            } else {
              console.warn(`No hay imagen disponible para ${description}`);
            }
            xPositionDNI += cellWidthDNI;
            if (
              (i + 1) % imagesPerRowDNI === 0 &&
              i !== datosImagenesDNICliente.length - 1
            ) {
              xPositionDNI = paddingXDNI;
              currentY -= cellHeightDNI;
            }
          }
          currentY -= 240; // Espacio después de los documentos
          const selfieData = [
            'Foto receptor del vehiculo',
            travel.imgSelfieDniReceiver,
          ];
          // En esta fila se usará una sola celda que abarque el ancho completo (500px)
          const cellWidthSelfie = 500;
          const cellHeightSelfie = 200; // Puedes ajustar este valor según lo deseado
          const xPosSelfie = 50; // Centrado si la página es de 600px con márgenes de 50 a cada lado

          page.drawRectangle({
            x: xPosSelfie,
            y: currentY,
            width: cellWidthSelfie,
            height: cellHeightSelfie,
            borderWidth: 1,
            borderColor: rgb(0, 0, 0),
            color: rgb(1, 1, 1),
          });
          const titleBoxHeightSelfie = titleHeight + titlePadding * 2;
          const titleYPosSelfie =
            currentY + cellHeightSelfie - titleBoxHeightSelfie;
          page.drawLine({
            start: { x: xPosSelfie, y: titleYPosSelfie + titleBoxHeightSelfie },
            end: {
              x: xPosSelfie + cellWidthSelfie,
              y: titleYPosSelfie + titleBoxHeightSelfie,
            },
            thickness: 1,
            color: rgb(0, 0, 0),
          });
          const textWidthSelfie = helveticaBoldFont.widthOfTextAtSize(
            selfieData[0],
            fontSize,
          );
          page.drawText(selfieData[0], {
            x: xPosSelfie + cellWidthSelfie / 2 - textWidthSelfie / 2,
            y: titleYPosSelfie + titlePadding + 5,
            size: fontSize,
            font: helveticaBoldFont,
            color: rgb(0, 0, 0),
          });
          page.drawLine({
            start: { x: xPosSelfie, y: titleYPosSelfie },
            end: { x: xPosSelfie + cellWidthSelfie, y: titleYPosSelfie },
            thickness: 1,
            color: rgb(0, 0, 0),
          });
          // Cargar y dibujar la imagen de la selfie
          const wixImageUrlSelfie = selfieData[1];
          console.log('url selfie', wixImageUrlSelfie);
          if (wixImageUrlSelfie) {
            const wixImagePattern = /^wix:image:\/\/v1\/(.+?)\//;
            const match = wixImageUrlSelfie.match(wixImagePattern);
            if (match && match[1]) {
              const imageId = match[1];
              const directImageUrl = `https://static.wixstatic.com/media/${imageId}`;
              const imageFormat: any = wixImageUrlSelfie.includes('.png')
                ? 'png'
                : 'jpg';
              const response = await fetch(directImageUrl);
              const arrayBuffer = await response.arrayBuffer();
              const imageBuffer = Buffer.from(arrayBuffer);
              let embeddedImage;
              if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
                embeddedImage = await pdfDoc.embedJpg(imageBuffer);
              } else if (imageFormat === 'png') {
                embeddedImage = await pdfDoc.embedPng(imageBuffer);
              } else {
                console.warn(
                  `Formato de imagen no soportado para ${selfieData[0]}`,
                );
              }
              if (embeddedImage) {
                page.drawImage(embeddedImage, {
                  x: xPosSelfie + 10,
                  y: currentY + 10,
                  width: cellWidthSelfie - 20,
                  height: cellHeightSelfie - 20,
                });
              }
            } else {
              console.warn(
                `No se pudo extraer el ID de la imagen para ${selfieData[0]}`,
              );
            }
          } else {
            console.warn(`No hay imagen disponible para ${selfieData[0]}`);
          }
          currentY -= cellHeightSelfie + 20;
        } // Fin de bloque DNI

        // 2. Dibujar Bloque de Firmas
        currentY -= 20;
        page.drawLine({
          start: { x: 50, y: 1100 },
          end: { x: 550, y: 1100 },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        currentY -= 20;
        // Firma del cliente
        const pngImageBytes = addDniClient
          ? travel?.signatureEndClient?.split(',')[1]
          : travel?.signatureStartClient?.split(',')[1];
        if (pngImageBytes) {
          const signatureClientImage = await pdfDoc.embedPng(
            Buffer.from(pngImageBytes, 'base64'),
          );
          const xSignature = addBothSignature ? 10 : 140;
          page.drawImage(signatureClientImage, {
            x: xSignature,
            y: currentY + 100, // Posición para la firma del cliente
            width: 300,
            height: 100,
          });
        }

        currentY = 1100; // Ajusta este valor si es necesario para que las firmas queden más arriba
        page.drawLine({
          start: { x: 50, y: 890 },
          end: { x: 550, y: 890 },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        currentY -= 400;
        console.log('VAlorr actual ------------------------- ', currentY);
        page.drawText('Firma del cliente', {
          x: addBothSignature ? 120 : 240,
          y: currentY + 170,
          size: 13,
          font: font,
          color: rgb(0, 0, 0),
        });
        console.log('el current de la linea de abajo', currentY + 190);
        page.drawLine({
          start: { x: 50, y: currentY + 150 },
          end: { x: 550, y: currentY + 150 },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        if (addBothSignature) {
          // Firma del chofer
          page.drawLine({
            start: { x: 300, y: 1100 },
            end: { x: 300, y: 850 },
            thickness: 3,
            color: rgb(0, 0, 0),
          });
          const pngImageBytesChofer = addStartImagesVehicule
            ? travel?.signatureStartChofer?.split(',')[1]
            : travel?.signatureEndChofer?.split(',')[1];
          if (pngImageBytesChofer) {
            const signatureClientImageChofer = await pdfDoc.embedPng(
              Buffer.from(pngImageBytesChofer, 'base64'),
            );
            page.drawImage(signatureClientImageChofer, {
              x: 300,
              y: currentY + 240, // Alineado con la firma del cliente
              width: 280,
              height: 100,
            });
          }
          page.drawText('Firma del chofer', {
            x: 375,
            y: currentY + 170, // Ajuste para situar el texto correctamente
            size: 13,
            font: font,
            color: rgb(0, 0, 0),
          });
          currentY = 820;
          console.log('actualmenete el 50', currentY);
          page.drawText(
            'Ambas partes confirman el inicio del traslado del vehículo desde el punto de recogida hasta el',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText(
            'punto de entrega, solicitado por el cliente y aceptado por el chofer, según lo indicado en este',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText(
            'documento de confirmación emitido a través de DROVE®',
            {
              x: 60,
              y: currentY,
              size: 12,
              font: font,
              color: rgb(0, 0, 0),
            },
          );
        } else {
          currentY -= 60;
          page.drawText(
            'Confirmo que el dia de hoy solicité un traslado del vehículo nombrado en este documento,',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText('por medio de DROVE@', {
            x: 60,
            y: currentY,
            size: 12,
            font: font,
            color: rgb(0, 0, 0),
          });
          currentY -= 55;
          page.drawLine({
            start: { x: 50, y: currentY },
            end: { x: 550, y: currentY },
            thickness: 8,
            color: rgb(0, 0, 0),
          });
        }

        // 3. Información final: Fecha de emisión del documento
        currentY -= 30;
        const formattedDate = new Date().toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        page.drawText(`Fecha de emisión del documento: ${formattedDate}`, {
          x: 60,
          y: currentY,
          size: 9,
          font: font,
          color: rgb(0, 0, 0),
        });

        // 4. Dibujar el Certificado (si existe)
        if (addDniClient && travel.deliveryCertificate) {
          const certificateUrl = travel.deliveryCertificate;
          if (certificateUrl && typeof certificateUrl === 'string') {
            const wixImagePattern = /^wix:image:\/\/v1\/(.+?)\//;
            const match = certificateUrl.match(wixImagePattern);
            let directImageUrl: string;
            if (match && match[1]) {
              const imageId = match[1];
              directImageUrl = `https://static.wixstatic.com/media/${imageId}`;
            } else {
              directImageUrl = certificateUrl;
            }
            const imageFormat: any = directImageUrl.includes('.png')
              ? 'png'
              : 'jpg';
            try {
              const response = await fetch(directImageUrl);
              const arrayBuffer = await response.arrayBuffer();
              const imageBuffer = Buffer.from(arrayBuffer);
              let embeddedCertificate;
              if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
                embeddedCertificate = await pdfDoc.embedJpg(imageBuffer);
              } else if (imageFormat === 'png') {
                embeddedCertificate = await pdfDoc.embedPng(imageBuffer);
              } else {
                console.warn(
                  `Formato de imagen no soportado para deliveryCertificate`,
                );
              }
              if (embeddedCertificate) {
                console.log('valoor para ------', currentY);
                page.drawImage(embeddedCertificate, {
                  x: 50,
                  y: 50,
                  width: 500,
                  height: 680,
                });
                currentY -= 320; // Ajuste posterior a la imagen del certificado
              }
            } catch (error) {
              console.error('Error al incrustar deliveryCertificate:', error);
            }
          } else {
            console.warn(
              'No se encontró una URL de imagen válida para deliveryCertificate',
            );
          }
        }
      } else {
        if (addDniClient) {
          const datosImagenesDNICliente = [
            ['Anverso DNI cliente', travel.frontDniReceiver],
            ['Reverso DNI cliente', travel.backDniReceiver],
          ];
          const imagesPerRowDNI = 2;
          const cellWidthDNI = 250;
          const cellHeightDNI = 200;
          const imageWidthDNI = cellWidthDNI - 20;
          const imageHeightDNI = 150;
          const paddingXDNI = 50;
          const titleHeightDNI = 20;
          const titlePaddingDNI = 5;
          let xPositionDNI = paddingXDNI;
          currentY -= 500;
          for (let i = 0; i < datosImagenesDNICliente.length; i++) {
            const [description, wixImageUrl] = datosImagenesDNICliente[i];
            page.drawRectangle({
              x: xPositionDNI,
              y: currentY,
              width: cellWidthDNI,
              height: cellHeightDNI,
              borderWidth: 1,
              borderColor: rgb(0, 0, 0),
              color: rgb(1, 1, 1),
            });
            const titleBoxHeightDNI = titleHeightDNI + titlePaddingDNI * 2;
            const titleYPositionDNI =
              currentY + cellHeightDNI - titleBoxHeightDNI;
            page.drawLine({
              start: {
                x: xPositionDNI,
                y: titleYPositionDNI + titleBoxHeightDNI,
              },
              end: {
                x: xPositionDNI + cellWidthDNI,
                y: titleYPositionDNI + titleBoxHeightDNI,
              },
              thickness: 1,
              color: rgb(0, 0, 0),
            });
            const textWidthDNI = helveticaBoldFont.widthOfTextAtSize(
              description,
              fontSize,
            );
            page.drawText(description, {
              x: xPositionDNI + cellWidthDNI / 2 - textWidthDNI / 2,
              y: titleYPositionDNI + titlePaddingDNI + 5,
              size: fontSize,
              font: helveticaBoldFont,
              color: rgb(0, 0, 0),
            });
            page.drawLine({
              start: { x: xPositionDNI, y: titleYPositionDNI },
              end: { x: xPositionDNI + cellWidthDNI, y: titleYPositionDNI },
              thickness: 1,
              color: rgb(0, 0, 0),
            });
            if (wixImageUrl) {
              const wixImagePattern = /^wix:image:\/\/v1\/(.+?)\//;
              const match = wixImageUrl.match(wixImagePattern);
              if (match && match[1]) {
                const imageId = match[1];
                const directImageUrl = `https://static.wixstatic.com/media/${imageId}`;
                const imageFormat: any = wixImageUrl.includes('.png')
                  ? 'png'
                  : 'jpg';
                const response = await fetch(directImageUrl);
                const arrayBuffer = await response.arrayBuffer();
                const imageBuffer = Buffer.from(arrayBuffer);
                let embeddedImage;
                if (imageFormat === 'jpg' || imageFormat === 'jpeg') {
                  embeddedImage = await pdfDoc.embedJpg(imageBuffer);
                } else if (imageFormat === 'png') {
                  embeddedImage = await pdfDoc.embedPng(imageBuffer);
                } else {
                  console.warn(
                    `Formato de imagen no soportado para ${description}`,
                  );
                  continue;
                }
                page.drawImage(embeddedImage, {
                  x: xPositionDNI + 10,
                  y: currentY + 10,
                  width: imageWidthDNI,
                  height: imageHeightDNI,
                });
              } else {
                console.warn(
                  `No se pudo extraer el ID de la imagen para ${description}`,
                );
              }
            } else {
              console.warn(`No hay imagen disponible para ${description}`);
            }
            xPositionDNI += cellWidthDNI;
            if (
              (i + 1) % imagesPerRowDNI === 0 &&
              i !== datosImagenesDNICliente.length - 1
            ) {
              xPositionDNI = paddingXDNI;
              currentY -= cellHeightDNI;
            }
          }
          currentY -= 20;
        }
        currentY = currentY - (step === 4 ? 0 : 300);
        page.drawLine({
          start: { x: 50, y: 437 },
          end: { x: 550, y: 437 },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        currentY -= 20;
        const pngImageBytes = addDniClient
          ? travel?.signatureEndClient?.split(',')[1]
          : travel?.signatureStartClient?.split(',')[1];
        if (pngImageBytes) {
          const signatureClientImage = await pdfDoc.embedPng(
            Buffer.from(pngImageBytes, 'base64'),
          );
          const xSignature = addBothSignature ? 0 : 140;
          page.drawImage(signatureClientImage, {
            x: xSignature,
            y: 280,
            width: 300,
            height: 100,
          });
        }
        currentY = 265;
        page.drawLine({
          start: { x: 50, y: currentY },
          end: { x: 550, y: currentY },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        currentY -= 32;
        page.drawText('Firma del cliente', {
          x: addBothSignature ? 130 : 240,
          y: currentY,
          size: 13,
          font: font,
          color: rgb(0, 0, 0),
        });
        page.drawLine({
          start: { x: 50, y: currentY - 30 },
          end: { x: 550, y: currentY - 30 },
          thickness: 2,
          color: rgb(0, 0, 0),
        });
        if (addBothSignature) {
          page.drawLine({
            start: { x: 300, y: 437 },
            end: { x: 300, y: 203 },
            thickness: 3,
            color: rgb(0, 0, 0),
          });
          const pngImageBytesChofer = addStartImagesVehicule
            ? travel?.signatureStartChofer?.split(',')[1]
            : travel?.signatureEndChofer?.split(',')[1];
          if (pngImageBytesChofer) {
            const signatureClientImageChofer = await pdfDoc.embedPng(
              Buffer.from(pngImageBytesChofer, 'base64'),
            );
            page.drawImage(signatureClientImageChofer, {
              x: 290,
              y: 280,
              width: 280,
              height: 100,
            });
          }
          page.drawText('Firma del chofer', {
            x: 375,
            y: 230,
            size: 13,
            font: font,
            color: rgb(0, 0, 0),
          });
          currentY -= 50;
          page.drawText(
            'Ambas partes confirman el inicio del traslado del vehículo desde el punto de recogida hasta el ',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText(
            'punto de entrega, solicitado por el cliente y aceptado por el chofer, según lo indicado en este ',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText(
            'documento de confirmación emitido a través de DROVE®',
            {
              x: 60,
              y: currentY,
              size: 12,
              font: font,
              color: rgb(0, 0, 0),
            },
          );
        } else {
          currentY -= 60;
          page.drawText(
            'Confirmo que el dia de hoy solicité un traslado del vehículo nombrado en este documento,',
            { x: 60, y: currentY, size: 12, font: font, color: rgb(0, 0, 0) },
          );
          currentY -= 15;
          page.drawText('por medio de DROVE@', {
            x: 60,
            y: currentY,
            size: 12,
            font: font,
            color: rgb(0, 0, 0),
          });
          currentY -= 55;
          page.drawLine({
            start: { x: 50, y: currentY },
            end: { x: 550, y: currentY },
            thickness: 8,
            color: rgb(0, 0, 0),
          });
        }
        currentY -= 30;
        const formattedDate = new Date().toLocaleDateString('es-ES', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        page.drawText(`Fecha de emisión del documento: ${formattedDate}`, {
          x: 60,
          y: currentY,
          size: 9,
          font: font,
          color: rgb(0, 0, 0),
        });
      }

      const pdfDataUri = await pdfDoc.saveAsBase64({ dataUri: true });
      const dataUriPrefix = 'data:application/pdf;base64,';
      const base64 = pdfDataUri.slice(dataUriPrefix.length);
      const fileName = `${travel._id}_${detailInfo === 'chofer' ? 'viewClient' : 'viewDrover'}_${step}`;
      const UrlPdf = await this.savePDF(base64, fileName, travel._id);
      return UrlPdf;
    } catch (e) {
      console.log(e);
      return { message: `error ${e}` };
    }
  }

  /**
   * Función para devolver el detalle según el tipo de documento.
   */
  getDetailText(
    detailInfo: string,
    droverDetail: any,
    personDelivery: any,
    personReceive: any,
  ): any {
    switch (detailInfo) {
      case 'delivery':
        return {
          title: 'Nombre de quien entrega el vehículo:',
          nameKey: personDelivery.fullName,
          phoneKey: personDelivery.phone,
        };
      case 'reception':
        return {
          title: 'Nombre del receptor:',
          nameKey: personReceive.fullName,
          phoneKey: personReceive.phone,
        };
      case 'chofer':
      default:
        return {
          title: 'Nombre del chofer:',
          nameKey:
            droverDetail?.contactInfo?.info?.extendedFields?.items[
              'custom.fullname'
            ] ||
            droverDetail?.contactInfo?.info?.extendedFields?.items[
              'contacts.displayByFirstName'
            ] ||
            droverDetail?.detailRegister?.name ||
            'Nombre Chofer',
          phoneKey: droverDetail?.detailRegister?.phones || 'Sin teléfono',
        };
    }
  }

  /**
   * Genera el PDF de factura (simplificado).
   */
  async generatePDFInvoice(): Promise<any> {
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
      const fontSize = 30;
      page.drawText('Informe entrega', {
        x: 50,
        y: height - 4 * fontSize,
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      const pdfDataUri = await pdfDoc.saveAsBase64({ dataUri: true });
      const dataUriPrefix = 'data:application/pdf;base64,';
      const base64 = pdfDataUri.slice(dataUriPrefix.length);
      const UrlPdf = await this.savePDF(base64, 'factura');
      return UrlPdf;
    } catch (error) {
      console.log(error);
      return { message: `error ${error}` };
    }
  }

  /**
   * Simula la subida del PDF a un servicio de almacenamiento y retorna una URL de descarga.
   */
  async savePDF(
    base64: string,
    fileName: string,
    travelId?: string,
  ): Promise<string> {
    try {
      const file = await this.uploadPDF(base64, fileName, travelId);
      // Retornamos la URL de S3 directamente
      return file.filePath;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Función simulada para subir el PDF (aquí deberás integrar tu solución real, por ejemplo, AWS S3).
   */
  async uploadPDF(
    base64: string,
    fileName: string,
    travelId?: string,
  ): Promise<{ filePath: string }> {
    try {
      const bucketName = 'drove-pdf';
      const timestamp = await this.formatDateForFilename(new Date());
      // Si se proporciona travelId, se usará como carpeta (prefijo)
      const key = travelId
        ? `${travelId}/${fileName}/${timestamp}.pdf`
        : `${fileName}.pdf`;

      // Convertimos la cadena base64 a un Buffer
      const buffer = Buffer.from(base64, 'base64');

      // Subimos el objeto a S3
      await this.s3client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: buffer,
          ContentType: 'application/pdf',
        }),
      );

      // Construimos la URL pública del objeto (asegúrate de que tu bucket u objetos sean de lectura pública)
      const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION || 'eu-west-2'}.amazonaws.com/${key}`;
      return { filePath: fileUrl };
    } catch (error) {
      console.error('Error al guardar el PDF en S3:', error);
      throw new InternalServerErrorException('Error al guardar el PDF');
    }
  }

  async formatDateForFilename(date: Date): Promise<any> {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}/${month}/${year}_${hours}:${minutes}:${seconds}`;
  }

  /**
   * Función simulada para obtener la URL de descarga.
   */
  async getDownloadUrl(filePath: string): Promise<string> {
    const fileName = path.basename(filePath);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3001';
    return `${baseUrl}/pdf/${fileName}`;
  }

  /**
   * Obtiene los datos de un usuario a partir de su ID.
   */
  //TODO:PASAR a controlador
  async getUser(idUser: string): Promise<any> {
    try {
      const token =
        'IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcIjU5ZTk0Njc2LWYyNDctNDI5ZS04ZDI0LTBkOGM2Y2I4NzAxN1wiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcImEzNTY4YWY4LTA2MmYtNDUwNi1hMDRjLTc0YTE1MzY3YjAwN1wifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCI2OWFjZDRiMy1lMDU4LTQ3MmYtYWYwOS1jNjVjYzMyNmM5NTBcIn19IiwiaWF0IjoxNzMyMzI4MTAwfQ.SZW5nsliVhBaxA1RoPRNackft7yRLURhK-9pyZa_65htCjwhBgZ2K19SDPkJ_LR_nKxeY0IRzd83CLeiTayCJRzdtfCCzwfZBLprK5vZyMbyJNZO2RodDOnLxcJOnc0PqIpszO2udGGbgwZ8GgfMZb-QveN4TPmqUllHmCSOgtL6yZUwZQJ82G5NRtM1rVhxi3lV7MaO-DhbztVDGHlapFx6iYJxjV-n2psoOifrRCunAdQL33nbc5ppT7C0iRarqjMy2Mp8SQiDQVsg9APpi2fnTH5jb8RDr4QV1Ij97dwx3cScq66Tlr8C87jCzweBnfDvohO0cnlOQikO7T4wHw';
      const siteId = '1670865d-a9d7-411f-b9fa-b41007478883';
      const headers = {
        'Content-Type': 'application/json',
        Authorization: token,
        'wix-site-id': siteId,
      };

      // Endpoint para obtener la información del miembro
      const memberUrl = `https://www.wixapis.com/members/v1/members/${idUser}`;
      const memberResponse = await fetch(memberUrl, { method: 'GET', headers });
      if (!memberResponse.ok) {
        const errorResponse = await memberResponse.json();
        console.error('Error al obtener miembro:', errorResponse);
        throw new InternalServerErrorException('Error al obtener miembro');
      }
      const memberData = await memberResponse.json();

      // Endpoint para obtener la información de contacto
      const contactUrl = `https://www.wixapis.com/contacts/v4/contacts/${idUser}`;
      const contactResponse = await fetch(contactUrl, {
        method: 'GET',
        headers,
      });
      if (!contactResponse.ok) {
        const errorResponse = await contactResponse.json();
        console.error('Error al obtener contacto:', errorResponse);
        throw new InternalServerErrorException('Error al obtener contacto');
      }
      const contactData = await contactResponse.json();

      // Endpoint para obtener la colección "Users"
      // Aquí usamos el endpoint "Get Data Collection" de Wix Data. Se espera que la colección se llame "Users"
      const usersUrl = `https://www.wixapis.com/wix-data/v2/items/query`;

      const body = JSON.stringify({
        dataCollectionId: 'Users',
        query: {
          filter: {
            userId: idUser, // Asegúrate de que 'idUser' esté definido en tu entorno
          },
        },
      });
      const usersResponse = await fetch(usersUrl, {
        method: 'POST',
        headers,
        body,
      });
      if (!usersResponse.ok) {
        const errorResponse = await usersResponse.json();
        console.error('Error al obtener la colección Users:', errorResponse);
        throw new InternalServerErrorException(
          'Error al obtener la colección Users',
        );
      }
      const usersData = await usersResponse.json();
      // Supongamos que la respuesta tiene la propiedad "collection" con la lista de items
      const userItem = usersData?.dataItems[0]?.data ?? {};

      // Unir la información obtenida
      const user = {
        ...memberData.member,
        contactInfo: contactData.contact,
        detailRegister: userItem || {},
      };

      return user;
    } catch (error) {
      console.error('Error en getUser:', error);
      return null;
    }
  }

  async getTravel(travelId: string): Promise<any> {
    try {
      // Endpoint de la API Wix Data
      const token =
        'IST.eyJraWQiOiJQb3pIX2FDMiIsImFsZyI6IlJTMjU2In0.eyJkYXRhIjoie1wiaWRcIjpcIjU5ZTk0Njc2LWYyNDctNDI5ZS04ZDI0LTBkOGM2Y2I4NzAxN1wiLFwiaWRlbnRpdHlcIjp7XCJ0eXBlXCI6XCJhcHBsaWNhdGlvblwiLFwiaWRcIjpcImEzNTY4YWY4LTA2MmYtNDUwNi1hMDRjLTc0YTE1MzY3YjAwN1wifSxcInRlbmFudFwiOntcInR5cGVcIjpcImFjY291bnRcIixcImlkXCI6XCI2OWFjZDRiMy1lMDU4LTQ3MmYtYWYwOS1jNjVjYzMyNmM5NTBcIn19IiwiaWF0IjoxNzMyMzI4MTAwfQ.SZW5nsliVhBaxA1RoPRNackft7yRLURhK-9pyZa_65htCjwhBgZ2K19SDPkJ_LR_nKxeY0IRzd83CLeiTayCJRzdtfCCzwfZBLprK5vZyMbyJNZO2RodDOnLxcJOnc0PqIpszO2udGGbgwZ8GgfMZb-QveN4TPmqUllHmCSOgtL6yZUwZQJ82G5NRtM1rVhxi3lV7MaO-DhbztVDGHlapFx6iYJxjV-n2psoOifrRCunAdQL33nbc5ppT7C0iRarqjMy2Mp8SQiDQVsg9APpi2fnTH5jb8RDr4QV1Ij97dwx3cScq66Tlr8C87jCzweBnfDvohO0cnlOQikO7T4wHw';
      const siteId = '1670865d-a9d7-411f-b9fa-b41007478883';
      const travelsUrl = 'https://www.wixapis.com/wix-data/v2/items/query';

      // Construimos el body según la estructura requerida por la API
      const body = JSON.stringify({
        dataCollectionId: 'Travels', // Nombre exacto de la colección
        query: {
          filter: {
            _id: travelId, // Filtramos por el campo "_id"
          },
        },
      });

      const headers = {
        'Content-Type': 'application/json',
        Authorization: token,
        'wix-site-id': siteId,
      };

      // Petición POST
      const response = await fetch(travelsUrl, {
        method: 'POST',
        headers,
        body,
      });

      // Comprobamos si la respuesta es correcta
      if (!response.ok) {
        throw new Error(
          `Error HTTP ${response.status} - ${response.statusText}`,
        );
      }

      // Convertimos la respuesta a JSON
      const data = await response.json();

      // `data` normalmente tiene la forma { items: [...], totalCount: number, ... }
      // Si quieres retornar el primer elemento encontrado:
      if (data?.dataItems && data?.dataItems?.length > 0) {
        return data?.dataItems[0]?.data; // Devuelve el viaje
      } else {
        // O devuelve null/undefined si no encuentras un ítem
        return null;
      }
    } catch (error) {
      console.error('Error en getTravel:', error);
      throw error; // O maneja el error de otra forma
    }
  }

  async getMemberById(id: string): Promise<any> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        resolve({
          id: id,
          name: 'John Doe',
          email: '',
        });
      }, 1000); // Se espera 1 segundo antes de resolver la promesa
    });
  }

  /**
   * Normaliza un string de tiempo a formato 12 horas.
   */
  normalizeTime(time: any): string {
    // 1. Manejo de nulos/undefined de forma rápida (puedes retornar '' o lanzar un error)
    if (time == null) {
      // return ''; // O si prefieres lanzar un error:
      throw new Error('El valor de "time" es nulo o indefinido.');
    }

    // 2. Manejo de objetos con $date
    if (typeof time === 'object') {
      if ('$date' in time) {
        time = time.$date;
      } else if (time instanceof Date) {
        // ya es instancia de Date, la convertimos a cadena ISO
        time = time.toISOString();
      } else {
        // Si es un objeto sin $date y no es una instancia de Date
        // decidimos si lanzamos error o simplemente lo ignoramos
        throw new Error('No se reconoce la estructura del objeto para "time".');
      }
    }

    // 3. Manejo de timestamps numéricos (en milisegundos o segundos)
    if (typeof time === 'number') {
      // Un timestamp pequeño es probablemente segundos => convertir a ms
      if (time < 1e12) {
        time *= 1000;
      }
      time = new Date(time).toISOString();
    }

    // 4. Asegurarnos de que a estas alturas sea un string
    if (typeof time !== 'string') {
      throw new Error(
        'El formato de "time" no es válido. Se esperaba un string, un número o un objeto con "$date".',
      );
    }

    // 5. Eliminar espacios en blanco alrededor (por si llega " 14:30:00.000 ")
    time = time.trim();

    // 6. Regex para formatos de hora simples: "HH:MM", "HH:MM:SS", "HH:MM:SS.sss"
    const timeOnlyRegex = /^\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
    let hours: number;
    let minutes: number;

    if (timeOnlyRegex.test(time)) {
      // Manejo directo de "HH:MM" o "HH:MM:SS(.sss)"
      const [hh, mm] = time.split(':');
      hours = parseInt(hh, 10);
      minutes = parseInt(mm, 10);
    } else {
      // 7. Regex para formato ISO 8601 completo
      const isoRegex =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|(\+\d{2}:\d{2}))?$/;

      if (isoRegex.test(time)) {
        // Parseo directo con new Date()
        const date = new Date(time);
        if (isNaN(date.getTime())) {
          throw new Error('El formato de tiempo con ISO no pudo ser parseado.');
        }
        hours = date.getHours();
        minutes = date.getMinutes();
      } else {
        // 8. Fallback: Intentar parsear con new Date() (por si es algo como "Mar 07 2025 14:30:00", etc.)
        const parsedDate = new Date(time);
        if (!isNaN(parsedDate.getTime())) {
          hours = parsedDate.getHours();
          minutes = parsedDate.getMinutes();
        } else {
          // 9. Si llegamos aquí, ya no se pudo interpretar
          throw new Error(
            'El formato de tiempo no es válido. Se esperaba "HH:MM:SS.sss", "HH:MM", ISO 8601 o algo parseable por Date().',
          );
        }
      }
    }

    // 10. Convertir a formato 12 horas
    const period = hours >= 12 ? 'PM' : 'AM';
    const normalizedHours = hours % 12 || 12;
    const normalizedMinutes = String(minutes).padStart(2, '0');

    return `${normalizedHours}:${normalizedMinutes} ${period}`;
  }

  metersToKilometers(meters: number): string {
    return `${(meters / 1000).toString()}`;
  }

  /**
   * Obtiene el mapa y los datos de la ruta usando el servicio de rutas.
   */
  async getRouteMap(origin: any, destination: any): Promise<any> {
    const obj = {
      origin: {
        location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
      },
      destination: {
        location: {
          latLng: { latitude: destination.lat, longitude: destination.lng },
        },
      },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      computeAlternativeRoutes: false,
      routeModifiers: {
        avoidTolls: false,
        avoidHighways: false,
        avoidFerries: false,
      },
      languageCode: 'en-US',
      units: 'IMPERIAL',
    };
    try {
      const res = await this.routesService.getRoutes(obj);
      if (res?.error?.code === 400) {
        return { error: 'Error de solicitud: Código 400' };
      }
      if (!res.routes || res.routes.length === 0) {
        return {
          error: 'No se encontraron rutas para los parámetros proporcionados.',
        };
      }
      const distanceInSeg = res.routes[0].distanceMeters;
      const time = res.routes[0].duration;
      const DistanceInKM = this.metersToKilometers(distanceInSeg);
      const priceResult = await this.priceService.getPrice(DistanceInKM);
      return { priceResult, polyline: res.routes[0].polyline, DistanceInKM };
    } catch (error) {
      console.error('Error al obtener la ruta:', error);
      return { error: 'Ocurrió un error al obtener la ruta.' };
    }
  }

  /**
   * Obtiene una imagen de mapa con la ruta trazada usando la API estática de Google Maps.
   */
  async getMapImageWithRoute(
    origin: any,
    destination: any,
    polyline: string,
    zoom = 10,
    width = 600,
    height = 400,
  ): Promise<string> {
    const apiKey = 'AIzaSyDKamSrVlGgJge4zLs8ET7vF2jPqzkpdPk';
    const safePolyline = encodeURIComponent(polyline);
    const url = `https://maps.googleapis.com/maps/api/staticmap?size=${width}x${height}&zoom=${zoom}&markers=color:red%7C${origin.lat},${origin.lng}&markers=color:green%7C${destination.lat},${destination.lng}&path=enc:${safePolyline}&key=${apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Google Maps API error: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      const base64Image = imageBuffer.toString('base64');
      return `data:image/png;base64,${base64Image}`;
    } catch (error) {
      console.error('Error al obtener la imagen del mapa:', error);
      throw error;
    }
  }

  /**
   * Obtiene una imagen de mapa centrada en una latitud y longitud.
   */
  async getMapImage(
    lat: number,
    lng: number,
    zoom = 15,
    width = 600,
    height = 400,
  ): Promise<string> {
    const apiKey = 'AIzaSyDKamSrVlGgJge4zLs8ET7vF2jPqzkpdPk';
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${width}x${height}&markers=color:red%7C${lat},${lng}&key=${apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          `Google Maps API error: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);
      const base64Image = imageBuffer.toString('base64');
      return `data:image/png;base64,${base64Image}`;
    } catch (error) {
      console.error('Error al obtener la imagen del mapa:', error);
      throw error;
    }
  }
}
