// src/routes/routes.service.ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import fetch from 'node-fetch';

@Injectable()
export class RoutesService {
  async getRoutes(obj: any): Promise<any> {
    try {
      const apiKey = 'AIzaSyDKamSrVlGgJge4zLs8ET7vF2jPqzkpdPk';
      const response = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-FieldMask': '*',
            'X-Goog-Api-Key': apiKey,
          },
          body: JSON.stringify(obj),
        },
      );
      const json = await response.json();
      return json;
    } catch (error) {
      console.error('Error fetching route data:', error);
      throw new InternalServerErrorException('Unable to fetch route data');
    }
  }

  async getDistance(params: any): Promise<any> {
    try {
      const apiKey = 'AIzaSyDKamSrVlGgJge4zLs8ET7vF2jPqzkpdPk'; // Reemplaza con tu propia clave de API si es necesario

      // Extraer las coordenadas de los parámetros
      const { originLat, originLng, destinationLat, destinationLng } = params;

      // Construir las cadenas de coordenadas
      const origins = `${originLat},${originLng}`;
      const destinations = `${destinationLat},${destinationLng}`;

      // Construir la URL de la solicitud
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&key=${apiKey}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await response.json();

      if (json.status === 'OK' && json.rows[0].elements[0].status === 'OK') {
        const distance = json.rows[0].elements[0].distance.text;
        const duration = json.rows[0].elements[0].duration.text;
        return { distance, duration };
      } else {
        console.error('Error en la respuesta de la API:', json);
        throw new InternalServerErrorException(
          'Error en la respuesta de la API',
        );
      }
    } catch (error) {
      console.error('Error al obtener los datos de distancia:', error);
      throw new InternalServerErrorException(
        'Error al obtener los datos de distancia',
      );
    }
  }
}
