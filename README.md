# Córdoba Bus

Aplicación web para consultar recorridos, paradas y la posición GPS que informa el servicio de colectivos urbanos de Córdoba Capital. El mapa es la interfaz: una barra lateral en escritorio y un panel inferior en el celular.

Los datos salen de los mismos endpoints HTTP que usa [Tu Bondi](https://micronauta4.dnsalias.net/web/urbano/?conf=cbaciudad). El frontend no habla con Micronauta. Habla con una API propia.

## Requisitos

- Node.js 20 o superior

## Uso

```bash
npm install
npm run dev
```

- Interfaz: http://localhost:5173
- API: http://127.0.0.1:8787/api/health

Para producción:

```bash
npm run build
npm start
```

El servidor entrega la API y, si existe `frontend/dist`, también la interfaz.

Variables opcionales en `.env`, a partir de `.env.example`. Sin ese archivo la aplicación usa los valores por defecto.

## API

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/health` | Estado del proceso, sesión y caché |
| GET | `/api/lines` | Líneas, recorridos y empresas |
| GET | `/api/routes/:client/:route/trace` | Traza, paradas y avisos |
| GET | `/api/vehicles?client=408&route=117` | Colectivos del recorrido elegido |
| GET | `/api/places?q=` | Sugerencias de dirección (Micronauta, con respaldo Nominatim) |
| POST | `/api/trip/search` | Viaje A→B: directos y combinaciones, filtrable por metros a pie |

`client` y `route` son los identificadores numéricos de Micronauta. El id de ruta no es único entre empresas: siempre van juntos.

## Cómo se consulta Micronauta

Verificado el 19 de octubre de 2026, sin Playwright:

1. `GET /usuario/urbano.php?conf=cbaciudad` devuelve la cookie `PHPSESSID`. Sin esa cookie, `consultacocheporruta` responde HTTP 408.
2. El HTML trae `operacion` como string y cambia en cada carga. Se reenvía si aparece. En la prueba, el GPS también respondió sin ese parámetro. No está fijo en el código.
3. El header `X-Device-FlakerParam` de `fp.js` no hizo falta para líneas, trazas ni GPS.
4. Catálogo: `POST /usuario/urbano2_cmd.php` con `cmd=lineasyrutas`.
5. Traza y paradas: `POST /usuario/urbano2_cmd.php?cmd=seleccionatraza`. Los puntos vienen como `[longitud, latitud, rumbo]`.
6. GPS: `POST /usuario/urbano2_cmd.php?cmd=consultacocheporruta`.

Tu Bondi vuelve a pedir el GPS **15 segundos** después de cada respuesta. Esta app usa ese intervalo. El backend guarda la respuesta 12 segundos para que varias personas mirando el mismo recorrido no multipliquen la consulta. El GPS se pide solo para el recorrido abierto.

Si Micronauta responde 403 o 429, las consultas quedan en pausa 90 segundos y la interfaz lo informa. No se reintenta en ráfaga.

## Qué se muestra

- Líneas, empresas y corredores, con los nombres que trae el catálogo.
- Ida y vuelta, a partir de `sentido` `I` y `V`.
- Traza, paradas y desvíos publicados en `notificaciones`.
- Colectivos con coordenadas válidas: línea, coche, serie (ID de flota), sentido, empresa, rampa accesible y la hora en que **esta app recibió** la posición.
- `tiempo`: minutos/segundos hasta una parada. Si elegís una parada, se reenvía como `parada_seleccionada` al proveedor.
- `demora`: texto del servicio, solo si viene informada y `demora_minutos` no es 99999.
- `rampa`: distinto de 0 se muestra como unidad con rampa accesible.
- Un aviso si el servicio responde sin unidades, si responde sin coordenadas válidas, o si la consulta falla. Una respuesta HTTP correcta no se presenta como GPS disponible.

No se interpreta `pantalla` ni `itinerario`. `curso` llega en radianes —el cliente original lo compara con `Math.PI`—, pero la rotación del ícono está desactivada en Tu Bondi y no se confirmó hacia dónde apunta el cero. Por eso los colectivos no se giran.

Si un colectivo desaparece de una respuesta exitosa, sigue visible 30 segundos en un estado atenuado y después se quita. Un salto de más de 1,5 km no se anima: el marcador se mueve directo a la coordenada nueva. La animación solo interpola posiciones recibidas.

## Mapa

MapLibre GL con los estilos de [OpenFreeMap](https://openfreemap.org) (Positron y oscuro). Hay que dejar visible la atribución de OpenFreeMap y OpenStreetMap. Se puede cambiar el estilo con `VITE_MAP_STYLE_LIGHT` y `VITE_MAP_STYLE_DARK`.

## Datos y licencia

El repositorio [manuelzapatageo/lineas_transporte_cba](https://github.com/manuelzapatageo/lineas_transporte_cba) está bajo MIT y sirvió para reconocer los endpoints de trazas y paradas. Este proyecto no copia ese código.

La licencia MIT de ese repositorio no autoriza a redistribuir los datos de Micronauta. Las consultas tienen que respetar las condiciones del servicio, sin eludir bloqueos ni límites.
