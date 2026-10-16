const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa texto para interpolarlo en HTML (contenido o valor de atributo
 * entre comillas). Fase 4 · P4.B (cyber N2): los templates de email
 * interpolan nombres de usuarios, organizaciones e invitadores.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * URL segura para un `href`: solo `http:`/`https:` absolutas, escapada. Otro
 * esquema (`javascript:`, `data:`) o una URL inválida -> `#`.
 */
export function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '#';
    }
    return escapeHtml(url.toString());
  } catch {
    return '#';
  }
}
