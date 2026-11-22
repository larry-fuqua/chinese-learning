const SECRET_ENV = [
  "XAI_API_KEY",
  "READER_API_KEY",
  "READER_PASSCODE",
  "READER_SESSION_SECRET",
] as const;

/** Remove known secret values before anything is returned to a client. */
export function redact(text: string): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 4) out = out.split(value).join("[redacted]");
  }
  return out;
}

export function clip(text: string, max = 2000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
