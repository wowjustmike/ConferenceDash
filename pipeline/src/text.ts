import * as cheerio from 'cheerio'

/** Visible text of an HTML page, with a space between adjacent elements. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html.replace(/></g, '> <'))
  $('script, style, noscript, svg').remove()
  return $('body').text().replace(/\s+/g, ' ').trim()
}
