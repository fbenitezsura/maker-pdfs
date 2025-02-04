// src/price/price.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export class PriceService {
  async getPrice(kmInput: string): Promise<any> {
    // Definición de los rangos con datos numéricos para facilitar los cálculos
    const ranges = [
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
    // Elimina separadores de miles y convierte la entrada a número
    const kmString = kmInput.toString().replace(/,/g, '');
    const km = Math.round(parseFloat(kmString));

    if (isNaN(km) || km < 0) {
      throw new InternalServerErrorException('Kilometraje inválido');
    }

    // Costo base para los primeros 100 km
    const costoBase = 184.2;

    // Calcular kilómetros adicionales (más de 100 km)
    const kmAdicional = km > 100 ? km - 100 : 0;
    const costoAdicional = kmAdicional * 0.69;

    // Buscar el rango correspondiente para obtener el costo de combustible
    const rango = ranges.find((range) => {
      const [minStr, maxStr] = range.kmRange.split(' A ');
      const min = parseInt(minStr.replace(/[.,]/g, ''), 10);
      const max = parseInt(maxStr.replace(/[.,]/g, ''), 10);
      return km >= min && km <= max;
    });

    if (!rango) {
      throw new InternalServerErrorException('Kilometraje fuera de rango');
    }

    const costoCombustible = rango.combustible;

    // Cálculo del total sin IVA, IVA (21%) y total final
    const totalSinIVA = costoBase + costoAdicional + costoCombustible;
    const IVA = totalSinIVA * 0.21;
    const totalCliente = totalSinIVA + IVA;
    const totalClienteRedondeado = Math.round(totalCliente * 100) / 100;

    return {
      Kilómetros: km,
      'Costo Base (€)': costoBase.toFixed(2),
      'Kilómetros Adicionales': kmAdicional,
      'Costo Adicional (€)': costoAdicional.toFixed(2),
      'Costo de Combustible (€)': costoCombustible.toFixed(2),
      Total_sin_IVA: totalSinIVA.toFixed(2),
      IVA: IVA.toFixed(2),
      Total_Cliente: totalClienteRedondeado.toFixed(2),
    };
  }
}
