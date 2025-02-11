// src/price/price.service.ts

import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class PriceService {
  // Rangos de kms y su respectivo costo de combustible
  private readonly ranges = [
    { kmRange: '0 A 99', combustible: 7.9 },
    { kmRange: '100 A 199', combustible: 17.8 },
    { kmRange: '200 A 299', combustible: 25.7 },
    { kmRange: '300 A 399', combustible: 31.6 },
    { kmRange: '400 A 499', combustible: 39.5 },
    { kmRange: '500 A 599', combustible: 47.4 },
    { kmRange: '600 A 699', combustible: 55.3 },
    { kmRange: '700 A 799', combustible: 63.2 },
    { kmRange: '800 A 899', combustible: 71.1 },
    { kmRange: '900 A 999', combustible: 79.0 },
    { kmRange: '1000 A 1099', combustible: 86.9 },
    { kmRange: '1100 A 1199', combustible: 94.8 },
    { kmRange: '1200 A 1299', combustible: 102.7 },
    { kmRange: '1300 A 1399', combustible: 110.6 },
    { kmRange: '1400 A 1499', combustible: 118.5 },
    { kmRange: '1500 A 1599', combustible: 126.4 },
    { kmRange: '1600 A 1699', combustible: 134.3 },
  ];

  /**
   * Parsear string de km con diversos formatos (comas, puntos, espacios, etc.).
   * Devuelve un float (puede ser NaN si no es parseable).
   */
  private parseKmInput(input: any): number {
    let str = String(input).trim().replace(/\s+/g, '');

    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');

    // Si tiene punto y coma, usamos la que esté más a la derecha como decimal
    if (lastDot !== -1 && lastComma !== -1) {
      if (lastDot > lastComma) {
        // '.' es separador decimal -> remover comas
        str = str.replace(/,/g, '');
      } else {
        // ',' es separador decimal -> remover puntos, sustituir la ',' final por '.'
        str = str.replace(/\./g, '');
        str = str.replace(',', '.');
      }
    }
    // Si solo hay comas
    else if (lastComma !== -1 && lastDot === -1) {
      str = str.replace(',', '.'); // coma -> punto
    }
    // Si solo hay puntos o no hay nada, se deja como está

    return parseFloat(str);
  }

  async getPrice(kmInput: any): Promise<any> {
    // 1) Parse con la lógica avanzada
    const kmExactos = this.parseKmInput(kmInput);

    // 2) Verificar que sea numérico y no negativo
    if (isNaN(kmExactos) || kmExactos < 0) {
      throw new InternalServerErrorException('Kilometraje inválido');
    }

    // 3) Redondear (por ejemplo a km enteros)
    const km = Math.round(kmExactos);

    // 4) Cálculos base
    const costoBase = 184.2; // coste fijo
    const costoPorKmExtra = 0.69; // coste por km adicional >100
    const kmAdicional = km > 100 ? km - 100 : 0;
    const costoAdicional = kmAdicional * costoPorKmExtra;

    // 5) Encontrar combustible según rango
    let costoCombustible: number | null = null;
    for (const range of this.ranges) {
      const [minStr, maxStr] = range.kmRange.split(' A ');
      const min = parseInt(minStr, 10);
      const max = parseInt(maxStr, 10);
      if (km >= min && km <= max) {
        costoCombustible = range.combustible;
        break;
      }
    }

    // 6) Si excede el último rango, estimamos extrapolando
    if (costoCombustible === null) {
      const lastRange = this.ranges[this.ranges.length - 1];
      const [, lastMaxStr] = lastRange.kmRange.split(' A ');
      const lastMax = parseInt(lastMaxStr, 10);
      const lastComb = lastRange.combustible;

      // Tomar el penúltimo para ver la diferencia
      const secondLastRange = this.ranges[this.ranges.length - 2];
      const diff = lastComb - secondLastRange.combustible;
      const incrementPerKm = diff / 100; // estimación de subida por km

      const extraKm = km - lastMax;
      costoCombustible = lastComb + extraKm * incrementPerKm;
    }

    // 7) Calcular total sin IVA, IVA y total
    const totalSinIVA = costoBase + costoAdicional + costoCombustible;
    const IVA = totalSinIVA * 0.21;
    const totalCliente = totalSinIVA + IVA;

    return {
      Kilómetros: km,
      'Kilómetros Exactos': kmExactos.toFixed(3), // Info adicional
      'Costo Base (€)': costoBase.toFixed(2),
      'Kilómetros Adicionales': kmAdicional,
      'Costo Adicional (€)': costoAdicional.toFixed(2),
      'Costo de Combustible (€)': costoCombustible.toFixed(2),
      Total_sin_IVA: totalSinIVA.toFixed(2),
      'IVA (€)': IVA.toFixed(2),
      Total_Cliente: totalCliente.toFixed(2),
    };
  }
}
