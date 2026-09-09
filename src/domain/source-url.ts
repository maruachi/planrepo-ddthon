export const SOURCE_LINK_URL_PATTERN = '^[Hh][Tt][Tt][Pp][Ss]?://(?![^/?#]*@)[^\\s\\\\]+$';

export function isAllowedSourceLinkUrl(value: string): boolean {
  if (!/^https?:\/\//iu.test(value) || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}
