import ptStrings from './pt.json';
import esStrings from './es.json';

type Locale = 'pt' | 'es';
type StringKey = keyof typeof ptStrings;

const strings: Record<Locale, Record<StringKey, string>> = {
  pt: ptStrings,
  es: esStrings,
};

/**
 * Detecta o locale a partir do header Accept-Language.
 * Retorna 'es' se o idioma preferido for espanhol; caso contrário 'pt'.
 */
export function detectLocale(acceptLanguage?: string): Locale {
  if (!acceptLanguage) return 'pt';
  const primary = acceptLanguage.split(',')[0].trim().toLowerCase();
  if (primary.startsWith('es')) return 'es';
  return 'pt';
}

/**
 * Retorna a string traduzida para o locale especificado.
 * Faz fallback para pt-BR se a chave não existir no locale solicitado.
 */
export function t(key: StringKey, locale: Locale = 'pt'): string {
  return strings[locale][key] ?? strings['pt'][key] ?? key;
}
