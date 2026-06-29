/**
 * Flags de visibilidad.
 *
 * POLLA2_PUBLIC: muestra la Polla 2 (cuadro eliminatorio) en las superficies
 * públicas (tarjeta del home, link del nav, bloque de premios, link "Mi Polla").
 * Mientras está en false, la polla existe y es accesible por URL directa
 * (/eliminacion, /polla/[slug], /mis-pronosticos) para pruebas, pero el público
 * no la ve. Para prenderla: en Vercel define NEXT_PUBLIC_POLLA2_PUBLIC=true y
 * redeploy. Sin la variable = oculta.
 */
export const POLLA2_PUBLIC = process.env.NEXT_PUBLIC_POLLA2_PUBLIC === 'true'
