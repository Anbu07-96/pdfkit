import "server-only";

/**
 * Known disposable / temporary email domain blocklist.
 * Prevents throwaway accounts without calling external third-party APIs.
 */
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  "10minutemail.com",
  "10minute.mail",
  "10minutemail.net",
  "10minutemail.org",
  "crazymailing.com",
  "disposablemail.com",
  "dispostable.com",
  "fakeinbox.com",
  "getairmail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "guerrillamail.org",
  "mailinator.com",
  "mailinator.net",
  "maildrop.cc",
  "mytemp.email",
  "sharklasers.com",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "tempinbox.com",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

/** Common weak / insecure password blacklist */
export const COMMON_PASSWORDS = new Set<string>([
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "admin123",
  "letmein1",
  "welcome1",
  "abc12345",
  "iloveyou1",
  "sunshine1",
  "master123",
  "superman1",
  "pass1234",
  "p@ssword1",
  "pdfkit123",
  "secret123",
]);

export interface EmailValidationResult {
  isValid: boolean;
  normalizedEmail?: string;
  error?: string;
}

export interface PasswordValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates syntax, length, structure and disposable domains for an email address.
 * Normalizes email to trimmed lowercase canonical representation.
 */
export function validateAndNormalizeEmail(
  rawEmail: string | undefined | null,
): EmailValidationResult {
  if (!rawEmail || typeof rawEmail !== "string") {
    return { isValid: false, error: "Email address is required." };
  }

  const trimmed = rawEmail.trim();

  // RFC 5321 length ceiling
  if (trimmed.length === 0 || trimmed.length > 254) {
    return { isValid: false, error: "Email address length is invalid." };
  }

  // Reject whitespace or control characters
  if (/\s|[\x00-\x1F\x7F]/.test(trimmed)) {
    return { isValid: false, error: "Email address contains invalid characters." };
  }

  // Reject double dots
  if (trimmed.includes("..")) {
    return { isValid: false, error: "Email address cannot contain consecutive dots." };
  }

  // Strict email format regex: local@domain.tld (at least 2 char TLD)
  const emailRegex =
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

  if (!emailRegex.test(trimmed)) {
    return { isValid: false, error: "Email address format is invalid." };
  }

  const parts = trimmed.split("@");
  if (parts.length !== 2) {
    return { isValid: false, error: "Email address format is invalid." };
  }

  const [localPart, domainPart] = parts;
  if (!localPart || !domainPart) {
    return { isValid: false, error: "Email address format is invalid." };
  }

  const normalizedDomain = domainPart.toLowerCase();
  const normalizedEmail = `${localPart.toLowerCase()}@${normalizedDomain}`;

  // Check disposable domain blocklist
  if (DISPOSABLE_EMAIL_DOMAINS.has(normalizedDomain)) {
    return {
      isValid: false,
      error: "Disposable and temporary email providers are not permitted.",
    };
  }

  return {
    isValid: true,
    normalizedEmail,
  };
}

/**
 * Hardens password requirements:
 * - 8 to 128 characters
 * - Must contain at least one letter and at least one number
 * - Rejects whitespace and control characters
 * - Rejects known weak / common passwords
 */
export function validatePassword(
  rawPassword: string | undefined | null,
): PasswordValidationResult {
  if (!rawPassword || typeof rawPassword !== "string") {
    return { isValid: false, error: "Password is required." };
  }

  if (rawPassword.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters long." };
  }

  if (rawPassword.length > 128) {
    return { isValid: false, error: "Password cannot exceed 128 characters." };
  }

  if (/\s|[\x00-\x1F\x7F]/.test(rawPassword)) {
    return { isValid: false, error: "Password cannot contain spaces or control characters." };
  }

  if (!/[a-zA-Z]/.test(rawPassword)) {
    return { isValid: false, error: "Password must contain at least one letter." };
  }

  if (!/[0-9]/.test(rawPassword)) {
    return { isValid: false, error: "Password must contain at least one number." };
  }

  if (COMMON_PASSWORDS.has(rawPassword.toLowerCase())) {
    return { isValid: false, error: "Password is too common and easily guessed." };
  }

  return { isValid: true };
}
