/**
 * Flags de visibilidad.
 *
 * POLLA2_PUBLIC: muestra la Polla 2 (cuadro eliminatorio) en las superficies
 * públicas (tarjeta del home, link del nav, bloque de premios, link "Mi Polla").
 *
 * LANZADA: encendida por defecto. Para volver a esconderla, define en Vercel
 * NEXT_PUBLIC_POLLA2_PUBLIC=false y redeploy.
 */
export const POLLA2_PUBLIC = process.env.NEXT_PUBLIC_POLLA2_PUBLIC !== 'false'
