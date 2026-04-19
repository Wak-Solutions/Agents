export const NAME_ERROR = "Name cannot contain numbers";

/** Returns true if the value is a valid name (no digits). */
export function isValidName(value: string): boolean {
  return !/[0-9]/.test(value);
}

/** Returns an error string if invalid, empty string if valid. */
export function nameError(value: string): string {
  return isValidName(value) ? "" : NAME_ERROR;
}
