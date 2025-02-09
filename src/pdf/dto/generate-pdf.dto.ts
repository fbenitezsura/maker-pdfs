// src/pdf/dto/generate-pdf.dto.ts
export class GeneratePdfDto {
  travelId: any; // Aquí puedes definir una interfaz o usar "any" para simplificar
  usePage: string;
  addQr: boolean;
  addStartImagesVehicule: boolean;
  addBothSignature: boolean;
  addEndImagesVehicule: boolean;
  addDniClient: boolean;
  detailInfo: string;
  step: number;
}
